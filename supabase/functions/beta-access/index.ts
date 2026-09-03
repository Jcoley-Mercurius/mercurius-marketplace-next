// Server-side private-beta gate.
// The access code lives ONLY in the BETA_ACCESS_CODE secret — it is never shipped to the browser.
// Successful verification returns a short-lived HMAC-signed pass token that the client stores.
// NOTE: this gate exists to keep the pre-launch site private from casual/randoms and crawlers.
// It is NOT the security boundary for data — RLS + Supabase auth roles remain the real gate.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ACCESS_CODE = (Deno.env.get('BETA_ACCESS_CODE') ?? '').trim().toUpperCase();
const TOKEN_SECRET = Deno.env.get('BETA_TOKEN_SECRET') ?? '';
const TOKEN_TTL_DAYS = 30;

const enc = new TextEncoder();

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function issueToken(): Promise<string> {
  const exp = Date.now() + TOKEN_TTL_DAYS * 86400 * 1000;
  const payload = `beta.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

async function tokenValid(token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'beta') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(parts[2], await hmac(`beta.${parts[1]}`));
}

function ip(req: Request) {
  return req.headers.get('x-forwarded-for') ?? 'unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ACCESS_CODE || !TOKEN_SECRET) {
    console.error('beta-access misconfigured: missing BETA_ACCESS_CODE or BETA_TOKEN_SECRET');
    return json({ error: 'Gate unavailable' }, 500);
  }

  let body: { action?: string; code?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }

  if (body.action === 'verify') {
    const ok = typeof body.token === 'string' && (await tokenValid(body.token));
    if (!ok) console.warn('beta-access: invalid/expired pass token presented', { ip: ip(req) });
    return json({ valid: ok });
  }

  if (body.action === 'redeem') {
    const supplied = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!supplied || !safeEqual(supplied, ACCESS_CODE)) {
      console.warn('beta-access: rejected access code attempt', { ip: ip(req), ua: req.headers.get('user-agent') });
      return json({ error: 'Invalid access code' }, 401);
    }
    return json({ token: await issueToken() });
  }

  return json({ error: 'Unknown action' }, 400);
});
