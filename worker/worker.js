/**
 * Cloudflare Worker — Terreiro do Candieiro
 *
 * Um deploy, cinco assuntos: email, checkout, mensalidade, papéis e push.
 *
 *   POST /            → email (Resend). Compat: o admin já chama a raiz.
 *   POST /email       → mesma coisa, nome explícito.
 *   POST /checkout    → cria checkout InfinitePay. Público, sem segredo.
 *                       O VALOR É RECALCULADO AQUI, do Firestore. Nunca vem do cliente.
 *   POST /status      → a tela de retorno pergunta se pagou. Confirma no payment_check.
 *   POST /webhook     → InfinitePay avisa que pagou. Confere no payment_check,
 *                       compara o valor, e só então marca pago no Firestore.
 *   POST /filhos     → o elenco pro seletor, SEM telefone/valor/email/obs.
 *                       Público: é o que as páginas sem login mostram.
 *   POST /entrar     → confere PIN (ou telefone, na primeira vez) e devolve
 *                       uma sessão assinada. A conferência era no navegador,
 *                       contra dado que o navegador tinha baixado.
 *   POST /avisos     → a caixa de avisos do filho. O push é entrega; ISTO é
 *                       o registro, e é o único canal que alcança os 31 que
 *                       não têm email.
 *   POST /avisos-lidos → marca tudo até agora como lido.
 *   POST /criar-pin  → o filho escolhe o PIN. Obrigatório na primeira vez.
 *   POST /zerar-pin  → admin devolve alguém pro modo telefone (esqueceu).
 *   POST /meu-cadastro → o filho grava a própria data de nascimento e email.
 *                       Só esses dois; o resto do cadastro é da administração.
 *   POST /mensalidade → quanto o filho deve neste mês (prova: 4 dígitos do tel).
 *   POST /mensalidade-ajuste → o filho remarca a data OU pede isenção do mês.
 *                       Só até o dia 5, só o mês corrente, mesma prova.
 *   POST /lote        → gera as cobranças do mês. Também roda pelo cron do dia 1.
 *   POST /papel       → grava custom claim (admin/financeiro/loja) numa conta.
 *   POST /lembretes   → { dry: true } devolve a lista de quem deve receber o
 *                       lembrete de mensalidade; { filho_id } manda pra UM.
 *                       Nunca dispara sozinho — quem aprova é o admin.
 *   POST /push        → manda notificação pros celulares (FCM). Alvo por papel
 *                       ('admin') ou por filho_id.
 *
 * ── POR QUE O VALOR É RECALCULADO ─────────────────────────────────────────
 * O cliente é dono do navegador. Se o preço saísse do frontend, dava pra abrir
 * o devtools, trocar 150 por 1 e pagar 1. Então o Worker lê o produto/serviço/
 * evento direto do Firestore e cobra o que está lá. O que o cliente manda é só
 * o id do pedido — nada de dinheiro.
 *
 * A conferência acontece duas vezes:
 *   1. na criação do link  — preço vem do Firestore, e fica gravado no pedido
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
 * O push usa a MESMA service account, só com outro escopo OAuth
 * (firebase.messaging). Nada novo pra configurar além de habilitar a
 * "Firebase Cloud Messaging API (V1)" no projeto — ver PUSH.md.
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
//
// `valorFixado` diz de onde vem o valor esperado na confirmação:
//   false → recalcula da fonte. Obrigatório onde o PÚBLICO cria o pedido, porque
//           aí nada gravado no doc é confiável.
//   true  → usa o que foi fixado em checkout_centavos ao gerar o link. Só vale
//           onde o público não escreve (mensalidade nasce do lote do admin).
//           Necessário porque a multa depende da data: link de R$200 gerado dia
//           5 e pago dia 12 daria "divergente" se recalculasse.
const TIPOS = {
  sol: { colecao: 'adm_solicitacoes',       fonte: 'adm_servicos',    refCampo: 'servico_id', projetoFonte: PROJETO_PVD,  statusPago: null,         statusAguardando: 'aguardando_pagamento', campoValor: 'valor_proposto', valorFixado: false },
  ped: { colecao: 'vendas_pedidos',         fonte: 'vendas_produtos', refCampo: 'produto_id', projetoFonte: PROJETO_PVD,  statusPago: 'confirmado', statusAguardando: 'aguardando_pagamento', campoValor: 'valor',          valorFixado: false },
  ins: { colecao: 'evento_inscricoes',      fonte: 'eventos',         refCampo: 'evento_id',  projetoFonte: PROJETO_CAND, statusPago: 'pago',       statusAguardando: null,                   campoValor: 'valor',          valorFixado: false },
  men: { colecao: 'fin_mensalidade_pedidos', fonte: 'fin_filhos',     refCampo: 'filho_id',   projetoFonte: PROJETO_PVD,  statusPago: 'pago',       statusAguardando: null,                   campoValor: null,             valorFixado: true  },
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

/**
 * Confere o shared secret das rotas privadas. Devolve null se passou, ou a
 * resposta de erro.
 *
 * Distingue os três casos de propósito — antes os três davam o mesmo
 * "Forbidden" e não havia como saber de qual lado estava o problema:
 *   variável não configurada no Worker · header ausente · valor diferente
 *
 * Nenhuma das mensagens revela o segredo, e a de "não configurada" é sobre o
 * Worker, não sobre quem chamou.
 */
function checarSegredo(request, env) {
  if (!env.ADMIN_SECRET) {
    return json({ error: 'ADMIN_SECRET não está configurada neste Worker (Settings → Variables)' }, 500);
  }
  const enviado = request.headers.get('X-Auth-Secret');
  if (!enviado) return json({ error: 'falta o header X-Auth-Secret' }, 401);
  if (enviado !== env.ADMIN_SECRET) {
    return json({ error: 'X-Auth-Secret não confere com o ADMIN_SECRET do Worker' }, 403);
  }
  return null;
}

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
      if (rota === '/lote') return await rotaLote(body, request, env);
      if (rota === '/filhos') return await rotaFilhos(env);
      if (rota === '/entrar') return await rotaEntrar(body, env);
      if (rota === '/avisos') return await rotaAvisos(body, env);
      if (rota === '/avisos-lidos') return await rotaAvisosLidos(body, env);
      if (rota === '/criar-pin') return await rotaCriarPin(body, env);
      if (rota === '/zerar-pin') return await rotaZerarPin(body, request, env);
      if (rota === '/meu-cadastro') return await rotaMeuCadastro(body, env);
      if (rota === '/mensalidade') return await rotaMensalidade(body, env);
      if (rota === '/mensalidade-ajuste') return await rotaMensalidadeAjuste(body, env);
      if (rota === '/papel') return await rotaPapel(body, request, env);
      if (rota === '/lembretes') return await rotaLembretes(body, request, env);
      if (rota === '/push') return await rotaPush(body, request, env);
      return await rotaEmail(body, request, env); // '' e '/email'
    } catch (e) {
      console.error(rota, e?.stack || e);
      return json({ error: e?.message || 'erro interno' }, 500);
    }
  },

  // ── CRON: UM SÓ ──────────────────────────────────────────────────────────
  // Cloudflare → o Worker → Settings → Triggers → Cron Triggers:
  //
  //   */15 * * * *      e mais nenhum
  //
  // Era dois ("0 9 1 * *" e "0 12 * * *"). Virou um porque o Worker tem teto de
  // subrequests por invocação, e cron separado por assunto multiplica gatilho
  // sem multiplicar teto. Quem decide o que roda agora é o relógio de Brasília,
  // aqui dentro, com marca no Firestore pra não repetir (ver `tick`).
  //
  // A cada 15 minutos:  novidade desde o último olhar → push pro admin
  // 9h de Brasília:     digest do dia (atrasos, contas, quem vence amanhã)
  // dia 1, a partir das 6h: gera o lote de mensalidade do ciclo
  //
  // O que o cron NÃO faz mais: mandar email de mensalidade pro filho. Isso
  // agora é ato do admin — ele revisa a lista, tira quem não deve receber, e
  // aprova. O cron só cutuca ("10 vencem amanhã") e a decisão continua humana.
  async scheduled(event, env, ctx) {
    console.log('cron', JSON.stringify(await tick(env)));
  },
};

// Data e ciclo no fuso do terreiro, não em UTC. Importa: às 21h30 de Brasília
// o UTC já virou o dia seguinte, e a multa cairia algumas horas antes da hora.
function hojeSP() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function cicloAtual() {
  return hojeSP().slice(0, 7); // YYYY-MM
}
/**
 * Hora cheia em Brasília, 0..23.
 *
 * `hourCycle: 'h23'` e não `hour12: false`: com o segundo, parte das
 * implementações devolve "24" à meia-noite em vez de "0". O `% 24` é a rede —
 * o dia em que isso acontecer, o digest das 9h não vira digest das 24h.
 */
function horaSP() {
  const h = new Date().toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23',
  });
  return (Number(h) || 0) % 24;
}
/** Minutos desde a meia-noite em Brasília. É o relógio do lembrete de 1h. */
function minutosSP() {
  const s = new Date().toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return minutosDoDia(s.replace(/^(\d{1,2}):(\d{2}).*$/, '$1:$2')) ?? 0;
}
/** Soma dias a uma data ISO (YYYY-MM-DD) sem passar por fuso. */
export function maisDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── EMAIL ──────────────────────────────────────────────────────────────────
// Igual ao que era antes. Protegido por shared secret.

async function rotaEmail(body, request, env) {
  const barrado = checarSegredo(request, env);
  if (barrado) return barrado;

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

export const MULTA_ATRASO = 10;

/**
 * Último dia do mês de um ciclo "YYYY-MM". Existe porque o financeiro usa 31
 * como atalho pra 'ultimo', e em mês de 30 dias isso faria o vencimento nunca
 * chegar — pra exibir tanto faz, pra cobrar multa não.
 */
export function ultimoDiaDoCiclo(ciclo) {
  const [a, m] = String(ciclo).split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/**
 * Vencimento da mensalidade daquele ciclo, em ISO. Espelha o getPrazoNum() do
 * financeiro: '10'|'15'|'20' → o dia, 'ultimo' → último dia do mês.
 * 'combinado' e vazio não têm data, então retornam null — e sem data não há
 * multa automática.
 *
 * `combinado` é a data que o próprio filho escolheu pra ESTE mês (rota
 * /mensalidade-ajuste, até o dia 5). Vale só dentro do ciclo dela: o prefixo é
 * conferido de propósito, senão uma data de outro mês gravada no pedido — por
 * erro ou por má fé — adiaria a multa pra sempre.
 */
export function vencimentoMensalidade(prazo, ciclo, combinado) {
  if (combinado && String(combinado).startsWith(`${ciclo}-`)) return String(combinado);
  const dia =
    !prazo || prazo === '10' ? 10 :
    prazo === '15' ? 15 :
    prazo === '20' ? 20 :
    prazo === 'ultimo' ? ultimoDiaDoCiclo(ciclo) :
    null; // 'combinado' ou valor desconhecido
  if (dia === null) return null;
  return `${ciclo}-${String(dia).padStart(2, '0')}`;
}

/**
 * Mensalidade devida, em reais. Regra combinada:
 *   base + R$10 se passou do vencimento DELE e ele não avisou do atraso.
 *
 * A base vem de fin_filhos.valor, sempre na hora — nunca de cópia no pedido.
 * É o que faz mudar o valor ou o prazo de um filho no meio do mês funcionar
 * sem regerar nada (ver MENSALIDADE.md seção 7).
 */
export function mensalidadeReais(pedido, filho, hoje) {
  const base = Number(filho.valor);
  if (!base || base <= 0) return 0; // isento: 0 ou campo ausente

  // Isenção do mês, já aprovada por gente no financeiro. Pedida ainda não vale
  // nada: enquanto está 'pedida' o filho continua devendo o mês inteiro.
  if (pedido.isencao_status === 'aprovada') return 0;

  const venc = vencimentoMensalidade(filho.prazo, pedido.ciclo, pedido.venc_combinado);
  const atrasado = !!venc && hoje > venc;
  const multa = atrasado && !pedido.avisou_atraso ? MULTA_ATRASO : 0;
  return base + multa;
}

/**
 * A mensalidade está paga? Devolve COMO, ou null.
 *
 *   'checkout' → pagou pelo link (o pedido tem recibo, método, valor congelado)
 *   'manual'   → alguém deu baixa no financeiro: dinheiro na gira, PIX no
 *                telefone do Pai, filho mais velho que não usa a interface
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 * "Pagou" mora em DOIS lugares, e até 01/08 só havia caminho de ida:
 *
 *   fin_mensalidade_pedidos/{filho}__{ciclo}   o Worker escreve ao confirmar
 *   fin_pagamentos/{ciclo}.{filho}             o toggle manual do financeiro
 *
 * O Worker flipava o segundo ao confirmar o primeiro (`marcarPagamentoNoFinanceiro`),
 * mas nada lia de volta. Resultado medido: filha com baixa manual ontem viu
 * "mensalidade atrasada" na área dela, com acréscimo — e teria recebido email
 * de cobrança pela lista de lembretes.
 *
 * A saída não é copiar o booleano pro pedido. É DERIVAR, todas as vezes, dos
 * dois — mesma regra do valor (MENSALIDADE.md §7): copiar faria "desmarquei no
 * financeiro" deixar o pedido pago pra sempre, que é a mesma divergência ao
 * contrário.
 *
 * `fin_pagamentos/{ciclo}` é um doc só, um mapa `{filhoId: true}`: custa UM
 * fsGet pra qualquer quantidade de filhos.
 */
export function estaPago(pedido, pagosDoCiclo, filhoId) {
  if (pedido?.pago_automatico === true || pedido?.status === 'pago') return 'checkout';
  if (pagosDoCiclo && pagosDoCiclo[filhoId] === true) return 'manual';
  return null;
}

/** O mapa `{filhoId: true}` do ciclo. Doc que não existe vira `{}`. */
async function pagosDoCiclo(ciclo, token) {
  return (await fsGet(PROJETO_PVD, 'fin_pagamentos', ciclo, { token })) || {};
}

export function precoCentavos(tipo, pedido, fonte, hoje) {
  const reais = (() => {
    if (tipo === 'sol') return Number(fonte.valor) || 0;
    if (tipo === 'ins') return Number(fonte.valor) || 0;
    if (tipo === 'men') return mensalidadeReais(pedido, fonte, hoje);

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

  // Data no fuso do terreiro. Em UTC, das 21h de Brasília em diante já é o dia
  // seguinte — a promo venceria e a multa cairia antes da hora.
  const centavos = precoCentavos(tipo, pedido, fonte, hojeSP());
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

  // Mensalidade tem uma segunda origem de "pago" que não vive no pedido: a
  // baixa manual do financeiro. Sem esta trava, o filho que pagou no PIX do Pai
  // abre a área dele, vê o botão, clica, e paga o mês duas vezes.
  if (tipo === 'men' && pedido.ciclo && pedido.filho_id) {
    const como = estaPago(pedido, await pagosDoCiclo(pedido.ciclo, token), pedido.filho_id);
    if (como) return json({ error: 'esta contribuição já consta como paga' }, 409);
  }

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
    ...(t.campoValor && { [t.campoValor]: centavos / 100 }),
    // Sai da fila do admin até o pagamento entrar. Só acontece aqui, depois de
    // o link existir de verdade — ver comentário do TIPOS.
    ...(t.statusAguardando && { status: t.statusAguardando }),
    // Mensalidade grava a decomposição da oferta: é o que vai virar
    // multa_aplicada / vencimento_aplicado quando pagar, sem recalcular depois.
    ...(tipo === 'men' && {
      checkout_valor_base: Number(fonte.valor) || 0,
      checkout_multa: Math.max(0, centavos / 100 - (Number(fonte.valor) || 0)),
      checkout_vencimento: vencimentoMensalidade(fonte.prazo, pedido.ciclo, pedido.venc_combinado),
    }),
  });

  return json({ url: data.url, valor_centavos: centavos });
}

// ── PAPÉIS (custom claims) ─────────────────────────────────────────────────
// Entra: { email, papeis: ['admin'] | ['financeiro','loja'] | [] }.
// Protegido pelo shared secret. Lista os papéis de um email se vier só o email.
//
// Custom claim NÃO se põe pelo console do Firebase — exige chamada privilegiada.
// O Worker já tem a service account, então é o lugar natural. Sem isso, "papel"
// seria só comentário: as rules não teriam em que se apoiar.
//
// ⚠️ O claim só entra no token DEPOIS de o usuário renovar a sessão. Quem já
// está logado precisa sair e entrar de novo, ou esperar ~1h. Por isso as rules
// têm rede de segurança por email (ver firestore.rules.pvd) — sem ela, publicar
// as rules antes de todos renovarem tranca os três apps de uma vez.

const PAPEIS_VALIDOS = ['admin', 'financeiro', 'loja'];

async function rotaPapel(body, request, env) {
  const barrado = checarSegredo(request, env);
  if (barrado) return barrado;

  const email = String(body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'email inválido' }, 400);

  const token = await tokenGoogle(env, ESCOPO_AUTH);
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${PROJETO_PVD}/accounts`;

  // Acha o uid pelo email
  const lookup = await fetch(`${base}:lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  const achado = await lookup.json().catch(() => ({}));
  if (!lookup.ok) return json({ error: 'lookup falhou', detalhe: achado }, 502);

  const user = achado.users?.[0];
  if (!user) return json({ error: `nenhuma conta com o email ${email}` }, 404);

  const atuais = (() => {
    try { return JSON.parse(user.customAttributes || '{}'); } catch { return {}; }
  })();

  // Sem `papeis` no body: só consulta, não escreve.
  if (!Array.isArray(body?.papeis)) {
    return json({ email, uid: user.localId, papeis_atuais: atuais });
  }

  const invalidos = body.papeis.filter((p) => !PAPEIS_VALIDOS.includes(p));
  if (invalidos.length) {
    return json({ error: `papel inválido: ${invalidos.join(', ')}`, validos: PAPEIS_VALIDOS }, 400);
  }

  const novos = {};
  for (const p of body.papeis) novos[p] = true;

  const upd = await fetch(`${base}:update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: user.localId, customAttributes: JSON.stringify(novos) }),
  });
  const res = await upd.json().catch(() => ({}));
  if (!upd.ok) return json({ error: 'não consegui gravar o papel', detalhe: res }, 502);

  return json({
    ok: true,
    email,
    uid: user.localId,
    antes: atuais,
    agora: novos,
    aviso: 'só vale no token depois de sair e entrar de novo em cada app',
  });
}

// ── LOTE DE MENSALIDADE ────────────────────────────────────────────────────
// Entra: { ciclo? }. Protegido pelo mesmo shared secret do email.
// Dois gatilhos, uma função: este endpoint (botão do admin) e o cron do dia 1.

async function rotaLote(body, request, env) {
  const barrado = checarSegredo(request, env);
  if (barrado) return barrado;

  const ciclo = body?.ciclo || cicloAtual();
  if (!/^\d{4}-\d{2}$/.test(ciclo)) return json({ error: 'ciclo inválido (use YYYY-MM)' }, 400);

  return json(await gerarLoteMensalidade(ciclo, env));
}

/**
 * Cria um pedido de mensalidade por filho pagante do ciclo.
 *
 * **Idempotente por construção**: o id é `{filho_id}__{ciclo}` e a criação usa
 * POST com documentId, que devolve 409 se já existe. Rodar duas vezes não
 * duplica nem sobrescreve — e não sobrescrever importa, porque quem já pagou
 * não pode voltar pra 'aberto'.
 *
 * O pedido nasce SEM valor. Valor e vencimento derivam de fin_filhos na hora de
 * pagar, e é isso que faz mudar o cadastro no meio do mês funcionar sem regerar
 * o lote (MENSALIDADE.md seção 7).
 */
async function gerarLoteMensalidade(ciclo, env) {
  const token = await tokenGoogle(env);
  const filhos = await fsList(PROJETO_PVD, 'fin_filhos', token);

  const pagantes = filhos.filter((f) => {
    const ativo = !f.status || f.status === 'ativo';
    const valor = Number(f.valor);
    return ativo && valor > 0; // valor 0 ou ausente = isento, não gera cobrança
  });

  let criados = 0, existentes = 0, falhas = 0;

  for (const f of pagantes) {
    const r = await fsCreateComId(PROJETO_PVD, 'fin_mensalidade_pedidos', `${f.id}__${ciclo}`, token, {
      filho_id: f.id,
      filho_nome: f.nome || '',
      ciclo,
      status: 'aberto',
      avisou_atraso: false,
      geradoEm: new Date().toISOString(),
    });
    if (r === 'criado') criados++;
    else if (r === 'existe') existentes++;
    else falhas++;
  }

  const resumo = {
    ciclo,
    filhos_lidos: filhos.length,
    pagantes: pagantes.length,
    isentos: filhos.length - pagantes.length,
    criados,
    existentes,
    falhas,
  };
  console.log('lote de mensalidade', JSON.stringify(resumo));
  return resumo;
}

// ── LEMBRETE DE VENCIMENTO ─────────────────────────────────────────────────
// Email pro filho com o valor do mês e o link já pronto. Duas rotas, e a
// separação entre elas é o ponto:
//
//   POST /lembretes { dry: true }     → só a LISTA. Não cria pedido, não gera
//                                       link, não manda nada.
//   POST /lembretes { filho_id }      → manda pra UM filho.
//
// Por que um por chamada, e não um lote: o admin revisa a lista, desmarca quem
// não deve receber, e o navegador chama esta rota uma vez por filho aprovado.
// Isso dá a barra de progresso, isola a falha num filho só, e mantém cada
// invocação do Worker longe do teto de subrequests (gerar link + email + gravar
// são 3 por filho; 48 num request só estouraria).
//
// Nada aqui dispara sozinho. O cron só conta quantos vencem amanhã e cutuca o
// admin — quem decide quem recebe é gente.
//
// Um dia antes do vencimento DE CADA UM, não numa data fixa: 45 filhos vencem
// dia 10, mas 8 vencem dia 15, 1 dia 20 e 1 no último dia do mês. Data fixa no
// dia 9 lembraria os 45 e esqueceria os outros 10.
//
// Só manda pra quem tem email (medido em 30/07: 27 dos 48 pagantes). Quem não
// tem aparece na lista com a flag `sem_email`, pra cobrar por WhatsApp.
//
// `lembrete_enviadoEm` continua sendo gravado, mas agora ele AVISA em vez de
// bloquear: a lista mostra "já avisado" e vem desmarcado. Se o admin marcar
// de novo, manda de novo — ele viu e quis.

async function rotaLembretes(body, request, env) {
  const barrado = checarSegredo(request, env);
  if (barrado) return barrado;

  const ciclo = body?.ciclo || cicloAtual();
  if (!/^\d{4}-\d{2}$/.test(ciclo)) return json({ error: 'ciclo inválido (use YYYY-MM)' }, 400);

  if (body?.dry) return json(await listarLembretes(env, ciclo));
  if (!body?.filho_id) return json({ error: 'falta filho_id (ou use dry:true pra ver a lista)' }, 400);
  return json(await enviarLembreteDeUm(env, ciclo, String(body.filho_id)));
}

/**
 * A lista que o admin revisa antes de aprovar. Devolve TODO filho ativo pagante
 * do ciclo — não só quem vence amanhã — porque quem edita a lista precisa ver
 * também o atrasado e o que vence semana que vem. Quem pré-marcar é a tela.
 *
 * Quatro subrequests no total (token + filhos + pedidos do ciclo + baixas
 * manuais), independente de quantos filhos existam: nada aqui é um get por
 * filho.
 */
async function listarLembretes(env, ciclo) {
  const hoje = hojeSP();
  const amanha = maisDias(hoje, 1);
  const token = await tokenGoogle(env);

  const filhos = await fsList(PROJETO_PVD, 'fin_filhos', token);
  const pedidos = await fsQuery(PROJETO_PVD, 'fin_mensalidade_pedidos', token, { campo: 'ciclo', valor: ciclo });
  const porFilho = Object.fromEntries(pedidos.map((p) => [p.filho_id, p]));
  // Sem isto, quem pagou na mão entrava na lista pré-marcado e recebia email
  // cobrando — com acréscimo por atraso.
  const pagos = await pagosDoCiclo(ciclo, token);

  const lista = [];
  for (const f of filhos) {
    if (f.status && f.status !== 'ativo') continue;
    const base = Number(f.valor);
    if (!(base > 0)) continue; // isento não recebe cobrança

    const pedido = porFilho[f.id] || { ciclo, avisou_atraso: false };
    const venc = vencimentoMensalidade(f.prazo, ciclo, pedido.venc_combinado);
    const como = estaPago(pedido, pagos, f.id);
    const valor = mensalidadeReais(pedido, f, hoje);
    const email = String(f.auth_email || f.email || '').trim();

    lista.push({
      filho_id: f.id,
      nome: f.nome || '(sem nome)',
      email: email.includes('@') ? email : null,
      tel: f.tel || f.telefone || null,
      base,
      valor,
      multa: Math.max(0, valor - base),
      vencimento: venc,          // null = prazo 'combinado', sem data
      // Data que o próprio filho escolheu pra este mês, se escolheu. Fica
      // separada de `vencimento` porque quem lê a lista precisa saber que a
      // data mudou — e por quem.
      venc_combinado: pedido.venc_combinado || null,
      isencao_status: pedido.isencao_status || null,  // 'pedida'|'aprovada'|'recusada'
      isencao_motivo: pedido.isencao_motivo || null,
      vence_amanha: venc === amanha,
      // Quem pagou não está atrasado, mesmo que a data já tenha passado.
      atrasado: !como && !!venc && hoje > venc,
      avisou_atraso: !!pedido.avisou_atraso,
      pago: !!como,
      pago_como: como,           // 'checkout' | 'manual' | null
      ja_avisado: !!pedido.lembrete_enviadoEm,
      avisado_em: pedido.lembrete_enviadoEm || null,
    });
  }

  lista.sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999') || a.nome.localeCompare(b.nome));
  return { ciclo, hoje, amanha, total: lista.length, lista };
}

/** Manda o lembrete de um filho. Cria o pedido do ciclo se ainda não existir. */
async function enviarLembreteDeUm(env, ciclo, filhoId) {
  const hoje = hojeSP();
  const token = await tokenGoogle(env);

  const f = await fsGet(PROJETO_PVD, 'fin_filhos', filhoId, { token });
  if (!f) return { erro: 'filho não encontrado', filho_id: filhoId };

  const email = String(f.auth_email || f.email || '').trim();
  if (!email.includes('@')) return { erro: 'filho sem email', filho_id: filhoId };

  const docId = `${filhoId}__${ciclo}`;
  let pedido = await fsGet(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, { token });

  // Última porta antes do email sair. A lista já filtra, mas ela pode ter sido
  // carregada meia hora antes de você clicar em enviar — e nesse meio tempo
  // alguém pode ter dado a baixa no financeiro.
  const como = estaPago(pedido, await pagosDoCiclo(ciclo, token), filhoId);
  if (como) return { erro: `já está pago (${como})`, filho_id: filhoId };

  // O pedido do ciclo pode não existir (filho cadastrado depois do lote). O
  // Worker cria; o público não consegue — as rules negam create nesta collection.
  if (!pedido) {
    await fsCreateComId(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, token, {
      filho_id: filhoId, filho_nome: f.nome || '', ciclo,
      status: 'aberto', avisou_atraso: false,
      geradoEm: new Date().toISOString(), geradoPor: 'lembrete',
    });
    pedido = { filho_id: filhoId, ciclo, status: 'aberto', avisou_atraso: false };
  }

  // Isenção aprovada zera o valor. Dizer isso aqui, e não deixar cair no
  // "valor zero (isento?)" genérico: são dois motivos diferentes de não cobrar.
  if (pedido.isencao_status === 'aprovada') {
    return { erro: 'isenção aprovada neste mês', filho_id: filhoId };
  }

  const valor = mensalidadeReais(pedido, f, hoje);
  if (!(valor > 0)) return { erro: 'valor zero (isento?)', filho_id: filhoId };

  const venc = vencimentoMensalidade(f.prazo, ciclo, pedido.venc_combinado);
  const link = await gerarLinkMensalidade(f, pedido, docId, valor, env, token);
  if (!link) return { erro: 'não consegui gerar o link de pagamento', filho_id: filhoId };

  // 'combinado' não tem data: o email fala de mês, não de dia.
  const assunto =
    !venc ? `Sua contribuição de ${nomeDoMes(ciclo)}` :
    hoje > venc ? `Sua contribuição de ${nomeDoMes(ciclo)} está em aberto` :
    venc === maisDias(hoje, 1) ? `Sua contribuição de ${nomeDoMes(ciclo)} vence amanhã` :
    `Sua contribuição de ${nomeDoMes(ciclo)} vence dia ${venc.slice(8, 10)}`;

  const enviado = await enviarEmail(env, {
    to: email, to_name: f.nome || '',
    subject: assunto,
    html: emailLembrete(f, ciclo, valor, venc, link, hoje),
  });
  if (!enviado) return { erro: 'o email não saiu (Resend)', filho_id: filhoId };

  await fsPatch(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, token, {
    lembrete_enviadoEm: new Date().toISOString(),
    lembrete_valor: valor,
  });

  // O email alcança 29 dos 56. Os outros 27 só ficam sabendo se estiver escrito
  // na área deles — e agora está, mesmo pra quem não tem email nem celular
  // registrado. Sem push aqui: o email já foi, dois toques pelo mesmo assunto
  // é o caminho pra pessoa desligar os dois.
  await avisar(env, token, {
    para: 'filho', filho_id: filhoId, push: false,
    titulo: `Sua contribuição de ${nomeDoMes(ciclo)}`,
    corpo: venc
      ? `${brl(valor)}, até ${venc.slice(8, 10)}/${venc.slice(5, 7)}. Dá pra pagar pela sua área.`
      : `${brl(valor)}. Dá pra pagar pela sua área.`,
    url: 'area-filho.html',
    tag: `mensalidade-${ciclo}`,
  });

  return { ok: true, filho_id: filhoId, nome: f.nome || '', email, valor };
}

/** Gera (ou reaproveita) o link de checkout da mensalidade e fixa o valor. */
async function gerarLinkMensalidade(filho, pedido, docId, valor, env, token) {
  const centavos = Math.round(valor * 100);
  const order_nsu = `men_${docId}`;

  const resp = await fetch(IP_LINKS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: env.INFINITEPAY_HANDLE,
      order_nsu,
      redirect_url: `${env.SITE_URL}/pago.html?tipo=men&id=${docId}`,
      items: [{ quantity: 1, price: centavos, description: `Contribuição ${nomeDoMes(pedido.ciclo)}` }],
      ...(filho.nome && { customer: { name: String(filho.nome).slice(0, 120) } }),
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.url) {
    console.error('link da mensalidade falhou', docId, resp.status, JSON.stringify(data));
    return null;
  }

  // Fixa o valor: é contra ele que a confirmação compara (TIPOS.valorFixado)
  await fsPatch(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, token, {
    checkout_centavos: centavos,
    checkout_order_nsu: order_nsu,
    checkout_url: data.url,
    checkout_criadoEm: new Date().toISOString(),
    checkout_valor_base: Number(filho.valor) || 0,
    checkout_multa: Math.max(0, valor - (Number(filho.valor) || 0)),
    checkout_vencimento: vencimentoMensalidade(filho.prazo, pedido.ciclo, pedido.venc_combinado),
  });

  return data.url;
}

function nomeDoMes(ciclo) {
  return new Date(ciclo + '-02T00:00:00Z').toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
}

function emailLembrete(filho, ciclo, valor, venc, link, hoje = hojeSP()) {
  const primeiro = String(filho.nome || '').split(' ')[0];
  const brl = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
  const base = Number(filho.valor) || 0;
  const multa = Math.max(0, valor - base);

  // A frase muda com o caso: sem data ('combinado'), vencida, amanhã, ou um dia
  // qualquer à frente. Antes o texto era sempre "vence amanhã" — agora o admin
  // manda quando quer, e o email precisa dizer a verdade do dia em que sai.
  const dia = venc ? venc.slice(8, 10) : null;
  const quando =
    !venc ? `de <strong>${nomeDoMes(ciclo)}</strong> está aberta` :
    hoje > venc ? `de <strong>${nomeDoMes(ciclo)}</strong> venceu <strong>dia ${dia}</strong> e está em aberto` :
    venc === maisDias(hoje, 1) ? `de <strong>${nomeDoMes(ciclo)}</strong> vence <strong>amanhã, dia ${dia}</strong>` :
    `de <strong>${nomeDoMes(ciclo)}</strong> vence <strong>dia ${dia}</strong>`;

  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#2b2b2b;line-height:1.6">
  <div style="text-align:center;padding:24px 0 8px">
    <img src="https://terreirodocandieiro.com.br/logocandieiro.png" alt="Terreiro do Candieiro" width="72" style="display:block;margin:0 auto"/>
  </div>
  <p>Olá, ${primeiro}.</p>
  <p>Sua contribuição ${quando}.</p>
  <div style="background:#faf7f0;border:1px solid #e8dfc8;border-radius:10px;padding:16px;margin:18px 0">
    <div style="font-size:13px;color:#7a6a52">Valor</div>
    <div style="font-size:26px;font-weight:700;color:#a8802a">${brl(valor)}</div>
    ${multa > 0 ? `<div style="font-size:12.5px;color:#b0483a;margin-top:6px">Inclui ${brl(multa)} de acréscimo por atraso. Se você combinou o atraso com a administração, fala com a gente que a gente ajusta.</div>` : ''}
  </div>
  <p style="text-align:center;margin:24px 0">
    <a href="${link}" style="display:inline-block;background:#3498db;color:#fff;text-decoration:none;padding:14px 28px;border-radius:9px;font-weight:700">Pagar agora</a>
  </p>
  <p style="font-size:13.5px;color:#6b6b6b">Cartão ou PIX. Cai na hora, e você não precisa mandar comprovante — o pagamento entra no sistema do terreiro sozinho.</p>
  <p style="font-size:13.5px;color:#6b6b6b">Se preferir pagar de outro jeito, ou se algo não estiver certo, responde este email ou chama no WhatsApp.</p>
  <p style="font-size:12.5px;color:#9a9a9a;border-top:1px solid #eee;padding-top:14px;margin-top:22px">
    Terreiro do Candieiro · Barão Geraldo, Campinas-SP<br>
    Você recebe isto porque tem contribuição mensal combinada com a casa.
  </p>
</div>`;
}

/** Manda email pelo Resend. Devolve true/false, sem derrubar quem chamou. */
async function enviarEmail(env, { to, to_name, subject, html }) {
  if (!env.RESEND_API_KEY) { console.error('RESEND_API_KEY não configurada'); return false; }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.DEFAULT_FROM,
        to: [to_name ? `${to_name} <${to}>` : to],
        subject,
        html,
      }),
    });
    if (!resp.ok) { console.error('Resend', resp.status, await resp.text()); return false; }
    return true;
  } catch (e) {
    console.error('Resend falhou', e);
    return false;
  }
}

// ── PUSH (notificação no celular) ──────────────────────────────────────────
//
// O celular guarda o site na home (PWA) e recebe notificação mesmo com o app
// fechado. Quem entrega é o FCM — o mesmo Firebase que já é o banco. A service
// account também já existe: muda só o escopo do OAuth. Nada novo pra assinar.
//
// Onde mora o registro: `adm_push_tokens/{token}` — o id do doc É o token do
// aparelho. Isso dá duas coisas de graça: o mesmo celular re-registrando
// sobrescreve em vez de duplicar, e "só quem tem o token mexe no doc" vira uma
// regra de segurança que se sustenta sozinha (ver firestore.rules.pvd).
//
//   { papel: 'admin'|'filho', filho_id, nome, uid, ua, criadoEm }
//
// TETO DE SUBREQUESTS: cada envio é um fetch, e o Worker tem limite por
// invocação. Por isso o push por CRON só vai pro admin (poucos aparelhos), e o
// push pro filho sai um por vez, disparado pelo navegador do admin no mesmo
// laço que manda o email. Não existe fan-out pra 48 filhos dentro de um tick.

const ESCOPO_FCM = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_MAX = 20; // aparelhos por envio; acima disso o resumo diz quantos ficaram

async function rotaPush(body, request, env) {
  const barrado = checarSegredo(request, env);
  if (barrado) return barrado;
  if (!body?.titulo || !body?.corpo) return json({ error: 'faltam titulo e corpo' }, 400);
  return json(await mandarPush(env, body));
}

/**
 * Manda a notificação pros aparelhos do alvo. Alvo é `filho_id` (um filho) ou
 * `papel` (default 'admin'). Devolve o resumo — nunca lança: notificação que
 * falha não pode derrubar o pagamento nem o email que veio antes dela.
 */
async function mandarPush(env, { titulo, corpo, url, papel, filho_id, tag }) {
  try {
    const token = await tokenGoogle(env);
    const filtro = filho_id
      ? { campo: 'filho_id', valor: String(filho_id) }
      : { campo: 'papel', valor: papel || 'admin' };

    const alvos = await fsQuery(PROJETO_PVD, 'adm_push_tokens', token, filtro);
    if (!alvos.length) return { enviados: 0, aviso: 'nenhum celular registrado pra esse alvo' };

    const fcm = await tokenGoogle(env, ESCOPO_FCM);
    const lote = alvos.slice(0, FCM_MAX);
    let enviados = 0, mortos = 0, erros = 0;

    for (const a of lote) {
      const r = await fcmEnviar(fcm, a.id, { titulo, corpo, url, tag });
      if (r === 'ok') enviados++;
      else if (r === 'morto') { mortos++; await fsDelete(PROJETO_PVD, 'adm_push_tokens', a.id, token); }
      else erros++;
    }

    const resumo = { enviados, mortos, erros, alvos: alvos.length };
    if (alvos.length > lote.length) resumo.nao_tentados = alvos.length - lote.length;
    return resumo;
  } catch (e) {
    console.error('push falhou', e?.stack || e);
    return { enviados: 0, erro: String(e?.message || e) };
  }
}

// ── A CAIXA DE AVISOS ──────────────────────────────────────────────────────
//
// Até aqui a notificação era o único registro dela mesma. Celular desligado,
// app não instalado, pessoa que limpou a tela — a informação sumia, e ninguém
// ficava sabendo que sumiu.
//
// Medido em 01/08, entre os 56 ativos: 31 não têm email, e o push exige
// instalar (no iPhone, obrigatoriamente). Mais da metade da casa não tinha
// nenhum canal garantido.
//
// Então a ordem se inverte. O REGISTRO passa a ser a fonte, e o push vira uma
// das formas de entregar. Quem não recebeu abre a área e o recado está lá.
//
// ── COMO "LIDO" É GUARDADO ────────────────────────────────────────────────
// Um campo por PESSOA (`adm_avisos_lidos/{filho_id}.ate`), não um por aviso.
//
// Marcar aviso a aviso pediria um doc por par pessoa×aviso, ou um array que
// cresce pra sempre. Com "li até tal hora", é um doc minúsculo por filho, o
// broadcast e o pessoal funcionam pelo mesmo caminho, e abrir a aba já é o
// gesto que marca. O que se perde é marcar um aviso do meio como não lido —
// e ninguém pediu isso.

/**
 * Registra o aviso e, se der, empurra pro celular. Nesta ordem, de propósito:
 * push que falha não pode levar o registro junto.
 *
 * `filho_id` ausente com `para: 'filho'` é recado pra casa inteira.
 */
async function avisar(env, token, { para, filho_id, titulo, corpo, url, tag, push = true }) {
  // 'admin' | 'filho' (com filho_id) | 'todos' (a casa inteira)
  const alvo = para || (filho_id ? 'filho' : 'todos');
  try {
    await fsCreate(PROJETO_PVD, 'adm_notificacoes', token, {
      para: alvo,
      filho_id: filho_id || null,
      titulo: String(titulo || '').slice(0, 140),
      corpo: String(corpo || '').slice(0, 400),
      url: url || null,
      tag: tag || null,
      criadoEm: new Date().toISOString(),
    });
  } catch (e) {
    console.error('não consegui registrar o aviso', e?.message || e);
  }
  // 'todos' NÃO empurra por aqui: recado pra casa inteira é fila (60 aparelhos
  // estouram o teto de subrequests numa invocação só). Quem cuida disso é o
  // `drenarFilaDeAvisos`, um lote por batida do cron.
  if (push && alvo !== 'todos') {
    await mandarPush(env, { titulo, corpo, url, tag, papel: alvo, filho_id });
  }
}

/** Os avisos de quem chamou, do mais novo pro mais velho. */
async function rotaAvisos(body, env) {
  const token = await tokenGoogle(env);
  const quem = await quemFala(body, env, token);
  if (quem.erro) return json({ error: quem.erro }, quem.status);

  // Duas queries em vez de um OR: o `compositeFilter` com OR existe no
  // Firestore, mas exige índice composto pra ordenar junto. Duas leituras
  // simples usam o índice automático e não pedem nada de ninguém.
  const [meus, daCasa] = await Promise.all([
    fsQuery(PROJETO_PVD, 'adm_notificacoes', token, { campo: 'filho_id', valor: quem.id }, 60),
    fsQuery(PROJETO_PVD, 'adm_notificacoes', token, { campo: 'para', valor: 'todos' }, 60),
  ]);

  const lidos = await fsGet(PROJETO_PVD, 'adm_avisos_lidos', quem.id, { token });
  const ate = lidos?.ate || '';

  const lista = [...meus, ...daCasa]
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
    .slice(0, 50)
    .map((n) => ({
      id: n.id,
      titulo: n.titulo || '',
      corpo: n.corpo || '',
      url: n.url || null,
      criadoEm: n.criadoEm || null,
      lido: !!ate && String(n.criadoEm || '') <= ate,
      da_casa: !n.filho_id,
    }));

  return json({ avisos: lista, nao_lidos: lista.filter((n) => !n.lido).length });
}

/** Marca tudo até agora como lido. Chamado quando a aba de avisos abre. */
async function rotaAvisosLidos(body, env) {
  const token = await tokenGoogle(env);
  const quem = await quemFala(body, env, token);
  if (quem.erro) return json({ error: quem.erro }, quem.status);

  const ate = new Date().toISOString();
  const campos = { ate, filho_id: quem.id };
  if ((await fsCreateComId(PROJETO_PVD, 'adm_avisos_lidos', quem.id, token, campos)) === 'existe') {
    await fsPatch(PROJETO_PVD, 'adm_avisos_lidos', quem.id, token, campos);
  }
  return json({ ok: true, ate });
}

// ── FILA DE AVISO PROS FILHOS ──────────────────────────────────────────────
//
// O mural (`adm_avisos`) manda push pra casa inteira, e é a única coisa aqui
// que fala com dezenas de aparelhos de uma vez. Por isso é fila, e não laço.
//
// O teto de subrequests do Worker é POR INVOCAÇÃO, e o plano de graça dá 50.
// Um laço em 48 filhos estoura no meio e falha calado: metade recebe, metade
// não, e ninguém fica sabendo qual metade. A fila troca isso por tempo — cada
// batida do cron manda um pedaço, e a casa inteira leva ~30 minutos.
//
// A fila é a lista de APARELHOS, não de filhos: é o aparelho que custa uma
// subrequest, e um filho com celular e tablet custa dois.
const AVISO_LOTE = 15;

/**
 * Manda um lote do aviso mais antigo que ainda tem fila. Devolve null quando
 * não há nada a fazer — o caso normal, 95 batidas em cada 96.
 */
async function drenarFilaDeAvisos(env, token) {
  const fila = await fsQuery(PROJETO_PVD, 'adm_avisos', token, { campo: 'push_status', valor: 'pendente' }, 10);
  if (!fila.length) return null;

  // Mais antigo primeiro: se dois avisos saíram juntos, o que foi publicado
  // antes chega antes. Sem isto a ordem é a que o Firestore quiser.
  const aviso = fila.sort((a, b) =>
    String(a.publicadoEm || '').localeCompare(String(b.publicadoEm || '')))[0];

  // Primeira batida deste aviso: resolve quem recebe, uma vez só. Quem
  // registrar o celular depois não recebe este aviso — e é o certo, senão a
  // fila nunca fecharia.
  let restantes = Array.isArray(aviso.push_restantes) ? aviso.push_restantes : null;
  if (!restantes) {
    restantes = (await fsQuery(PROJETO_PVD, 'adm_push_tokens', token, { campo: 'papel', valor: 'filho' }))
      .map((t) => t.id);
    // O registro sai UMA vez, na largada, e alcança a casa inteira — inclusive
    // quem não tem celular registrado e nunca receberia o push. É o ponto todo
    // da caixa de avisos: entrega falha, registro não.
    await avisar(env, token, {
      para: 'todos',
      titulo: aviso.titulo || 'Aviso do terreiro',
      corpo: (aviso.corpo || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      url: 'area-filho.html',
      tag: `aviso-${aviso.id}`,
      push: false,
    });
  }

  const lote = restantes.slice(0, AVISO_LOTE);
  const resto = restantes.slice(lote.length);

  let enviados = 0, mortos = 0;
  if (lote.length) {
    const fcm = await tokenGoogle(env, ESCOPO_FCM);
    for (const deviceToken of lote) {
      const r = await fcmEnviar(fcm, deviceToken, {
        titulo: aviso.titulo || 'Aviso do terreiro',
        corpo: (aviso.corpo || '').replace(/\s+/g, ' ').trim().slice(0, 140),
        url: 'area-filho.html',
        tag: `aviso-${aviso.id}`,
      });
      if (r === 'ok') enviados++;
      else if (r === 'morto') mortos++;
      // Token morto não é apagado aqui de propósito: o delete é mais uma
      // subrequest por aparelho, e é justo o que a fila está economizando. O
      // caminho normal do push (mandarPush) limpa na próxima vez que passar.
    }
  }

  await fsPatch(PROJETO_PVD, 'adm_avisos', aviso.id, token, {
    push_restantes: resto,
    push_enviados: (Number(aviso.push_enviados) || 0) + enviados,
    push_status: resto.length ? 'pendente' : 'enviado',
  });

  return { aviso: aviso.id, enviados, mortos, restam: resto.length };
}

/**
 * Um aparelho. Devolve 'ok' | 'morto' | 'erro'.
 *
 * Só `data`, sem `notification`: quem desenha a notificação é o sw.js. Com as
 * duas o Chrome mostra uma e o service worker mostra outra, e aparecem duas
 * notificações pro mesmo fato.
 */
async function fcmEnviar(fcmToken, deviceToken, { titulo, corpo, url, tag }) {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJETO_PVD}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fcmToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        data: { titulo: String(titulo), corpo: String(corpo), url: String(url || '/'), tag: String(tag || 'geral') },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
      },
    }),
  });
  if (resp.ok) return 'ok';

  const txt = await resp.text().catch(() => '');
  // Desinstalou o app, limpou o site, ou o token expirou. Apagar é o certo:
  // token morto que fica no banco vira erro em todo envio, pra sempre.
  if (resp.status === 404 || txt.includes('UNREGISTERED') || txt.includes('INVALID_ARGUMENT')) return 'morto';
  console.error('FCM', resp.status, txt.slice(0, 300));
  return 'erro';
}

// ── O TICK ─────────────────────────────────────────────────────────────────
// Roda de 15 em 15 minutos e decide o que fazer pelo relógio de Brasília. O
// estado mora em `adm_config/push_estado`, e é ele que impede repetição: o
// digest é uma vez por dia e o lote uma vez por ciclo, mesmo com 96 batidas.

async function tick(env) {
  const token = await tokenGoogle(env);
  const hoje = hojeSP();
  const hora = horaSP();
  const minutos = minutosSP();
  const agora = new Date().toISOString();
  const estado = (await fsGet(PROJETO_PVD, 'adm_config', 'push_estado', { token })) || {};
  const feito = [];

  // 1) Novidade desde o último olhar.
  //
  // Na primeira execução não avisa nada: sem marca gravada, o corte é agora.
  // Senão o primeiro tick despejaria o histórico inteiro na tela de quem acabou
  // de instalar — a estreia do recurso seria 40 notificações de coisa velha.
  if (estado.ultimo_olhar) {
    for (const aviso of await novidades(token, estado.ultimo_olhar)) {
      await mandarPush(env, aviso);
      feito.push(aviso.tag);
    }
  }
  const patch = { ultimo_olhar: agora };

  // 2) Digest das 9h — o que precisa de olho hoje.
  if (hora >= 9 && estado.digest_em !== hoje) {
    for (const aviso of await digestDoDia(env, token, hoje)) {
      await mandarPush(env, aviso);
      feito.push(aviso.tag);
    }
    patch.digest_em = hoje;
  }

  // 3) Lote de mensalidade, dia 1 a partir das 6h.
  const ciclo = cicloAtual();
  if (hoje.endsWith('-01') && hora >= 6 && estado.lote_ciclo !== ciclo) {
    const r = await gerarLoteMensalidade(ciclo, env);
    patch.lote_ciclo = ciclo;
    feito.push(`lote:${r.criados}`);
  }

  // 4) Consulta que começa em ~1h.
  //
  // A marca vive no próprio atendimento (`push_1h_em`), não aqui no estado: o
  // remarcar de horário tem que poder reabrir o lembrete, e uma flag no estado
  // global ficaria valendo pro dia inteiro.
  for (const a of await consultasDoDia(token, hoje)) {
    const min = minutosDoDia(a.hora);
    if (min === null || a.push_1h_em === hoje) continue;
    if (!naJanelaDeUmaHora(minutos, min)) continue;

    await mandarPush(env, {
      tag: `consulta-${a.id}`,
      titulo: `Consulta às ${a.hora}`,
      corpo: `${a.consulente_nome || 'sem nome'}${a.tipo_oraculo === 'buzios' ? ' · búzios' : ''}`,
      url: 'index.html#agenda',
    });
    await fsPatch(PROJETO_PVD, 'adm_atendimentos', a.id, token, { push_1h_em: hoje });
    feito.push(`consulta1h:${a.id}`);
  }

  // 5) Um lote da fila de push de avisos. A fila mora no próprio aviso, não
  // aqui: um aviso apagado leva a fila dele junto, sem deixar órfão no estado.
  const fila = await drenarFilaDeAvisos(env, token);
  if (fila) feito.push(`aviso:${fila.enviados}${fila.restam ? `+${fila.restam}` : ''}`);

  await fsPatch(PROJETO_PVD, 'adm_config', 'push_estado', token, patch);
  return { hoje, hora, feito };
}

/**
 * O que apareceu desde a última batida. Três queries, todas por data.
 *
 * Filtra pela `origem`: pedido que o próprio admin acabou de digitar na tela
 * (`admin_manual`) não vira notificação. Avisar alguém do que ele mesmo fez
 * dois segundos atrás treina a pessoa a ignorar o aviso — e aí o dia em que
 * chegar um de verdade ela também ignora.
 */
async function novidades(token, desde) {
  const corte = new Date(desde);
  const avisos = [];

  const sols = await fsQuery(PROJETO_PVD, 'adm_solicitacoes', token,
    { campo: 'criadoEm', op: 'GREATER_THAN', valor: corte });
  const pendentes = sols.filter((s) => s.status === 'pendente' && s.origem === 'agendar_publico');
  if (pendentes.length) {
    avisos.push({
      tag: 'agendamento',
      titulo: pendentes.length === 1 ? 'Novo pedido de consulta' : `${pendentes.length} pedidos de consulta`,
      corpo: pendentes.length === 1
        ? `${pendentes[0].nome || 'alguém'} — ${fmtDataHora(pendentes[0])}`
        : pendentes.map((s) => s.nome || '?').slice(0, 4).join(', '),
      url: 'index.html#solicitacoes',
    });
  }

  const peds = (await fsQuery(PROJETO_PVD, 'vendas_pedidos', token,
    { campo: 'criadoEm', op: 'GREATER_THAN', valor: corte }))
    .filter((p) => p.origem !== 'admin_manual');
  if (peds.length) {
    const total = peds.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    avisos.push({
      tag: 'venda',
      titulo: peds.length === 1 ? 'Nova venda' : `${peds.length} vendas novas`,
      corpo: peds.length === 1
        ? `${peds[0].produto_nome || 'produto'} — ${brl(peds[0].valor)} · ${peds[0].nome || ''}`.trim()
        : `${brl(total)} no total`,
      url: 'index.html#pedidos',
    });
  }

  const remb = await fsQuery(PROJETO_PVD, 'fin_reembolsos', token,
    { campo: 'criadoEm', op: 'GREATER_THAN', valor: corte });
  if (remb.length) {
    avisos.push({
      tag: 'financeiro',
      titulo: remb.length === 1 ? 'Pedido de reembolso' : `${remb.length} pedidos de reembolso`,
      corpo: remb.length === 1
        ? `${remb[0].nome || '?'} — ${brl(remb[0].valor)} · ${(remb[0].descricao || '').slice(0, 60)}`
        : `${brl(remb.reduce((s, r) => s + (Number(r.valor) || 0), 0))} no total`,
      url: 'index.html#pedidos',
    });
  }

  return avisos;
}

/** Uma vez por dia, às 9h: o que está atrasado e o que vence amanhã. */
async function digestDoDia(env, token, hoje) {
  const amanha = maisDias(hoje, 1);
  const avisos = [];

  // A agenda do dia. Vem primeiro de propósito: é o que mais muda o que você
  // faz nas próximas horas, e o push empilha na ordem em que é mandado.
  const consultas = await consultasDoDia(token, hoje);
  if (consultas.length) {
    avisos.push({
      tag: 'agenda',
      titulo: `${consultas.length} consulta${consultas.length === 1 ? '' : 's'} hoje`,
      corpo: consultas.map((a) => `${a.hora || '??:??'} ${a.consulente_nome || 'sem nome'}`)
        .slice(0, 4).join(' · '),
      url: 'index.html#agenda',
    });
  }

  // Tarefas com prazo vencido e ainda em aberto.
  const tarefas = (await fsQuery(PROJETO_PVD, 'adm_kanban', token,
    { campo: 'prazo', op: 'LESS_THAN', valor: hoje }))
    .filter((k) => k.status !== 'done' && !k.arquivado);
  if (tarefas.length) {
    avisos.push({
      tag: 'tarefas',
      titulo: `${tarefas.length} tarefa${tarefas.length === 1 ? '' : 's'} atrasada${tarefas.length === 1 ? '' : 's'}`,
      corpo: tarefas.map((k) => k.titulo || 'sem título').slice(0, 3).join(' · '),
      url: 'index.html#kanban',
    });
  }

  // Contas fixas que vencem amanhã e ainda não foram pagas neste ciclo.
  const contas = await contasVencendo(token, amanha);
  if (contas.length) {
    const total = contas.reduce((s, g) => s + (Number(g.valor) || 0), 0);
    avisos.push({
      tag: 'contas',
      titulo: `${contas.length} conta${contas.length === 1 ? '' : 's'} vence${contas.length === 1 ? '' : 'm'} amanhã`,
      corpo: `${contas.map((g) => g.nome).slice(0, 3).join(' · ')} — ${brl(total)}`,
      url: 'index.html#contas',
    });
  }

  // Mensalidades vencendo amanhã. O push NÃO manda o email — ele chama o admin
  // pra revisar a lista e aprovar. A decisão continua sendo de gente.
  const { lista } = await listarLembretes(env, cicloAtual());
  const revisar = lista.filter((f) => f.vence_amanha && !f.pago && !f.ja_avisado && f.email);
  if (revisar.length) {
    avisos.push({
      tag: 'mensalidade',
      titulo: `${revisar.length} contribuiç${revisar.length === 1 ? 'ão vence' : 'ões vencem'} amanhã`,
      corpo: 'Abra os Lembretes, confira a lista e aprove o envio.',
      url: 'index.html#lembretes',
    });
  }

  return avisos;
}

/**
 * Uma conta fixa vence nesta data?
 *
 * `dia_venc` é campo novo: conta sem ele nunca avisa, que é o comportamento
 * certo pra quem ainda não preencheu. E dia 31 em mês de 30 cai no último dia
 * — sem essa dobra, a conta do dia 31 nunca venceria em abril, junho, setembro
 * e novembro. Mesma dobra do `'ultimo'` da mensalidade, pelo mesmo motivo.
 *
 * Exportada pura porque é regra de calendário, e calendário é onde erro passa
 * despercebido por meses: `node worker/test-contas.mjs`.
 */
export function contaVenceEm(gasto, dataISO) {
  const d = Number(gasto?.dia_venc);
  if (!d || d < 1) return false;
  const dia = Number(dataISO.slice(8, 10));
  const ultimo = ultimoDiaDoCiclo(dataISO.slice(0, 7));
  return d === dia || (d > ultimo && dia === ultimo);
}

/**
 * Consultas de um dia, em ordem de hora, sem as que não vão acontecer.
 *
 * `nao_compareceu` e `realizado` ficam de fora junto com `cancelado`: os três
 * já são passado, e lembrete de coisa que já aconteceu é ruído.
 */
async function consultasDoDia(token, dataISO) {
  const MORTOS = ['cancelado', 'nao_compareceu', 'realizado'];
  return (await fsQuery(PROJETO_PVD, 'adm_atendimentos', token, { campo: 'data', valor: dataISO }))
    .filter((a) => !MORTOS.includes(a.status_atendimento))
    .sort((a, b) => String(a.hora || '').localeCompare(String(b.hora || '')));
}

/**
 * Minutos de "HH:MM" desde a meia-noite. `null` se não der pra ler — hora vazia
 * ou torta não pode virar 0, senão toda consulta sem hora vira meia-noite e
 * dispara o lembrete na primeira batida do dia.
 */
export function minutosDoDia(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * A consulta cai na janela do lembrete de 1h?
 *
 * A janela é [45min, 75min] à frente, e não "exatamente 60": o cron bate de 15
 * em 15 minutos, então um alvo pontual seria perdido na maioria das vezes. 30
 * minutos de largura garantem exatamente uma batida dentro dela — duas nunca,
 * porque a flag no atendimento fecha a porta depois da primeira.
 */
export function naJanelaDeUmaHora(minutosAgora, minutosConsulta) {
  const falta = minutosConsulta - minutosAgora;
  return falta >= 45 && falta <= 75;
}

/** Contas fixas que vencem na data pedida e ainda não têm baixa no ciclo. */
async function contasVencendo(token, dataISO) {
  const ciclo = dataISO.slice(0, 7);
  const gastos = await fsList(PROJETO_PVD, 'fin_gastos', token);
  const pagos = (await fsGet(PROJETO_PVD, 'fin_gastos_pagos', ciclo, { token })) || {};
  return gastos.filter((g) => contaVenceEm(g, dataISO) && pagos[g.id] !== true);
}

function brl(v) {
  return `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;
}
function fmtDataHora(s) {
  if (!s?.data) return s?.hora || '';
  const [a, m, d] = String(s.data).split('-');
  return `${d}/${m}${s.hora ? ` às ${s.hora}` : ''}`;
}

// ── MENSALIDADE DO FILHO ───────────────────────────────────────────────────
// Entra: { filho_id, tel4, ciclo? }. Sai: quanto ele deve neste mês e se pagou.
//
// Existe porque a area-filho.html NÃO pode ler fin_mensalidade_pedidos: a
// collection é fechada de propósito, senão qualquer visitante veria quem está
// atrasado na casa.
//
// A prova é a mesma que a página já usa: os 4 últimos dígitos do telefone
// cadastrado (ou o PIN). É fraca, e é de propósito — é o modelo de confiança que
// a área do filho já tem, e sem ela este endpoint viraria uma lista pública de
// quem deve mensalidade, o que é pior.
//
// Se o pedido do ciclo não existe ainda, o Worker CRIA. Quem não pode criar é o
// público (plantaria checkout_centavos); o Worker escreve com service account.
// Assim ninguém fica sem poder pagar por causa de lote não rodado.

async function rotaMensalidade(body, env) {
  const ciclo = body?.ciclo || cicloAtual();
  if (!/^\d{4}-\d{2}$/.test(ciclo)) return json({ error: 'ciclo inválido' }, 400);

  const token = await tokenGoogle(env);
  const quem = await quemFala(body, env, token);
  if (quem.erro) return json({ error: quem.erro }, quem.status);
  const { id: filho_id, filho } = quem;

  const base = Number(filho.valor) || 0;
  if (base <= 0) return json({ isento: true, ciclo });

  const docId = `${filho_id}__${ciclo}`;
  let pedido = await fsGet(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, { token });

  if (!pedido) {
    await fsCreateComId(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, token, {
      filho_id,
      filho_nome: filho.nome || '',
      ciclo,
      status: 'aberto',
      avisou_atraso: false,
      geradoEm: new Date().toISOString(),
      geradoPor: 'area-filho',
    });
    pedido = await fsGet(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, { token });
    if (!pedido) return json({ error: 'não consegui abrir a mensalidade do mês' }, 500);
  }

  // Os DOIS lugares, sempre. Baixa manual no financeiro vale tanto quanto
  // pagamento pelo link — e antes desta linha ela não valia nada aqui.
  const como = estaPago(pedido, await pagosDoCiclo(ciclo, token), filho_id);
  const pago = !!como;
  const valor = mensalidadeReais(pedido, filho, hojeSP());

  return json({
    isento: false,
    ciclo,
    doc_id: docId,
    pago,
    // Baixa manual não tem valor congelado: mostra o que era devido, sem
    // acréscimo, porque cobrar multa de quem já pagou é o bug de novo.
    valor: pago ? Number(pedido.valor_cobrado) || (como === 'manual' ? base : valor) : valor,
    base,
    multa: pago ? 0 : Math.max(0, valor - base),
    vencimento: vencimentoMensalidade(filho.prazo, ciclo, pedido.venc_combinado),
    avisou_atraso: !!pedido.avisou_atraso,
    metodo: pago ? (pedido.metodo_pagamento || (como === 'manual' ? 'manual' : null)) : null,
    recibo_url: pago ? pedido.pagamento_recibo_url || null : null,
    // O que a área do filho precisa pra desenhar o cartão de ajuste do mês.
    ajuste: {
      // Só até o dia 5. A janela é do Worker, não da tela: escondendo o botão
      // no HTML o pedido continuaria passando por curl no dia 28.
      aberto: podeAjustar(ciclo),
      prazo: `${ciclo}-05`,
      venc_padrao: vencimentoMensalidade(filho.prazo, ciclo),
      venc_combinado: pedido.venc_combinado || null,
      isencao_status: pedido.isencao_status || null,
      isencao_motivo: pedido.isencao_motivo || null,
    },
  });
}

/**
 * A janela de ajuste vai do dia 1 ao dia 5 do próprio ciclo, hora de Brasília.
 *
 * Ciclo passado nunca reabre — senão em dezembro dava pra pedir isenção de
 * março, e o financeiro do ano já estava fechado. Ciclo futuro também não: o
 * filho pediria isenção de um mês que ainda não existe pra ninguém.
 */
export function podeAjustar(ciclo, hoje = hojeSP()) {
  return hoje.slice(0, 7) === ciclo && Number(hoje.slice(8, 10)) <= 5;
}

// ── O ELENCO, SEM O QUE NÃO É DE NINGUÉM ───────────────────────────────────
//
// `fin_filhos` era leitura pública. Toda página sem login lia a collection
// inteira pra montar o seletor de nomes — e junto vinham telefone, valor da
// mensalidade, data de nascimento, email e a observação interna dos 60.
//
// Pior que o vazamento: o telefone É a credencial. A área do filho entra com os
// 4 últimos dígitos, e eles estavam na mesma resposta que a lista de nomes.
// Quem lesse a collection entrava como qualquer pessoa da casa.
//
// Agora a collection é fechada e o elenco vem por aqui, sem os cinco campos.
// O custo honesto: se o Worker cair, o seletor não carrega. A área do filho já
// dependia dele pra mensalidade, checkout e push — agora depende pra abrir.
const CAMPOS_PRIVADOS = ['tel', 'pin', 'pin_hash', 'pin_criado_em', 'auth_email', 'obs', 'valor'];

async function rotaFilhos(env) {
  const token = await tokenGoogle(env);
  const filhos = await fsList(PROJETO_PVD, 'fin_filhos', token);

  // Lista negra e não branca, de propósito: campo novo no cadastro aparece
  // sozinho nas telas, como sempre apareceu. O que precisa de decisão é
  // esconder, não mostrar — e esconder está escrito ali em cima, num lugar só.
  const limpos = filhos.map((f) => {
    const out = {};
    for (const [k, v] of Object.entries(f)) if (!CAMPOS_PRIVADOS.includes(k)) out[k] = v;
    return out;
  });

  limpos.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  return json({ filhos: limpos });
}

// ── PIN, SESSÃO E LIMITE DE TENTATIVA ──────────────────────────────────────
//
// O telefone deixou de ser público em 01/08, mas continuava sendo a chave. Duas
// pessoas da casa que se conhecem sabem o número uma da outra, e pronto.
//
// Agora cada um escolhe um PIN de 4 dígitos. O telefone vira só a porta da
// PRIMEIRA vez — depois disso ele não abre mais nada.
//
// ── COMO O PIN É GUARDADO ─────────────────────────────────────────────────
// HMAC-SHA256 com o `ADMIN_SECRET` do Worker como PIMENTA (pepper), não hash
// simples nem PBKDF2.
//
// O motivo é honesto: 4 dígitos são 10 mil combinações. Qualquer hash, por mais
// caro que seja, cai num sábado de GPU se o banco vazar. PBKDF2 daria a
// sensação de segurança sem a coisa.
//
// A pimenta muda o jogo porque ela NÃO está no Firestore: vive só nas variáveis
// do Worker. Vazar o banco inteiro não basta pra testar um único palpite — é
// preciso vazar o Cloudflare também. É a diferença entre "10 mil tentativas
// offline" e "não dá pra tentar".
//
// Consequência que precisa estar escrita: trocar o ADMIN_SECRET invalida os 60
// PINs de uma vez. Se um dia isso for necessário, todo mundo volta pro modo
// telefone — e é por isso que o modo telefone não pode ser removido do código.
export async function pinHash(env, filhoId, pin) {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.ADMIN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${filhoId}:${pin}`));
  return b64url(mac);
}

/** Comparação em tempo constante. Paranoia barata, e o custo é zero. */
export function igual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ── SESSÃO ────────────────────────────────────────────────────────────────
//
// Depois do primeiro acerto o navegador guarda um token assinado, não o PIN.
// Assim o segredo não fica em disco no aparelho, e cada rota confere a
// assinatura em vez de reconferir a senha.
const SESSAO_DIAS = 30;

export async function assinarSessao(env, filhoId) {
  const exp = Math.floor(Date.now() / 1000) + SESSAO_DIAS * 86400;
  const corpo = b64url(JSON.stringify({ f: String(filhoId), e: exp }));
  return `${corpo}.${await pinHash(env, 'sessao', corpo)}`;
}

/** Devolve o filho_id se o token vale, ou null. Nunca lança. */
export async function lerSessao(env, token) {
  try {
    const [corpo, sig] = String(token || '').split('.');
    if (!corpo || !sig) return null;
    if (!igual(sig, await pinHash(env, 'sessao', corpo))) return null;
    const { f, e } = JSON.parse(atob(corpo.replace(/-/g, '+').replace(/_/g, '/')));
    if (!f || !e || e < Math.floor(Date.now() / 1000)) return null;
    return String(f);
  } catch { return null; }
}

// ── LIMITE DE TENTATIVA ───────────────────────────────────────────────────
//
// Quatro dígitos sem limite são 10 mil palpites pra quem tiver paciência e um
// laço. Cinco erros travam o cadastro por 10 minutos.
//
// O contador mora num doc por filho (`adm_tentativas/{filho_id}`), e não em
// memória: o Worker é distribuído, e uma variável de módulo contaria errado —
// cada região com a própria conta, o que na prática multiplica o limite.
const ERROS_ATE_TRAVAR = 5;
const TRAVA_MINUTOS = 10;

async function checarTrava(token, filhoId) {
  const d = await fsGet(PROJETO_PVD, 'adm_tentativas', filhoId, { token });
  if (!d?.travado_ate) return null;
  const falta = Math.ceil((new Date(d.travado_ate).getTime() - Date.now()) / 60000);
  return falta > 0 ? falta : null;
}

async function registrarErro(token, filhoId) {
  const d = (await fsGet(PROJETO_PVD, 'adm_tentativas', filhoId, { token })) || {};
  const n = (Number(d.erros) || 0) + 1;
  const patch = { erros: n, ultimo_em: new Date().toISOString() };
  if (n >= ERROS_ATE_TRAVAR) {
    patch.travado_ate = new Date(Date.now() + TRAVA_MINUTOS * 60000).toISOString();
    patch.erros = 0; // trava e zera: a próxima rodada recomeça a contagem
  }
  // Cria, e se já existe, atualiza. O 409 do create é o que evita ler antes só
  // pra saber qual das duas chamadas fazer.
  if ((await fsCreateComId(PROJETO_PVD, 'adm_tentativas', filhoId, token, patch)) === 'existe') {
    await fsPatch(PROJETO_PVD, 'adm_tentativas', filhoId, token, patch).catch(() => {});
  }
}

async function limparErros(token, filhoId) {
  await fsPatch(PROJETO_PVD, 'adm_tentativas', filhoId, token,
    { erros: 0, travado_ate: null }).catch(() => {});
}

/**
 * Quem está falando? Aceita a sessão assinada OU a prova de 4 dígitos.
 *
 * Existe pra sessão e prova não virarem dois caminhos de código em cada rota —
 * quando isso acontece, uma delas ganha uma checagem que a outra não tem, e a
 * diferença só aparece no dia do problema.
 *
 * Devolve `{ id, filho }` no acerto, ou `{ erro, status }`.
 */
async function quemFala(body, env, token) {
  const daSessao = await lerSessao(env, body?.sessao);
  const id = daSessao || String(body?.filho_id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { erro: 'filho_id inválido', status: 400 };

  const filho = await fsGet(PROJETO_PVD, 'fin_filhos', id, { token });
  if (!filho) return { erro: 'filho não encontrado', status: 404 };
  if (daSessao) return { id, filho };

  const falta = await checarTrava(token, id);
  if (falta) return { erro: `Muitas tentativas. Tenta em ${falta} min.`, status: 429 };

  const digitado = String(body?.tel4 || '').replace(/\D/g, '').slice(-4);
  const tel = String(filho.tel || '').replace(/\D/g, '');
  const ok = filho.pin_hash
    ? igual(filho.pin_hash, await pinHash(env, id, digitado))
    : (tel.length >= 4 && digitado === tel.slice(-4));
  if (!ok) {
    await registrarErro(token, id);
    return { erro: 'não confere', status: 403 };
  }
  return { id, filho };
}

// ── ENTRAR: A PROVA DOS 4 DÍGITOS, AGORA DO LADO DE CÁ ─────────────────────
//
// A conferência acontecia no navegador, comparando com o telefone que a própria
// página tinha baixado. Era teatro: quem abrisse o devtools pulava.
//
// Continua sendo prova fraca — 4 dígitos, sem limite de tentativa por enquanto.
// A diferença é que agora eles são SEGREDO: não saem mais na lista de nomes. É
// o degrau que faltava pra palavra "prova" significar alguma coisa.
//
// Devolve tel e auth_email de volta: são dados da própria pessoa, e as telas de
// evento e venda usam pra preencher o formulário de quem acabou de se
// identificar.
async function rotaEntrar(body, env) {
  const { filho_id, tel4 } = body || {};
  if (!filho_id || !/^[A-Za-z0-9_-]{1,64}$/.test(String(filho_id))) {
    return json({ error: 'filho_id inválido' }, 400);
  }
  const id = String(filho_id);
  const token = await tokenGoogle(env);

  const falta = await checarTrava(token, id);
  if (falta) {
    return json({ error: `Muitas tentativas. Tenta de novo em ${falta} minuto${falta === 1 ? '' : 's'}.`, travado: true }, 429);
  }

  const filho = await fsGet(PROJETO_PVD, 'fin_filhos', id, { token });
  if (!filho) return json({ error: 'filho não encontrado' }, 404);

  const digitado = String(tel4 || '').replace(/\D/g, '').slice(-4);
  if (digitado.length !== 4) return json({ error: 'são 4 números' }, 400);

  // Quem já tem PIN entra SÓ por ele. O telefone não é aceito como alternativa
  // — se fosse, o PIN seria decoração: bastaria conhecer o número pra pular.
  const temPin = !!filho.pin_hash;
  const confere = temPin
    ? igual(filho.pin_hash, await pinHash(env, id, digitado))
    : (() => {
        const tel = String(filho.tel || '').replace(/\D/g, '');
        return tel.length >= 4 && digitado === tel.slice(-4);
      })();

  if (!confere) {
    await registrarErro(token, id);
    return json({ error: 'não confere', usando: temPin ? 'pin' : 'telefone' }, 403);
  }
  await limparErros(token, id);

  return json({
    ok: true,
    filho_id: id,
    nome: filho.nome || '',
    tel: filho.tel || '',
    auth_email: filho.auth_email || null,
    // Sem PIN ainda: a tela obriga a criar antes de mostrar a área. É uma vez
    // só, pra todo mundo, e a partir dali o telefone não abre mais porta.
    precisa_pin: !temPin,
    sessao: await assinarSessao(env, id),
  });
}

// ── CRIAR E ZERAR O PIN ────────────────────────────────────────────────────
//
// Criar exige a prova de agora (telefone na primeira vez, PIN atual pra trocar).
// Não basta a sessão: sessão é "você entrou faz um tempo", e trocar senha é
// exatamente o momento em que isso não é suficiente.
async function rotaCriarPin(body, env) {
  const { filho_id, tel4, pin } = body || {};
  if (!filho_id || !/^[A-Za-z0-9_-]{1,64}$/.test(String(filho_id))) {
    return json({ error: 'filho_id inválido' }, 400);
  }
  const id = String(filho_id);
  const novoPin = String(pin || '').replace(/\D/g, '');
  if (novoPin.length !== 4) return json({ error: 'o PIN tem 4 números' }, 400);

  // Recusa os óbvios. Não é teatro: com 10 mil combinações, quem for tentar
  // adivinhar começa por 0000, 1234 e pelo ano de nascimento.
  if (/^(\d)\1{3}$/.test(novoPin) || ['1234', '4321', '0123', '2580'].includes(novoPin)) {
    return json({ error: 'esse PIN é fácil demais. Escolhe outro.' }, 400);
  }

  const token = await tokenGoogle(env);
  const falta = await checarTrava(token, id);
  if (falta) return json({ error: `Muitas tentativas. Tenta em ${falta} min.`, travado: true }, 429);

  const filho = await fsGet(PROJETO_PVD, 'fin_filhos', id, { token });
  if (!filho) return json({ error: 'filho não encontrado' }, 404);

  const digitado = String(tel4 || '').replace(/\D/g, '').slice(-4);
  const tel = String(filho.tel || '').replace(/\D/g, '');
  const confere = filho.pin_hash
    ? igual(filho.pin_hash, await pinHash(env, id, digitado))
    : (tel.length >= 4 && digitado === tel.slice(-4));
  if (!confere) {
    await registrarErro(token, id);
    return json({ error: 'a prova atual não confere' }, 403);
  }

  await fsPatch(PROJETO_PVD, 'fin_filhos', id, token, {
    pin_hash: await pinHash(env, id, novoPin),
    pin_criado_em: new Date().toISOString(),
  });
  await limparErros(token, id);
  return json({ ok: true, sessao: await assinarSessao(env, id) });
}

/**
 * Zera o PIN de alguém. Protegida pelo segredo do admin.
 *
 * Existe porque PIN obrigatório sem chaveiro é gente trancada do lado de fora:
 * 31 dos 56 não têm email, não há SMS, e portanto não há recuperação
 * automática possível. Quem esquece procura a administração, e a administração
 * precisa de um botão.
 *
 * Zerar devolve a pessoa pro modo telefone — ela entra com os 4 dígitos e cria
 * um PIN novo na hora seguinte.
 */
async function rotaZerarPin(body, request, env) {
  const barrado = checarSegredo(request, env);
  if (barrado) return barrado;

  const id = String(body?.filho_id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: 'filho_id inválido' }, 400);

  const token = await tokenGoogle(env);
  const filho = await fsGet(PROJETO_PVD, 'fin_filhos', id, { token });
  if (!filho) return json({ error: 'filho não encontrado' }, 404);

  await fsPatch(PROJETO_PVD, 'fin_filhos', id, token, { pin_hash: null, pin_criado_em: null });
  await limparErros(token, id);
  return json({ ok: true, nome: filho.nome || '', voltou_pro_telefone: true });
}

// ── O FILHO EDITANDO O PRÓPRIO CADASTRO ────────────────────────────────────
//
// Dois campos, e os dois a página pedia direto ao Firestore: data de nascimento
// (pra entrar na lista de aniversariantes) e email (pra receber lembrete).
//
// Nenhum dos dois funcionava. As rules de `fin_filhos` liberam escrita pro
// admin e, por campo, pro financeiro — nunca pro público. O filho apertava
// Salvar e via "Erro ao salvar. Tenta de novo." todas as vezes. Não era calado,
// mas era indistinguível de instabilidade, então virou paisagem.
//
// Agora passa por aqui, com a mesma prova do /entrar, e são só estes dois
// campos: o resto do cadastro continua sendo da administração.
async function rotaMeuCadastro(body, env) {
  const { data_nascimento, auth_email, mora_perto, trabalha_clt } = body || {};
  const token = await tokenGoogle(env);
  const quem = await quemFala(body, env, token);
  if (quem.erro) return json({ error: quem.erro }, quem.status);
  const filho_id = quem.id;

  const patch = {};
  if (data_nascimento !== undefined) {
    const d = String(data_nascimento);
    // Data de verdade, e no passado. `new Date` sozinho aceita '2026-02-31' e
    // rola pra março calado, então o round-trip é a checagem.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d) {
      return json({ error: 'data de nascimento inválida' }, 400);
    }
    if (d >= hojeSP()) return json({ error: 'data de nascimento no futuro' }, 400);
    patch.data_nascimento = d;
  }
  if (auth_email !== undefined) {
    const e = String(auth_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 200) {
      return json({ error: 'email inválido' }, 400);
    }
    patch.auth_email = e;
  }
  // Só o que é conhecimento DELE. Posto, padrinho, valor e prazo são decisão da
  // casa, e deixar alguém declarar o próprio posto é deixar a pessoa se dar uma
  // função. Campo da casa não entra nesta lista, nunca.
  if (mora_perto !== undefined) patch.mora_perto = !!mora_perto;
  if (trabalha_clt !== undefined) patch.trabalha_clt = !!trabalha_clt;

  if (!Object.keys(patch).length) return json({ error: 'nada pra salvar' }, 400);

  patch.atualizadoEm = new Date().toISOString();
  await fsPatch(PROJETO_PVD, 'fin_filhos', String(filho_id), token, patch);
  return json({ ok: true, ...patch });
}

// ── AJUSTE DA MENSALIDADE PELO FILHO ───────────────────────────────────────
// Entra: { filho_id, tel4, tipo, data?, motivo? }. Tipo é 'data' ou 'isencao'.
//
// Existe porque a conversa sobre "não vou conseguir pagar este mês" acontecia
// no WhatsApp e morria lá: o financeiro continuava contando com o dinheiro, o
// lembrete continuava saindo, e a multa caía em cima de quem tinha avisado.
//
// Regra permanente — mudar o prazo de todos os meses, virar isento de vez — NÃO
// passa por aqui. Isso é conversa com o Pai, e continua sendo. Esta rota mexe
// num mês, uma vez, e o mês é o corrente.
//
// A prova é a mesma do /mensalidade: 4 últimos dígitos do telefone. Fraca, e de
// propósito — é o modelo de confiança que a área do filho já tem.

/**
 * A data escolhida serve? Tem que ser deste ciclo, e não pode ser pra trás.
 *
 * O piso é hoje, não o dia 1: escolher uma data que já passou seria escolher
 * a multa, e o filho quase nunca quer isso — quando quer, é engano.
 */
export function dataDeAjusteValida(data, ciclo, hoje) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return false;
  if (String(data).slice(0, 7) !== ciclo) return false;
  if (Number(String(data).slice(8, 10)) > ultimoDiaDoCiclo(ciclo)) return false;
  return String(data) >= hoje;
}

async function rotaMensalidadeAjuste(body, env) {
  const { tipo, data, motivo } = body || {};
  const ciclo = cicloAtual();
  const hoje = hojeSP();

  if (tipo !== 'data' && tipo !== 'isencao') {
    return json({ error: "tipo tem que ser 'data' ou 'isencao'" }, 400);
  }
  if (!podeAjustar(ciclo, hoje)) {
    return json({ error: `a janela deste mês fechou no dia 5 (${ciclo}-05)` }, 409);
  }

  const token = await tokenGoogle(env);
  const quem = await quemFala(body, env, token);
  if (quem.erro) return json({ error: quem.erro }, quem.status);
  const { id: filho_id, filho } = quem;

  if (!(Number(filho.valor) > 0)) return json({ error: 'você já é isento', isento: true }, 409);
  if (tipo === 'data' && !dataDeAjusteValida(data, ciclo, hoje)) {
    return json({ error: 'a data tem que ser deste mês e não pode ser pra trás' }, 400);
  }

  const docId = `${filho_id}__${ciclo}`;
  let pedido = await fsGet(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, { token });

  // Mesma razão do /mensalidade: o pedido pode não existir ainda, e ninguém
  // pode ficar sem avisar por causa de lote não rodado.
  if (!pedido) {
    await fsCreateComId(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, token, {
      filho_id, filho_nome: filho.nome || '', ciclo,
      status: 'aberto', avisou_atraso: false,
      geradoEm: new Date().toISOString(), geradoPor: 'ajuste',
    });
    pedido = { ciclo, status: 'aberto' };
  }

  // Quem já pagou não ajusta nada. Sem isto dava pra pagar dia 2 e pedir
  // isenção dia 3, e o financeiro ficaria com um mês pago e isento ao mesmo
  // tempo — dois números verdadeiros contando a mesma coisa duas vezes.
  if (estaPago(pedido, await pagosDoCiclo(ciclo, token), filho_id)) {
    return json({ error: 'este mês já está pago', pago: true }, 409);
  }
  // Isenção já julgada não volta pra fila pela porta do filho.
  if (pedido.isencao_status === 'aprovada' || pedido.isencao_status === 'recusada') {
    return json({ error: `a isenção deste mês já foi ${pedido.isencao_status}`, isencao_status: pedido.isencao_status }, 409);
  }

  const texto = String(motivo || '').trim().slice(0, 500);
  const patch = tipo === 'data'
    ? {
        venc_combinado: String(data),
        venc_combinado_em: new Date().toISOString(),
        venc_combinado_motivo: texto,
      }
    : {
        isencao_status: 'pedida',
        isencao_pedida_em: new Date().toISOString(),
        isencao_motivo: texto,
      };

  await fsPatch(PROJETO_PVD, 'fin_mensalidade_pedidos', docId, token, patch);

  // O Pai precisa saber na hora: é decisão dele, e ela tem prazo.
  await mandarPush(env, {
    tag: `ajuste-${filho_id}`,
    titulo: tipo === 'data' ? 'Filho remarcou a contribuição' : 'Pedido de isenção do mês',
    corpo: tipo === 'data'
      ? `${filho.nome || 'alguém'} vai pagar dia ${String(data).slice(8, 10)}`
      : `${filho.nome || 'alguém'} — ${texto || 'sem motivo escrito'}`.slice(0, 140),
    url: 'index.html#lembretes',
  });

  return json({ ok: true, ciclo, tipo, ...patch });
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

  // 2ª prova: o valor cobrado bate com o que a gente cobrou.
  //
  // De onde sai o "esperado" depende do tipo (ver TIPOS.valorFixado):
  //   recalculado → onde o público cria o pedido e nada gravado é confiável
  //   fixado      → o que foi oferecido no link. A comparação é contra a OFERTA,
  //                 não contra o valor de agora: se o cadastro do filho mudou
  //                 depois do link, quem pagou o que a tela mostrava pagou certo.
  let esperado, erro;
  if (t.valorFixado) {
    esperado = Number(pedido.checkout_centavos) || 0;
    if (!esperado) erro = 'pedido sem checkout_centavos (link nunca foi gerado?)';
  } else {
    ({ centavos: esperado, erro } = await valorEsperado(tipo, pedido, env, token));
  }

  const cobrado = Number(check.amount) || 0;
  if (erro || !esperado) {
    console.error('sem valor esperado', order_nsu, erro);
    await registrar('recusado', `sem valor esperado: ${erro || 'zero'}`);
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
    // Mensalidade congela o que foi cobrado — daqui pra frente mudar o cadastro
    // do filho não reescreve o passado.
    ...(tipo === 'men' && {
      valor_cobrado: cobrado / 100,
      multa_aplicada: Number(pedido.checkout_multa) || 0,
      vencimento_aplicado: pedido.checkout_vencimento || null,
    }),
  });

  // O financeiro renderiza o booleano fin_pagamentos/{ciclo}.{filho}. Flipar
  // aqui é o que faz a mensalidade se marcar sozinha lá, sem mexer naquele app.
  if (tipo === 'men' && pedido.filho_id && pedido.ciclo) {
    await marcarPagamentoNoFinanceiro(pedido.ciclo, pedido.filho_id, token, registrar);
  }

  await registrar('pago', `${t.colecao}/${doc_id} marcado pago, ${cobrado} centavos`);

  // Notificação no celular do admin. Dinheiro que entra é a coisa que ele mais
  // quer saber na hora, e aqui é o único ponto por onde toda entrada passa.
  // Não precisa de cron: o pagamento avisa a si mesmo.
  await mandarPush(env, {
    tag: 'venda',
    titulo: tipo === 'men' ? 'Contribuição paga' : 'Pagamento confirmado',
    corpo: `${pedido.filho_nome || pedido.nome || pedido.produto_nome || 'pedido'} — ${brl(cobrado / 100)} no ${metodo === 'pix' ? 'PIX' : 'cartão'}`,
    url: tipo === 'men' ? 'index.html#filhos' : 'index.html#pedidos',
  });

  return { ok: true, centavos: cobrado, metodo };
}

/**
 * fin_pagamentos/{ciclo} é um mapa { filhoId: true }. Um doc por mês, e é o que
 * o financeiro lê. Escreve só o campo do filho, sem tocar nos outros.
 *
 * Falha aqui NÃO derruba a confirmação: o pagamento já está registrado no
 * pedido, e o toggle manual do financeiro continua existindo pra isso.
 */
async function marcarPagamentoNoFinanceiro(ciclo, filhoId, token, registrar = () => {}) {
  if (!/^\d{4}-\d{2}$/.test(String(ciclo)) || !/^[A-Za-z0-9_-]{1,64}$/.test(String(filhoId))) {
    await registrar('aviso', `ciclo ou filho_id fora do formato: ${ciclo} / ${filhoId}`);
    return;
  }
  try {
    // Backtick no fieldPath porque id do Firestore pode começar com dígito ou
    // ter '-', e aí o caminho sem quote é inválido.
    const mask = `updateMask.fieldPaths=${encodeURIComponent('`' + filhoId + '`')}`;
    const url = `${fsUrl(PROJETO_PVD, 'fin_pagamentos', ciclo)}?${mask}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [filhoId]: { booleanValue: true } } }),
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
  } catch (e) {
    console.error('flip do fin_pagamentos falhou', ciclo, filhoId, e);
    await registrar('aviso', `pago, mas não marquei fin_pagamentos/${ciclo}: ${e.message}`);
  }
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

/** Lista uma collection inteira, paginando. Devolve [{id, ...campos}]. */
async function fsList(projeto, colecao, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/${colecao}`;
  const out = [];
  let pageToken = '';

  do {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Firestore LIST ${colecao}: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    for (const d of data.documents || []) {
      out.push({
        id: d.name.split('/').pop(),
        ...desembrulha({ mapValue: { fields: d.fields || {} } }),
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return out;
}

/**
 * Query com filtro, numa subrequest só. Devolve [{id, ...campos}].
 *
 * Existe porque o teto de subrequests do Worker é por invocação: ler o pedido
 * de 48 filhos com 48 `fsGet` estoura sozinho, e a mesma leitura cabe numa
 * query. Filtro é `{campo, valor, op}` (op default EQUAL) ou uma lista deles.
 *
 * Um filtro de igualdade ou de intervalo num campo só usa o índice automático
 * do Firestore — não precisa criar índice composto pra nada daqui.
 */
async function fsQuery(projeto, colecao, token, filtros, limite = 300) {
  const lista = (Array.isArray(filtros) ? filtros : [filtros]).map((f) => ({
    fieldFilter: {
      field: { fieldPath: f.campo },
      op: f.op || 'EQUAL',
      value: f.valor instanceof Date ? { timestampValue: f.valor.toISOString() } : embrulha(f.valor),
    },
  }));

  const url = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents:runQuery`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: colecao }],
        where: lista.length === 1 ? lista[0] : { compositeFilter: { op: 'AND', filters: lista } },
        limit: limite,
      },
    }),
  });
  if (!resp.ok) throw new Error(`Firestore QUERY ${colecao}: ${resp.status} ${await resp.text()}`);

  const linhas = await resp.json();
  return (Array.isArray(linhas) ? linhas : [])
    .filter((l) => l.document)
    .map((l) => ({
      id: l.document.name.split('/').pop(),
      ...desembrulha({ mapValue: { fields: l.document.fields || {} } }),
    }));
}

/** Apaga um doc. Usado só pra tirar token de push morto. 404 não é erro. */
async function fsDelete(projeto, colecao, id, token) {
  const resp = await fetch(fsUrl(projeto, colecao, encodeURIComponent(id)), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) {
    console.error(`Firestore DELETE ${colecao}/${id}: ${resp.status}`);
  }
}

/**
 * Cria doc com id escolhido. Devolve 'criado' | 'existe' | 'erro'.
 *
 * O 409 do Firestore é o que dá idempotência ao lote de graça: não precisa ler
 * antes pra saber se já existe, e não há risco de sobrescrever quem já pagou.
 */
async function fsCreateComId(projeto, colecao, id, token, campos) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/${colecao}` +
    `?documentId=${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: embrulha(campos).mapValue.fields }),
  });
  if (resp.ok) return 'criado';
  if (resp.status === 409) return 'existe';
  console.error(`Firestore CREATE ${colecao}/${id}: ${resp.status} ${await resp.text()}`);
  return 'erro';
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

const ESCOPO_FIRESTORE = 'https://www.googleapis.com/auth/datastore';
const ESCOPO_AUTH = 'https://www.googleapis.com/auth/identitytoolkit';

// Cache por escopo: o token do Firestore e o do Identity Toolkit são diferentes.
const tokenCache = {};

async function tokenGoogle(env, escopo = ESCOPO_FIRESTORE) {
  const agora = Math.floor(Date.now() / 1000);
  const cache = tokenCache[escopo];
  if (cache?.valor && cache.expira - 60 > agora) return cache.valor;

  if (!env.GCP_SA_EMAIL || !env.GCP_SA_KEY) {
    throw new Error('GCP_SA_EMAIL / GCP_SA_KEY não configurados no Worker');
  }

  const claim = {
    iss: env.GCP_SA_EMAIL,
    scope: escopo,
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

  tokenCache[escopo] = { valor: data.access_token, expira: agora + (data.expires_in || 3600) };
  return data.access_token;
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
