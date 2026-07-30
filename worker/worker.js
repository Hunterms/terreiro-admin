/**
 * Cloudflare Worker — Terreiro do Candieiro
 *
 * Duas funções, um deploy só:
 *
 *   POST /          → email (Resend). Compat: o admin já chama a raiz.
 *   POST /email     → mesma coisa, nome explícito.
 *   POST /checkout  → cria checkout InfinitePay. Público, sem segredo.
 *                     O VALOR É RECALCULADO AQUI, do Firestore. Nunca vem do cliente.
 *   POST /webhook   → InfinitePay avisa que pagou. Confere no payment_check,
 *                     compara o valor, e só então marca pago no Firestore.
 *
 * ── POR QUE O VALOR É RECALCULADO ─────────────────────────────────────────
 * O cliente é dono do navegador. Se o preço saísse do frontend, dava pra abrir
 * o devtools, trocar 150 por 1 e pagar 1. Então o Worker lê o produto/serviço/
 * evento direto do Firestore e cobra o que está lá. O que o cliente manda é só
 * o id do pedido — nada de dinheiro.
 *
 * A conferência acontece duas vezes:
 *   1. na criação do link  — preço vem do F  irestore, e fica gravado no pedido
 *      (campo `checkout_centavos`, que o público não consegue escrever)
 *   2. no webhook          — payment_check confirma na InfinitePay, e o valor
 *      pago é comparado com o gravado. Menor = não marca pago.
 *
 * Isso importa porque o endpoint /links da InfinitePay não pede autenticação:
 * qualquer um consegue gerar um link de R$1 apontando pro nosso handle. Sem o
 * passo 2, um link desses marcaria o pedido como pago.
 *
 * ── DEPLOY ───────────────────────────────────────────────────────────────
 * Cloudflare → Workers & Pages → o worker que já existe → Edit code → cola
 * este arquivo inteiro → Deploy.
 *
 * Variáveis (Settings → Variables and Secrets):
 *
 *   RESEND_API_KEY       encrypt    re_xxx                        (já existe)
 *   ADMIN_SECRET         encrypt    palavra sua                   (já existe)
 *   DEFAULT_FROM         texto      Terreiro <contato@...>        (já existe)
 *   INFINITEPAY_HANDLE   texto      pai-nando                     ← sem o "$"
 *   SITE_URL             texto      https://hunterms.github.io/terreiro-admin
 *   GCP_SA_EMAIL         texto      xxx@terreiro-pvd.iam.gserviceaccount.com
 *   GCP_SA_KEY           encrypt    -----BEGIN PRIVATE KEY-----\n...
 *   CAND_API_KEY         texto      AIzaSyAViFU3bdl8RKSHBuxMGAc97SPITd1aJWM
 *
 * A service account sai do Firebase Console → Configurações do projeto →
 * Contas de serviço → Gerar nova chave privada. Do JSON baixado, pega
 * `client_email` → GCP_SA_EMAIL, e `private_key` → GCP_SA_KEY (o valor inteiro,
 * com os \n literais que vêm no JSON).
 *
 * A chave da service account escreve no Firestore ignorando as security rules.
 * É de propósito: é ela que marca "pago", e é justamente isso que o público
 * não pode fazer.
 */

const PROJETO_PVD = 'terreiro-pvd';
const PROJETO_CAND = 'terreiro-candieiro';

const IP_LINKS = 'https://api.checkout.infinitepay.io/links';
const IP_CHECK = 'https://api.checkout.infinitepay.io/payment_check';

// Cada tipo de venda: prefixo do order_nsu, collection do pedido, e onde mora o preço.
//
// `statusPago` é diferente em cada uma porque o vocabulário de status é diferente
// em cada uma — e num caso é null de propósito:
//
//   sol  pendente → aprovada    pagar NÃO aprova. Quem aprova é o Pai, porque a
//                               aprovação é que cria o atendimento e ocupa o
//                               horário. O pagamento entra como
//                               comprovante_anexado + metodo_pagamento, e a
//                               tela de aprovação já abre com "já pago" marcado.
//   ped  pendente → confirmado  pagou = confirmado, mesmo status que o admin põe na mão.
//   ins  aguardando → pago
// `campoValor` é o campo de dinheiro que o admin lê depois (relatório, aprovação).
// O cliente escreve ele na criação do doc, então não é confiável: o Worker
// sobrescreve com o valor que de fato cobrou.
// `statusAguardando` é o status enquanto o pagamento não entrou. Quem escreve
// ele é o Worker, ao gerar o link — não a página. A ordem importa: a página
// cria o pedido como 'pendente' (igual sempre), e só se o link for gerado ele
// sai da fila do admin. Se o checkout falhar e a pessoa pagar no PIX manual, o
// pedido continua 'pendente' e o Pai vê normalmente. Nenhum pedido some por
// causa de erro nosso.
//
// evento_inscricoes já nasce 'aguardando', que ali sempre significou não pago —
// não tem o que mudar.
const TIPOS = {
  sol: { colecao: 'adm_solicitacoes',  fonte: 'adm_servicos',    refCampo: 'servico_id', projetoFonte: PROJETO_PVD,  statusPago: null,         statusAguardando: 'aguardando_pagamento', campoValor: 'valor_proposto' },
  ped: { colecao: 'vendas_pedidos',    fonte: 'vendas_produtos', refCampo: 'produto_id', projetoFonte: PROJETO_PVD,  statusPago: 'confirmado', statusAguardando: 'aguardando_pagamento', campoValor: 'valor'          },
  ins: { colecao: 'evento_inscricoes', fonte: 'eventos',         refCampo: 'evento_id',  projetoFonte: PROJETO_CAND, statusPago: 'pago',       statusAguardando: null,                   campoValor: 'valor'          },
};

const ALLOW_ORIGINS = '*'; // pra apertar, troca pela URL exata do admin

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGINS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Secret',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    const rota = url.pathname.replace(/\/+$/, '');

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }

    try {
      if (rota === '/checkout') return await rotaCheckout(body, env, url.origin);
      if (rota === '/status') return await rotaStatus(body, env);
      if (rota === '/webhook') return await rotaWebhook(body, env);
      return await rotaEmail(body, request, env); // '' e '/email'
    } catch (e) {
      console.error(rota, e?.stack || e);
      return json({ error: e?.message || 'erro interno' }, 500);
    }
  },
};

// ── EMAIL ──────────────────────────────────────────────────────────────────
// Igual ao que era antes. Protegido por shared secret.

async function rotaEmail(body, request, env) {
  const auth = request.headers.get('X-Auth-Secret');
  if (!env.ADMIN_SECRET || auth !== env.ADMIN_SECRET) return json({ error: 'Forbidden' }, 403);

  const { to, to_name, subject, html, text, from, reply_to } = body;
  if (!to || !subject || (!html && !text)) {
    return json({ error: 'Faltam campos (to, subject, html|text)' }, 400);
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || env.DEFAULT_FROM,
      to: [to_name ? `${to_name} <${to}>` : to],
      subject,
      ...(html && { html }),
      ...(text && { text }),
      ...(reply_to && { reply_to }),
    }),
  });

  return json(await resp.json().catch(() => ({})), resp.status);
}

// ── PREÇO ──────────────────────────────────────────────────────────────────
// Espelha precoEfetivo() do vendas.html. Se mudar lá, muda aqui.
// Exportado puro pra dar pra testar sem Worker: `node worker/test-preco.mjs`.

export function precoCentavos(tipo, pedido, fonte, hoje) {
  const reais = (() => {
    if (tipo === 'sol') return Number(fonte.valor) || 0;
    if (tipo === 'ins') return Number(fonte.valor) || 0;

    // ped: desconto afirmativo ganha da promo; promo só vale dentro do prazo.
    const afirmativo = fonte.desconto_afirmativo;
    if (pedido.desconto_afirmativo && afirmativo?.ativo && afirmativo.valor != null) {
      return Number(afirmativo.valor) || 0;
    }
    if (fonte.promo_ativa && fonte.promo_valor && fonte.promo_ate && hoje <= fonte.promo_ate) {
      return Number(fonte.promo_valor) || 0;
    }
    return Number(fonte.valor) || 0;
  })();

  return Math.round(reais * 100);
}

// Busca o item que dá o preço e calcula o valor devido, em centavos.
// Usado nas DUAS rotas — e no webhook o valor é recalculado do zero, não lido
// do pedido. Motivo: as regras do Firestore deixam o público criar o doc do
// pedido, e nada impede alguém de já criar ele com um `checkout_centavos: 1`
// plantado. Se o webhook confiasse nesse campo, dava pra montar um link de R$1
// na mão (o /links da InfinitePay é aberto), pagar, e o webhook aceitaria.
// Recalculando, o número vem sempre do produto/serviço/evento.
async function valorEsperado(tipo, pedido, env, token) {
  const t = TIPOS[tipo];
  const refId = pedido[t.refCampo];
  if (!refId) return { erro: `pedido sem ${t.refCampo}` };

  const fonte = await fsGet(t.projetoFonte, t.fonte, refId, {
    token: t.projetoFonte === PROJETO_PVD ? token : null,
    apiKey: t.projetoFonte === PROJETO_CAND ? env.CAND_API_KEY : null,
  });
  if (!fonte) return { erro: 'item não encontrado' };

  const hoje = new Date().toISOString().slice(0, 10);
  const centavos = precoCentavos(tipo, pedido, fonte, hoje);
  if (centavos <= 0) return { erro: 'item sem valor definido' };

  return { centavos, fonte };
}

// ── CHECKOUT ───────────────────────────────────────────────────────────────
// Entra: { tipo, doc_id }. Sai: { url }.
// Nada de valor no request — de propósito.

async function rotaCheckout(body, env, origem) {
  const { tipo, doc_id } = body;
  const t = TIPOS[tipo];
  if (!t) return json({ error: 'tipo inválido' }, 400);
  if (!doc_id || typeof doc_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(doc_id)) {
    return json({ error: 'doc_id inválido' }, 400);
  }
  if (!env.INFINITEPAY_HANDLE) return json({ error: 'INFINITEPAY_HANDLE não configurado' }, 500);

  const token = await tokenGoogle(env);

  const pedido = await fsGet(PROJETO_PVD, t.colecao, doc_id, { token });
  if (!pedido) return json({ error: 'pedido não encontrado' }, 404);
  if (pedido.pago_automatico) return json({ error: 'pedido já está pago' }, 409);

  const { centavos, fonte, erro } = await valorEsperado(tipo, pedido, env, token);
  if (erro) return json({ error: erro }, 422);

  const order_nsu = `${tipo}_${doc_id}`;
  const descricao = (fonte.nome || fonte.titulo || pedido.produto_nome || 'Terreiro do Candieiro').slice(0, 120);

  const resp = await fetch(IP_LINKS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: env.INFINITEPAY_HANDLE,
      order_nsu,
      redirect_url: `${env.SITE_URL}/pago.html?tipo=${tipo}&id=${doc_id}`,
      webhook_url: `${origem}/webhook`, // o Worker sabe o próprio endereço: nada pra configurar
      items: [{ quantity: 1, price: centavos, description: descricao }],
      ...(pedido.nome && {
        customer: {
          name: String(pedido.nome).slice(0, 120),
          ...(pedido.email && { email: pedido.email }),
          ...(pedido.tel && { phone_number: String(pedido.tel).replace(/\D/g, '') }),
        },
      }),
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.url) {
    console.error('InfinitePay /links falhou', resp.status, JSON.stringify(data));
    return json({ error: 'não consegui criar o checkout', detalhe: data }, 502);
  }

  // Grava o valor esperado. É contra isso que o webhook vai comparar depois.
  // E corrige o campo de dinheiro do pedido: quem manda é este cálculo, não o
  // que o cliente escreveu.
  await fsPatch(PROJETO_PVD, t.colecao, doc_id, token, {
    checkout_centavos: centavos,
    checkout_order_nsu: order_nsu,
    checkout_url: data.url,
    checkout_criadoEm: new Date().toISOString(),
    [t.campoValor]: centavos / 100,
    // Sai da fila do admin até o pagamento entrar. Só acontece aqui, depois de
    // o link existir de verdade — ver comentário do TIPOS.
    ...(t.statusAguardando && { status: t.statusAguardando }),
  });

  return json({ url: data.url, valor_centavos: centavos });
}

// ── STATUS ─────────────────────────────────────────────────────────────────
// Entra: { tipo, doc_id, transaction_nsu?, slug?, receipt_url? }.
// Sai: { pago, metodo, recibo_url, divergente }.
//
// Existe pra tela de retorno (pago.html) poder dizer a verdade. Ela não
// consegue ler o pedido no Firestore (as rules exigem auth, e é pra exigir).
//
// E faz mais do que ler: se o pedido ainda não está pago e a volta trouxe
// transaction_nsu + slug, ele CONFIRMA na InfinitePay ali mesmo. Assim a
// confirmação não depende do webhook chegar — que é justamente o que falhou
// no primeiro teste. Webhook e volta são dois caminhos pro mesmo lugar, e
// quem chegar primeiro resolve; o segundo vê que já está pago e não faz nada.
//
// Público, sem segredo: precisa do id do pedido pra perguntar, a resposta não
// leva nome nem telefone de ninguém, e o que decide é o payment_check.

async function rotaStatus(body, env) {
  const { tipo, doc_id, transaction_nsu, slug, receipt_url } = body;
  const t = TIPOS[tipo];
  if (!t) return json({ error: 'tipo inválido' }, 400);
  if (!doc_id || typeof doc_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(doc_id)) {
    return json({ error: 'doc_id inválido' }, 400);
  }

  const token = await tokenGoogle(env);
  const pedido = await fsGet(PROJETO_PVD, t.colecao, doc_id, { token });
  if (!pedido) return json({ error: 'pedido não encontrado' }, 404);

  const responder = (p) => json({
    pago: p.pago_automatico === true,
    metodo: p.pago_automatico ? p.metodo_pagamento || null : null,
    recibo_url: p.pagamento_recibo_url || null,
    divergente: !!p.pagamento_suspeito,
  });

  if (pedido.pago_automatico === true || pedido.pagamento_suspeito) return responder(pedido);
  if (!transaction_nsu || !slug) return responder(pedido);

  const registrar = (resultado, detalhe) =>
    fsCreate(PROJETO_PVD, 'adm_webhook_log', token, {
      recebidoEm: new Date().toISOString(),
      resultado,
      detalhe: detalhe || null,
      order_nsu: `${tipo}_${doc_id}`,
      transaction_nsu: transaction_nsu || null,
      corpo_cru: `via /status (volta do checkout): ${JSON.stringify(body).slice(0, 2000)}`,
    }).catch((e) => console.error('log falhou', e));

  const r = await confirmarNaInfinitePay(
    {
      tipo, t, doc_id, pedido,
      order_nsu: `${tipo}_${doc_id}`,
      transaction_nsu,
      invoice_slug: slug,
      receipt_url,
    },
    env,
    token,
    registrar
  );

  if (r.ok) {
    return json({ pago: true, metodo: r.metodo === 'pix' ? 'pix' : 'cartao', recibo_url: receipt_url || null, divergente: false });
  }
  if (r.http === 422) return json({ pago: false, divergente: true });
  return json({ pago: false, divergente: false });
}

// ── WEBHOOK ────────────────────────────────────────────────────────────────
// A InfinitePay não assina o webhook, então o corpo dele não é prova de nada.
// A prova vem do payment_check + da comparação de valor.

async function rotaWebhook(body, env) {
  const { order_nsu, transaction_nsu, invoice_slug, capture_method, receipt_url, installments } = body;

  // Grava TODO webhook que chega, com o corpo cru e o desfecho, em
  // adm_webhook_log. Sem isso, webhook que falha é invisível: a InfinitePay
  // não mostra o erro e o log do Cloudflare expira. Dá pra ler no Firebase
  // Console → Firestore → adm_webhook_log.
  const token = await tokenGoogle(env);
  const registrar = (resultado, detalhe) =>
    fsCreate(PROJETO_PVD, 'adm_webhook_log', token, {
      recebidoEm: new Date().toISOString(),
      resultado,
      detalhe: detalhe || null,
      order_nsu: order_nsu || null,
      transaction_nsu: transaction_nsu || null,
      corpo_cru: JSON.stringify(body).slice(0, 4000),
    }).catch((e) => console.error('log falhou', e));

  if (!order_nsu) {
    await registrar('recusado', 'sem order_nsu no corpo do webhook');
    return json({ error: 'sem order_nsu' }, 400);
  }

  const [tipo, doc_id] = String(order_nsu).split('_');
  const t = TIPOS[tipo];
  if (!t || !doc_id) {
    await registrar('recusado', `order_nsu fora do formato esperado: ${order_nsu}`);
    return json({ error: 'order_nsu desconhecido' }, 400);
  }
  const pedido = await fsGet(PROJETO_PVD, t.colecao, doc_id, { token });
  if (!pedido) {
    await registrar('recusado', `pedido ${t.colecao}/${doc_id} não existe`);
    return json({ error: 'pedido não existe' }, 400);
  }

  // Já processado: responde ok sem escrever de novo (a InfinitePay reenvia).
  if (pedido.pagamento_transaction_nsu && pedido.pagamento_transaction_nsu === transaction_nsu) {
    await registrar('repetido', 'mesmo transaction_nsu já processado');
    return json({ success: true, ja_processado: true });
  }

  const r = await confirmarNaInfinitePay(
    { tipo, t, doc_id, pedido, order_nsu, transaction_nsu, invoice_slug, capture_method, receipt_url, installments },
    env,
    token,
    registrar
  );

  if (r.ok) return json({ success: true });
  return json({ error: r.erro }, r.http);
}

// ── CONFIRMAÇÃO ────────────────────────────────────────────────────────────
// O ato de marcar pago mora aqui, num lugar só, porque tem dois caminhos que
// levam a ele:
//
//   webhook  — a InfinitePay avisa. Pega quem fechou a aba e foi embora.
//   volta    — a pessoa cai no pago.html, que traz transaction_nsu e slug na
//              URL. Pega quando o webhook não chega.
//
// Os dois passam pelas MESMAS duas provas: payment_check confirma na
// InfinitePay, e o valor é recalculado da fonte e comparado. Por isso não
// importa que os dados da volta venham do cliente: ele pode inventar um
// transaction_nsu, mas não consegue fazer o payment_check dizer "paid" pro
// nosso handle com o nosso order_nsu.
async function confirmarNaInfinitePay(d, env, token, registrar = () => {}) {
  const { tipo, t, doc_id, pedido, order_nsu, transaction_nsu, invoice_slug } = d;

  // 1ª prova: a própria InfinitePay confirma.
  const checkResp = await fetch(IP_CHECK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: env.INFINITEPAY_HANDLE,
      order_nsu,
      transaction_nsu,
      slug: invoice_slug,
    }),
  });
  const check = await checkResp.json().catch(() => ({}));

  if (!checkResp.ok || check.paid !== true) {
    console.warn('payment_check negou', order_nsu, checkResp.status, JSON.stringify(check));
    await registrar('nao_confirmado', `payment_check HTTP ${checkResp.status}: ${JSON.stringify(check).slice(0, 500)}`);
    return { erro: 'pagamento não confirmado', http: 400 }; // 400 = InfinitePay tenta de novo
  }

  // 2ª prova: o valor cobrado bate com o preço real do item.
  // Recalculado aqui, não lido do pedido — ver comentário do valorEsperado().
  const { centavos: esperado, erro } = await valorEsperado(tipo, pedido, env, token);
  const cobrado = Number(check.amount) || 0;
  if (erro || !esperado) {
    console.error('não consegui recalcular o valor', order_nsu, erro);
    await registrar('recusado', `não consegui recalcular o valor: ${erro || 'sem valor'}`);
    return { erro: erro || 'pedido sem valor esperado', http: 400 };
  }
  if (cobrado < esperado) {
    console.error(`valor menor que o esperado: ${cobrado} < ${esperado}`, order_nsu);
    await fsPatch(PROJETO_PVD, t.colecao, doc_id, token, {
      pagamento_suspeito: `cobrado ${cobrado} < esperado ${esperado}`,
      pagamento_suspeitoEm: new Date().toISOString(),
    });
    await registrar('valor_divergente', `cobrado ${cobrado} < esperado ${esperado}`);
    return { erro: 'valor divergente', http: 422 }; // 422 não pede retry: não vai melhorar
  }

  // capture_method só vem no webhook; na volta pega o do payment_check.
  const metodo = d.capture_method || check.capture_method;

  await fsPatch(PROJETO_PVD, t.colecao, doc_id, token, {
    ...(t.statusPago && { status: t.statusPago }),
    metodo_pagamento: metodo === 'pix' ? 'pix' : 'cartao',
    pago_automatico: true,
    pagoEm: new Date().toISOString(),
    pagamento_transaction_nsu: transaction_nsu || null,
    pagamento_slug: invoice_slug || null,
    pagamento_centavos: cobrado,
    pagamento_parcelas: Number(d.installments || check.installments) || 1,
    pagamento_recibo_url: d.receipt_url || null,
    comprovante_anexado: true, // pagou pelo checkout: não precisa mandar print
  });

  await registrar('pago', `${t.colecao}/${doc_id} marcado pago, ${cobrado} centavos`);
  return { ok: true, centavos: cobrado, metodo };
}

// ── FIRESTORE REST ─────────────────────────────────────────────────────────
// Sem SDK: o Firebase Admin não roda em Worker. REST v1 na mão.

function fsUrl(projeto, colecao, id) {
  return `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/${colecao}/${id}`;
}

async function fsGet(projeto, colecao, id, { token, apiKey } = {}) {
  const url = fsUrl(projeto, colecao, id) + (apiKey ? `?key=${apiKey}` : '');
  const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Firestore GET ${colecao}/${id}: ${resp.status} ${await resp.text()}`);
  const doc = await resp.json();
  return desembrulha({ mapValue: { fields: doc.fields || {} } });
}

// Cria doc com id automático. Usado só pelo log de webhook.
async function fsCreate(projeto, colecao, token, campos) {
  const url = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/${colecao}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: embrulha(campos).mapValue.fields }),
  });
  if (!resp.ok) console.error(`Firestore CREATE ${colecao}: ${resp.status} ${await resp.text()}`);
}

async function fsPatch(projeto, colecao, id, token, campos) {
  const mask = Object.keys(campos).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const resp = await fetch(`${fsUrl(projeto, colecao, id)}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: embrulha(campos).mapValue.fields }),
  });
  if (!resp.ok) throw new Error(`Firestore PATCH ${colecao}/${id}: ${resp.status} ${await resp.text()}`);
}

function desembrulha(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(desembrulha);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = desembrulha(val);
    return out;
  }
  return null;
}

function embrulha(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(embrulha) } };
  const fields = {};
  for (const [k, val] of Object.entries(v)) fields[k] = embrulha(val);
  return { mapValue: { fields } };
}

// ── OAUTH GOOGLE (service account) ─────────────────────────────────────────
// JWT assinado RS256 → access token. WebCrypto dá conta; sem dependência.

let tokenCache = { valor: null, expira: 0 };

async function tokenGoogle(env) {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenCache.valor && tokenCache.expira - 60 > agora) return tokenCache.valor;

  if (!env.GCP_SA_EMAIL || !env.GCP_SA_KEY) {
    throw new Error('GCP_SA_EMAIL / GCP_SA_KEY não configurados no Worker');
  }

  const claim = {
    iss: env.GCP_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  };

  const cabeca = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify(claim));
  const chave = await importaChave(env.GCP_SA_KEY);
  const assinatura = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    chave,
    new TextEncoder().encode(`${cabeca}.${corpo}`)
  );
  const jwt = `${cabeca}.${corpo}.${b64url(assinatura)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`OAuth Google falhou: ${resp.status} ${JSON.stringify(data)}`);
  }

  tokenCache = { valor: data.access_token, expira: agora + (data.expires_in || 3600) };
  return tokenCache.valor;
}

async function importaChave(pem) {
  const corpo = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function b64url(entrada) {
  const bytes = typeof entrada === 'string' ? new TextEncoder().encode(entrada) : new Uint8Array(entrada);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
