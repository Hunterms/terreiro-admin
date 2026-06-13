/**
 * Cloudflare Worker — Email Proxy (Terreiro do Candieiro)
 *
 * Recebe POST do admin com payload de email, valida um shared secret,
 * e encaminha pra Resend API com a chave secreta (que NUNCA é exposta
 * no frontend). Permite enviar de domínio próprio sem precisar de Blaze
 * no Firebase nem expor a Resend API key.
 *
 * ── DEPLOY ──────────────────────────────────────────────────────────────
 * 1. Cria conta gratuita em cloudflare.com (se ainda não tem)
 * 2. Dashboard → Workers & Pages → Create application → Create Worker
 * 3. Cola este arquivo no editor (substitui o "Hello World" default)
 * 4. Deploy
 * 5. Em "Settings → Variables", adiciona 3 variáveis de ambiente
 *    (clica "Encrypt" nas duas secretas):
 *      - RESEND_API_KEY  (encrypt)  → re_xxxxxxxxxxxxxxxxx
 *      - ADMIN_SECRET    (encrypt)  → palavra random só sua (ex: candieiro-mil-asas-2026)
 *      - DEFAULT_FROM              → "Terreiro do Candieiro <contato@terreirodocandieiro.com.br>"
 * 6. (opcional) Restringe CORS em ALLOW_ORIGINS abaixo trocando '*' pela URL
 *    exata do admin (ex: 'https://admin.terreirodocandieiro.com.br')
 * 7. Anota a URL do Worker (ex: https://terreiro-email.SEU-SUBDOMINIO.workers.dev)
 *
 * ── CONFIG NO FIRESTORE ─────────────────────────────────────────────────
 * Cria um doc em adm_config/email no Firestore com:
 *   {
 *     enabled: true,
 *     worker_url: "https://terreiro-email.SEU-SUBDOMINIO.workers.dev",
 *     worker_secret: "candieiro-mil-asas-2026",        // mesmo valor do ADMIN_SECRET
 *     from: "Terreiro do Candieiro <contato@terreirodocandieiro.com.br>",
 *     reply_to: "contato@terreirodocandieiro.com.br"
 *   }
 *
 * ── RESEND ──────────────────────────────────────────────────────────────
 * Crie conta em resend.com (free tier: 100/dia, 3000/mês).
 * Domains → Add Domain → terreirodocandieiro.com.br → cola os registros
 * DNS (SPF, DKIM) no seu provedor (registro.br ou onde tiver o domínio).
 * Espera a verificação (geralmente < 1h).
 * API Keys → Create → escolhe "Sending access" → copia o re_xxx pra ADMIN_SECRET acima.
 */

const ALLOW_ORIGINS = '*'; // pra produção, troca pela URL exata do admin

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOW_ORIGINS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Secret',
      'Access-Control-Max-Age': '86400'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    // Valida shared secret
    const auth = request.headers.get('X-Auth-Secret');
    if (!env.ADMIN_SECRET || auth !== env.ADMIN_SECRET) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
    }

    const { to, to_name, subject, html, text, from, reply_to } = body;
    if (!to || !subject || (!html && !text)) {
      return new Response('Missing required fields (to, subject, html|text)', { status: 400, headers: corsHeaders });
    }

    // Chama Resend
    const resendPayload = {
      from: from || env.DEFAULT_FROM,
      to: [to_name ? `${to_name} <${to}>` : to],
      subject,
      ...(html && { html }),
      ...(text && { text }),
      ...(reply_to && { reply_to })
    };

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(resendPayload)
    });

    const data = await resp.json().catch(() => ({}));

    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
