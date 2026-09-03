import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

/**
 * Notifies the Mercurius team inbox when a new vendor application is submitted.
 *
 * Destination inbox: TEAM_NOTIFICATION_EMAIL secret (falls back to the constant below).
 * Transport: Resend via the Lovable connector gateway. If the transport is not
 * configured yet, the function logs the application and returns 200 so the
 * applicant flow is never blocked (admins also get an in-app notification via a
 * database trigger).
 */
const FALLBACK_TEAM_INBOX = 'team@mercuriusmarketplace.com';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const app = await req.json();

    const rows: [string, unknown][] = [
      ['Business', app.business_name],
      ['Primary category', app.primary_category],
      ['Team size', app.team_size],
      ['Years in business', app.years_experience],
      ['Description', app.business_description],
      ['Contact', `${app.first_name ?? ''} ${app.last_name ?? ''}`.trim()],
      ['Email', app.email],
      ['Phone', app.phone],
      ['Website', app.website],
      ['Preferred contact', app.preferred_contact],
      ['Service areas', app.service_areas],
      ['Services', Array.isArray(app.services) ? app.services.join(', ') : app.services],
      ['Credentials', Array.isArray(app.credentials) ? app.credentials.join(', ') : app.credentials],
      ['Other certification', app.other_certification],
      ['License / contractor #', app.license_number],
      ['Insurance policy #', app.insurance_policy_number],
      [
        'Documents uploaded',
        Array.isArray(app.document_urls) && app.document_urls.length
          ? `${app.document_urls.length} file(s) — view them in Admin → Applications`
          : null,
      ],
      ['Notes', app.additional_notes],
    ];

    const html = `<h2>New vendor application</h2><table cellpadding="6">${rows
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${esc(v)}</td></tr>`)
      .join('')}</table><p>Review it in Admin → Applications.</p>`;

    const to = Deno.env.get('TEAM_NOTIFICATION_EMAIL') ?? FALLBACK_TEAM_INBOX;
    const fromAddress = Deno.env.get('TEAM_NOTIFICATION_FROM');
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    if (!resendKey || !lovableKey || !fromAddress) {
      console.log('Email transport not configured; application logged only', {
        application_id: app.application_id,
        business_name: app.business_name,
        email: app.email,
      });
      return new Response(JSON.stringify({ ok: true, emailed: false, reason: 'transport_not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch('https://connector-gateway.lovable.dev/resend/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': resendKey,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject: `New vendor application — ${app.business_name ?? 'Unknown business'}`,
        html,
      }),
    });

    if (!res.ok) {
      const details = await res.text();
      console.error(`Team notification email failed [${res.status}]: ${details}`);
      return new Response(JSON.stringify({ ok: true, emailed: false, status: res.status, details }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, emailed: true, to }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('vendor-application-notify error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
