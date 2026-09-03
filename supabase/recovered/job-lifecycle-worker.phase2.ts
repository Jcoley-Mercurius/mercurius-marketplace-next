// Scheduled worker that drives the job review & reputation lifecycle.
// Runs on a cron (every 15 minutes) independent of any open app session.
//
// AUTHORIZATION: this function holds the service role key and bypasses RLS, so it is
// NOT publicly invokable. A caller must present either:
//   1. header `x-worker-secret: <JOB_WORKER_SECRET>` (used by the pg_cron job), or
//   2. header `Authorization: Bearer <JWT>` of a user with the `admin` role (manual runs).
// Everything else is rejected with 401/403 and logged.
// The function accepts NO caller-supplied job ids or target states — it only scans
// for rows already in a valid precursor state and applies the one legal next transition.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const WORKER_SECRET = Deno.env.get('JOB_WORKER_SECRET') ?? '';

/** Timing-safe string compare. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clientInfo(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    ua: req.headers.get('user-agent') ?? 'unknown',
  };
}

type AuthResult = { ok: true; via: 'cron_secret' | 'admin' } | { ok: false; status: number; reason: string };

async function authorize(req: Request): Promise<AuthResult> {
  const provided = req.headers.get('x-worker-secret');
  if (provided) {
    if (WORKER_SECRET && safeEqual(provided, WORKER_SECRET)) return { ok: true, via: 'cron_secret' };
    // Fallback: token stored in the private internal_worker_tokens table (used by pg_cron).
    const { data: row } = await supabase
      .from('internal_worker_tokens')
      .select('token')
      .eq('name', 'job-lifecycle-worker')
      .maybeSingle();
    if (row?.token && safeEqual(provided, row.token)) return { ok: true, via: 'cron_secret' };
    return { ok: false, status: 401, reason: 'invalid_worker_secret' };
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { ok: false, status: 401, reason: 'missing_credentials' };

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, reason: 'invalid_jwt' };

  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userData.user.id, _role: 'admin' });
  if (!isAdmin) return { ok: false, status: 403, reason: `not_admin:${userData.user.id}` };

  return { ok: true, via: 'admin' };
}

type EventType =
  | 'confirmation_sent'
  | 'auto_completed_by_timer'
  | 'review_requested'
  | 'vendor_reminder_sent'
  | 'flagged_for_admin_review';

async function logEvent(jobId: string, type: EventType, metadata?: Record<string, unknown>) {
  await supabase.from('job_events').insert({ job_id: jobId, event_type: type, metadata: metadata ?? null });
}

async function notify(opts: {
  userId: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  link: string;
  requestId?: string;
  contractorId?: string | null;
}) {
  await supabase.from('notifications').insert({
    user_id: opts.userId,
    type: opts.type,
    severity: opts.severity,
    title: opts.title,
    body: opts.body,
    link: opts.link,
    related_request_id: opts.requestId ?? null,
    related_contractor_id: opts.contractorId ?? null,
  });
}

/** Local hour in the given IANA timezone (defaults to SWFL). */
function localHour(tz: string | null): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz || 'America/New_York',
      }).format(new Date()),
    );
  } catch {
    return new Date().getUTCHours() - 5;
  }
}

async function vendorUserId(contractorId: string | null): Promise<string | null> {
  if (!contractorId) return null;
  const { data } = await supabase.from('contractors').select('user_id').eq('id', contractorId).maybeSingle();
  return data?.user_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') {
    console.warn('job-lifecycle-worker REJECTED', { reason: 'method_not_allowed', method: req.method, ...clientInfo(req) });
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    console.warn('job-lifecycle-worker UNAUTHORIZED', { reason: auth.reason, ...clientInfo(req) });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: auth.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  console.log('job-lifecycle-worker authorized run', { via: auth.via });

  const now = new Date();
  const nowIso = now.toISOString();
  const summary = {
    matches_expired: 0,
    confirmations_sent: 0,
    auto_confirmed: 0,
    review_requests: 0,
    vendor_reminders: 0,
    admin_flagged: 0,
  };

  try {
    // 0. Expire matches the vendor never responded to — the job returns to the
    // unmatched pool, the homeowner + admins are notified, and the vendor loses access.
    const { data: expiredMatches, error: expireErr } = await supabase.rpc('expire_stale_matches');
    if (expireErr) console.error('expire_stale_matches failed:', expireErr);
    else summary.matches_expired = Number(expiredMatches ?? 0);

    // 1. Homeowner confirmation request — 4h after vendor completion, 8am–8pm local.
    const { data: pendingConfirmation } = await supabase
      .from('service_requests')
      .select('id, customer_id, contractor_id, service_type, timezone')
      .eq('status', 'vendor_completed')
      .is('confirmation_sent_at', null)
      .lte('confirmation_due_at', nowIso)
      .limit(200);

    for (const job of pendingConfirmation ?? []) {
      const hour = localHour(job.timezone);
      if (hour < 8 || hour >= 20) continue; // outside quiet-hours window; retried next run

      const deadline = new Date(now.getTime() + 72 * 3600 * 1000).toISOString();
      const { error } = await supabase
        .from('service_requests')
        .update({ confirmation_sent_at: nowIso, confirmation_deadline_at: deadline })
        .eq('id', job.id)
        .eq('status', 'vendor_completed')
        .is('confirmation_sent_at', null);
      if (error) continue;

      await notify({
        userId: job.customer_id,
        type: 'job_confirmation',
        severity: 'info',
        title: `Is your ${job.service_type} all set?`,
        body: 'Your pro marked the job complete and uploaded photos. Let us know if it looks good.',
        link: `/dashboard?confirm=${job.id}`,
        requestId: job.id,
        contractorId: job.contractor_id,
      });
      await logEvent(job.id, 'confirmation_sent');
      summary.confirmations_sent++;
    }

    // 2. Silent fallback — 72h with no response counts as implicit confirmation.
    const { data: expired } = await supabase
      .from('service_requests')
      .select('id')
      .eq('status', 'vendor_completed')
      .not('confirmation_deadline_at', 'is', null)
      .lte('confirmation_deadline_at', nowIso)
      .limit(200);

    for (const job of expired ?? []) {
      // Single source of truth: the state machine validates the transition,
      // stamps timestamps, logs the event and fires notifications.
      const { error } = await supabase.rpc('transition_job_status', {
        _job_id: job.id,
        _to_status: 'homeowner_confirmed',
        _reason: 'Auto-confirmed after 72h with no homeowner response',
        _metadata: { source: 'job-lifecycle-worker' },
      });
      if (error) {
        console.warn('auto-confirm transition rejected', job.id, error.message);
        continue;
      }

      await logEvent(job.id, 'auto_completed_by_timer');
      summary.auto_confirmed++;
    }

    // 3. Review request — completed (post-confirmation) + payment captured + 1h delay elapsed.
    const { data: readyForReview } = await supabase
      .from('service_requests')
      .select('id, customer_id, contractor_id, service_type')
      .eq('status', 'completed')
      .eq('payment_status', 'captured')
      .not('review_request_due_at', 'is', null)
      .lte('review_request_due_at', nowIso)
      .limit(200);

    for (const job of readyForReview ?? []) {
      const { error: reviewErr } = await supabase.rpc('transition_job_status', {
        _job_id: job.id,
        _to_status: 'review_requested',
        _reason: null,
        _metadata: { source: 'job-lifecycle-worker' },
      });
      if (reviewErr) {
        console.warn('review-request transition rejected', job.id, reviewErr.message);
        continue;
      }

      await notify({
        userId: job.customer_id,
        type: 'review_request',
        severity: 'info',
        title: `How did your ${job.service_type} go?`,
        body: 'Rate your pro — it takes about 20 seconds.',
        link: `/dashboard?review=${job.id}`,
        requestId: job.id,
        contractorId: job.contractor_id,
      });
      await logEvent(job.id, 'review_requested');
      summary.review_requests++;
    }

    // 4. Vendor reminder backstop — 2 days past scheduled date with no completion.
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400 * 1000).toISOString().slice(0, 10);
    const { data: stale } = await supabase
      .from('service_requests')
      .select('id, contractor_id, service_type, preferred_date, vendor_reminder_sent_at, needs_admin_review')
      .in('status', ['scheduled', 'in_progress'])
      .not('preferred_date', 'is', null)
      .lte('preferred_date', twoDaysAgo)
      .limit(200);

    for (const job of stale ?? []) {
      if (!job.vendor_reminder_sent_at) {
        const vUser = await vendorUserId(job.contractor_id);
        await supabase.from('service_requests').update({ vendor_reminder_sent_at: nowIso }).eq('id', job.id);
        if (vUser) {
          await notify({
            userId: vUser,
            type: 'vendor_reminder',
            severity: 'warning',
            title: 'Update needed on a job',
            body: `Your ${job.service_type} job is past its scheduled date. Please update the status.`,
            link: '/vendor/jobs',
            requestId: job.id,
            contractorId: job.contractor_id,
          });
        }
        await logEvent(job.id, 'vendor_reminder_sent');
        summary.vendor_reminders++;
        continue;
      }

      const remindedAt = new Date(job.vendor_reminder_sent_at).getTime();
      if (!job.needs_admin_review && now.getTime() - remindedAt >= 2 * 86400 * 1000) {
        // No vendor response after another 2 days — flag for internal review, never auto-complete.
        await supabase.from('service_requests').update({ needs_admin_review: true }).eq('id', job.id);
        await logEvent(job.id, 'flagged_for_admin_review');
        summary.admin_flagged++;
      }
    }

    return new Response(JSON.stringify({ ok: true, ran_at: nowIso, ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('job-lifecycle-worker failed:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
