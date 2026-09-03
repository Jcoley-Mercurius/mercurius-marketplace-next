import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Body {
  tier?: string;
  balance?: number;
  lifetime?: number;
  remaining_to_next?: number;
  recent_sources?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Require an authenticated caller — this function consumes paid AI credits.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const system = `You are the Mercurius Loyalty concierge for Cape Coral & Fort Myers homeowners. Generate a 3-action earning plan tuned to the user's tier and lifestyle (canals, hurricanes, snowbirds). Reply ONLY with valid JSON: { "headline": string (max 60 chars), "story": string (50-70 words, warm), "actions": [{ "title": string, "points": number, "detail": string (1 sentence) }] (exactly 3, escalating point value). No markdown, no preamble.`;

    const user = `Tier: ${body.tier ?? 'bronze'}\nBalance: ${body.balance ?? 0}\nLifetime: ${body.lifetime ?? 0}\nPoints to next tier: ${body.remaining_to_next ?? 'n/a'}\nStrongest sources so far: ${(body.recent_sources ?? []).join(', ') || 'none yet'}`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: 'Rate limit. Try again in a moment.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: 'AI credits exhausted.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error('AI gateway error', aiRes.status, txt);
      return new Response(JSON.stringify({ error: 'AI request failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content ?? '{}';
    let plan;
    try {
      plan = JSON.parse(content);
    } catch {
      plan = { headline: 'Your next moves', story: content, actions: [] };
    }

    return new Response(JSON.stringify(plan), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('loyalty-recommend error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
