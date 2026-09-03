// TRACE-010 / DEC-2026-006. Gateway JWT remains required in config.toml.
// Explicitly disabled by default. No caller-controlled job/state/time parameters.
// Historical source: supabase/recovered/job-lifecycle-worker.phase2.ts.
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

type AuthResult = { ok: true; via: 'cron_secret' | 'admin'; actorId?: string } | { ok: false; status: number; reason: string };

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
  if (!isAdmin) return { ok: false, status: 403, reason: 'not_admin' };

  return { ok: true, via: 'admin', actorId: userData.user.id };
}


const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  const runId = crypto.randomUUID();
  try {
    const auth = await authorize(req);
    if (!auth.ok) {
      console.warn(JSON.stringify({ event: 'lifecycle_rejected', run_id: runId, reason: auth.reason }));
      return respond({ error: 'Unauthorized', run_id: runId }, auth.status);
    }
    if (Deno.env.get('JOB_LIFECYCLE_ENABLED') !== 'true') {
      return respond({ error: 'Lifecycle processing is inactive', run_id: runId }, 503);
    }
    const { data, error } = await supabase.rpc('run_lifecycle_batch', {
      _run_id: runId, _actor_id: auth.actorId ?? null,
    });
    if (error || !data || data.ok !== true) {
      console.error(JSON.stringify({ event: 'lifecycle_failed', run_id: runId, code: error?.code ?? 'invalid_result' }));
      return respond({ error: 'Lifecycle batch failed; safe to retry', run_id: runId }, 500);
    }
    console.log(JSON.stringify({ event: 'lifecycle_completed', run_id: runId, via: auth.via,
      matches_expired: data.matches_expired, admin_flagged: data.admin_flagged }));
    return respond(data);
  } catch {
    console.error(JSON.stringify({ event: 'lifecycle_failed', run_id: runId, code: 'unexpected_error' }));
    return respond({ error: 'Lifecycle batch failed; safe to retry', run_id: runId }, 500);
  }
});
