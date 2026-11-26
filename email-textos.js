/**
 * Os textos dos emails que o admin manda. Só monta string — não busca, não
 * grava, não decide.
 *
 * ── POR QUE SÓ ISTO SAIU DO index.html ────────────────────────────────────
 *
 * O `index.html` tem 8.545 linhas de JavaScript e 184 funções. Medi o que dava
 * pra tirar sem risco, e a resposta é: quase nada, por dois motivos.
 *
 * 1. Os comentários de seção MENTEM sobre o conteúdo. A faixa "EMAIL DE
 *    CONFIRMAÇÃO" contém `renderEscalas`, `gerarEscalasEmLote` e mais vinte
 *    funções de escala. Cortar por faixa de comentário levaria junto código
 *    que não tem nada a ver, e é assim que se quebra uma tela sem perceber.
 *
 * 2. 356 usos de `S.` e 150 de `window.` amarram tudo a um estado global. Um
 *    módulo que precise de `S` ou pendura no window (e aí não é módulo, é o
 *    mesmo acoplamento com outro nome) ou recebe `S` como argumento.
 *
 * Estas sete funções recebem `S` como ARGUMENTO. Isso as torna testáveis sem
 * navegador e sem Firebase — e é o degrau que o resto do arquivo ainda não tem.
 *
 * O corte de verdade do index.html começa por extrair o próprio `S` num módulo.
 * Isso é trabalho deliberado, não sobra de fim de sessão.
 */

// ── A MOLDURA ────────────────────────────────────────────────────────────────
// Os quatro emails usam a mesma moldura, na gramática do cartaz de gira: papel
// preto, título vermelho com o conector verde manuscrito, objetos nos cantos.
// O título é imagem (`/email/<nome>.jpg` no domínio), porque fonte da casa não
// chega no Gmail. Quem gera as imagens é candieiro-conteudo/email/gerar.sh.
// Tudo em tabela e estilo inline: é o que o Gmail e o Outlook respeitam.
// Largura fluida até 600: a moldura antiga tinha 560 fixo e estourava no celular.
// As quatro cores da casa: preto, branco, amarelo e vermelho. Sem verde, nem
// no botão do WhatsApp.
const C = { fundo:'#202020', papel:'#202020', cartao:'#1f1f1f', linha:'#4d4d4d',
  osso:'#ffffff', osso2:'#d2d2d2', apagado:'#9a9a9a', vermelho:'#e8110f', verde:'#fec802', zap:'#fec802' };
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const ZAP = 'https://wa.me/5519992494267';
const SITE = 'https://terreirodocandieiro.com.br';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const primeiroNome = n => esc(String(n || '').trim().split(/\s+/)[0]);
const reais = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

const rotulo = (t, cor = C.apagado) =>
  `<div style="font:700 11px/1.4 ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${cor};margin:0 0 6px">${t}</div>`;
const par = (t, extra = '') => `<p style="margin:0 0 16px;font:400 15px/1.65 ${SANS};color:${C.osso2};${extra}">${t}</p>`;
/** Botão à prova de cliente: a cor mora na célula, não só no <a>. */
const botao = (href, texto, fundo = C.vermelho, tinta = fundo === C.verde ? '#0d0d0d' : '#ffffff') =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px"><tr>
    <td bgcolor="${fundo}" style="border-radius:8px"><a href="${href}" target="_blank" style="display:inline-block;padding:15px 26px;font:700 15px/1 ${SANS};color:${tinta};text-decoration:none;border-radius:8px">${texto}</a></td>
  </tr></table>`;
/** Os dados que a pessoa volta pra conferir. */
const cartao = miolo =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${C.linha};border-radius:10px;margin:0 0 24px;background:rgba(0,0,0,.28)"><tr><td style="padding:20px 22px">${miolo}</td></tr></table>`;
const campo = (r, v, ultimo = false) =>
  `${rotulo(r)}<div style="font:600 16px/1.4 ${SANS};color:${C.osso};margin:0 0 ${ultimo ? 0 : 16}px">${v}</div>`;
/** Nota com fio colorido à esquerda: endereço, PIX, aviso. */
const nota = (titulo, miolo, fio = C.verde) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px"><tr>
    <td width="3" bgcolor="${fio}" style="width:3px"></td>
    <td style="padding:2px 0 2px 16px">${titulo ? rotulo(titulo, fio) : ''}<div style="font:400 14px/1.6 ${SANS};color:${C.osso2}">${miolo}</div></td>
  </tr></table>`;
/** Passo numerado do guia de boas-vindas. */
const passo = (n, titulo, miolo) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px"><tr>
    <td width="40" valign="top" style="width:40px"><div style="width:30px;height:30px;border-radius:15px;background:${C.vermelho};color:#fff;font:700 15px/30px ${SANS};text-align:center">${n}</div></td>
    <td valign="top"><div style="font:700 15px/1.4 ${SANS};color:${C.osso};margin:5px 0 4px">${titulo}</div><div style="font:400 14px/1.6 ${SANS};color:${C.osso2}">${miolo}</div></td>
  </tr></table>`;
const fio = `<div style="height:1px;background:${C.linha};margin:8px 0 26px;line-height:1px;font-size:0">&nbsp;</div>`;

/**
 * `aviso` é o pré-cabeçalho: a linha cinza ao lado do assunto na caixa de
 * entrada. `cabecalho` é o nome do JPG em /email/ do domínio.
 */
function moldura({ cabecalho, alt, titulo, aviso = '', corpo }) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<style>
  /* Email, telefone e chave PIX viram link sozinhos no Gmail e no iPhone, em
     azul escuro, que some no papel preto. Isto devolve a cor do texto. */
  a[x-apple-data-detectors], u + #corpo a, #MessageViewBody a { color: inherit !important; text-decoration: none !important; }
</style>
<title>${alt}</title>
</head>
<body id="corpo" style="margin:0;padding:0;background:${C.fundo} url(${SITE}/email/papel.jpg);-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.fundo}">${aviso}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.fundo}" background="${SITE}/email/papel.jpg" style="background:${C.fundo} url(${SITE}/email/papel.jpg) repeat"><tr><td align="center" style="padding:0">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px">
    <tr><td style="font-size:0;line-height:0"><img src="${SITE}/email/${cabecalho}.png" alt="${alt}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:${C.vermelho};font:700 24px ${SANS}"></td></tr>
    <tr><td style="padding:14px 24px 10px">
      <h1 style="margin:0 0 16px;font:800 24px/1.25 ${SANS};color:${C.osso};letter-spacing:-.01em">${titulo}</h1>
      ${corpo}
    </td></tr>
    <tr><td align="center" style="padding:22px 24px 0;font:400 12px/1.8 ${SANS};color:${C.apagado}">
      R. Angelo Vicentim, 236 · Barão Geraldo · Campinas-SP<br>
      <a href="${SITE}" style="color:${C.osso2};text-decoration:none">terreirodocandieiro.com.br</a> &nbsp;·&nbsp;
      <a href="https://instagram.com/terreirodocandieiro" style="color:${C.osso2};text-decoration:none">@terreirodocandieiro</a>
    </td></tr>
    <tr><td style="font-size:0;line-height:0"><img src="${SITE}/email/rodape.png" alt="Terreiro do Candieiro" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/**
 * "Como pagar": PIX e cartão. Sem link de cartão, o cartão continua possível:
 * o Pai manda o link pelo WhatsApp. Usado na reserva da consulta e do pedido.
 */
function blocoPagar({ pixKey, pixTit = '', cardLink, cartaoPrimeiro = false, pedidoZap }) {
  const pix = pixKey ? nota('PIX', `<span style="font:700 15px/1.5 ${MONO};color:${C.osso};word-break:break-all"><a style="color:${C.osso};text-decoration:none">${pixKey}</a></span>${pixTit?`<br>${pixTit}`:''}<br>Manda o comprovante no WhatsApp pra gente confirmar.`, C.verde) : '';
  const zapCartao = `${ZAP}?text=${encodeURIComponent(pedidoZap)}`;
  const cartaoBox = cardLink
    ? nota('Cartão de crédito ou débito', `Confirma na hora, sem comprovante.${botao(cardLink, 'Pagar com cartão')}`, C.vermelho)
    : nota('Cartão de crédito', `Prefere pagar no cartão? <a href="${zapCartao}" target="_blank" style="color:${C.osso};font-weight:700;text-decoration:underline">Manda uma mensagem no WhatsApp</a> que a gente te envia o link.`, C.vermelho);
  return `${rotulo('Como pagar', C.osso)}<div style="height:6px"></div>${cartaoPrimeiro ? cartaoBox + pix : pix + cartaoBox}`;
}

/**
 * Reserva = o Pai marcou "ainda não pagou". Aí o email não diz "confirmada":
 * diz que o horário está guardado e que falta pagar. O "confirmada" sai
 * depois, quando o pagamento entra (admin marca pago, ou o checkout avisa).
 */
export function emailAtendEhReserva(a) {
  const pago = (a.status_pagamento || '').startsWith('pago');
  const semCobranca = !(Number(a.valor) > 0) || a.status_pagamento === 'isento';
  return !pago && !semCobranca && a.cobrar_no_email === true;
}

export function _emailAtendSubject(a) {
  const servico = a.servico_nome || 'consulta';
  const dataPart = a.data ? new Date(a.data+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long'}) : '';
  if (emailAtendEhReserva(a)) return `Seu horário está reservado, falta o pagamento${dataPart?` (${dataPart})`:''}`;
  return `${servico} confirmada${dataPart?` (${dataPart})`:''}`;
}

/**
 * Link "adicionar ao Google Agenda". Não precisa de login nem de API: o
 * Google abre o evento preenchido e a pessoa só salva. A hora vai como hora
 * local de São Paulo (`ctz`), sem converter pra UTC.
 */
export function linkGoogleAgenda(a, S) {
  if (!a.data || !/^\d{1,2}:\d{2}$/.test(a.hora || '')) return '';
  const [h, m] = a.hora.split(':').map(Number);
  const ini = new Date(`${a.data}T00:00:00Z`); ini.setUTCHours(h, m);
  const fim = new Date(ini.getTime() + (Number(a.duracao_min) || 60) * 60000);
  const fmt = d => d.toISOString().slice(0, 16).replace(/[-:]/g, '') + '00';
  const online = a.modalidade === 'online';
  const endereco = (S.cfgAgendamento || {}).endereco || 'R. Angelo Vicentim 236, Barão Geraldo, Campinas-SP';
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${a.servico_nome || 'Consulta'} · Terreiro do Candieiro`,
    dates: `${fmt(ini)}/${fmt(fim)}`,
    ctz: 'America/Sao_Paulo',
    details: online ? 'Online. O link da chamada chega uns minutos antes, por email ou WhatsApp.' : `Dúvidas: ${ZAP}`,
    location: online ? 'Online' : endereco,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function _buildEmailAtendHTML(a, S) {
  const servico = esc(a.servico_nome || 'Consulta');
  const dataBr = a.data ? new Date(a.data+'T00:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}) : '—';
  const online = a.modalidade === 'online';
  const valor = Number(a.valor)||0;
  const pago = (a.status_pagamento||'').startsWith('pago');
  const semCobranca = valor <= 0 || a.status_pagamento === 'isento';
  const cfgA = S.cfgAgendamento || {};
  const endereco = esc(cfgA.endereco || 'R. Angelo Vicentim 236, Barão Geraldo, Campinas-SP');
  const pixKey = esc((cfgA.pix || '').trim());
  const pixTit = esc((cfgA.pix_titular || '').trim());
  const linkZap = `${ZAP}?text=${encodeURIComponent('Salve! Sobre meu agendamento de '+dataBr+'…')}`;

  // Pagamento só entra quando o admin marcou "ainda não pagou". Pendente sem a
  // marca é o caso comum de quem já pagou e ninguém conferiu: falar de PIX ali
  // faz a pessoa achar que deve.
  const cobrar = !pago && !semCobranca && a.cobrar_no_email === true;
  const pagar = cobrar ? blocoPagar({
    pixKey, pixTit,
    cardLink: a.checkout_url || (S.servicos||[]).find(x => x.id === a.servico_id)?.infinity_link,
    cartaoPrimeiro: ['cartao','cartão','credito','crédito','debito','débito'].some(m => (a.metodo_indicado||'').toLowerCase().includes(m)),
    pedidoZap: 'Salve! Quero pagar minha consulta de '+dataBr+' no cartão de crédito.',
  }) : '';

  return moldura({
    cabecalho: 'agendamento', alt: cobrar ? 'Seu horário reservado' : 'Sua consulta confirmada',
    aviso: cobrar ? `Seu horário de ${dataBr} às ${a.hora||''} fica guardado por 24 horas. Falta o pagamento.` : `${a.servico_nome || 'Consulta'}, ${dataBr} às ${a.hora||''}.`,
    titulo: `Salve, ${primeiroNome(a.consulente_nome)}.`,
    corpo: `
      ${par(cobrar
        ? 'Seu horário fica guardado por 24 horas. Falta só o pagamento pra confirmar. Quando ele entrar, a gente te manda a confirmação.'
        : 'Tá tudo certo com o seu agendamento. Guarda este email: os dados ficam aqui.')}
      ${cobrar ? pagar + fio : ''}
      ${cartao(`
        ${campo('Serviço', servico)}
        ${campo('Data e horário', `${dataBr.charAt(0).toUpperCase() + dataBr.slice(1)} · ${esc(a.hora||'')}`)}
        ${campo('Modalidade', online ? 'Online' : 'Presencial', !(pago && !semCobranca) && !cobrar)}
        ${(pago && !semCobranca) || cobrar ? campo('Valor', `<span style="color:${C.osso};font-size:20px">${reais(valor)}</span> <span style="font-size:13px;font-weight:600;color:${pago ? C.verde : C.apagado}">· ${pago ? 'pago' : 'a pagar'}</span>`, true) : ''}
      `)}
      ${online
        ? nota('Online', 'O link da chamada chega uns minutos antes, por email ou WhatsApp.', C.verde)
        : nota('Endereço', endereco, C.verde)}
      ${linkGoogleAgenda(a, S) ? botao(linkGoogleAgenda(a, S), 'Colocar na minha agenda', C.verde) + '<div style="height:18px"></div>' : ''}
      ${fio}
      ${par('Qualquer coisa antes do dia, chama a gente:')}
      ${botao(linkZap, 'Falar no WhatsApp', C.zap)}
    `
  });
}

export function _buildEmailAtendText(a, S) {
  const nomePrim = (a.consulente_nome||'').split(' ')[0];
  const servico = a.servico_nome || 'Consulta';
  const dataBr = a.data ? new Date(a.data+'T00:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}) : '—';
  const modalidade = a.modalidade === 'online' ? 'Online' : 'Presencial';
  const valor = Number(a.valor)||0;
  const pago = (a.status_pagamento||'').startsWith('pago');
  const cfgA = S.cfgAgendamento || {};
  const semCobranca = valor <= 0 || a.status_pagamento === 'isento';
  const pixKey = (cfgA.pix || '').trim();
  const servicoDoc = (S.servicos||[]).find(x => x.id === a.servico_id);
  const cardLink = a.checkout_url || servicoDoc?.infinity_link;
  const cobrar = !pago && !semCobranca && a.cobrar_no_email === true;

  return `Salve ${nomePrim},

${cobrar ? 'Seu horário fica guardado por 24 horas. Falta só o pagamento pra confirmar. Quando ele entrar, a gente te manda a confirmação.' : 'Agendamento confirmado por aqui.'}

Serviço: ${servico}
Quando: ${dataBr} às ${a.hora||''}
Modalidade: ${modalidade}
${(pago && !semCobranca) || cobrar ? `Valor: R$ ${valor.toFixed(2).replace('.',',')} ${pago?'(pago)':'(a pagar)'}\n` : ''}
${a.modalidade !== 'online' ? `Endereço: R. Angelo Vicentim 236, Barão Geraldo, Campinas-SP\n` : `Online: o link da chamada chega por email ou WhatsApp uns minutos antes.\n`}
${cobrar ? `${pixKey?`PIX: ${pixKey}\nManda o comprovante no WhatsApp pra gente confirmar.\n`:''}${cardLink?`\nCartão (crédito ou débito): ${cardLink}\nConfirma na hora, sem comprovante.\n`:`\nPrefere pagar no cartão de crédito? Manda uma mensagem no WhatsApp que a gente te envia o link: https://wa.me/5519992494267\n`}` : ''}
${linkGoogleAgenda(a, S) ? `Colocar na sua agenda: ${linkGoogleAgenda(a, S)}\n\n` : ''}Qualquer coisa antes do dia, chama: https://wa.me/5519992494267

Terreiro do Candieiro
terreirodocandieiro.com.br`;
}

export function _emailConfirmacaoSubject(p, produto) {
  const isParcelado = produto?.parcelamento?.ativo && (p.parcelas_total||1) > 1;
  const isInscricao = produto?.turmas && produto.turmas.length > 0;
  const acao = isParcelado ? 'Matrícula confirmada' : (isInscricao ? 'Inscrição confirmada' : 'Pedido confirmado');
  return `${acao}: ${p.produto_nome || 'Terreiro do Candieiro'}`;
}

export function _proximasParcelas(p, produto) {
  const total = Number(p.parcelas_total) || 1;
  if (total <= 1 || !produto?.parcelamento?.ativo) return [];
  const dia = Number(produto.parcelamento.vencimento_dia) || 10;
  const valor = Number(p.valor) || 0;
  const out = [];
  // 2ª parcela: o mês que o produto declara (ex.: turma que começa no ano que vem);
  // sem isso, o mês seguinte ao da matrícula. Contar do dia do envio errava as datas.
  const ini = produto.parcelamento.segunda_parcela_mes || '';
  const base = /^\d{4}-\d{2}$/.test(ini) ? new Date(+ini.slice(0, 4), +ini.slice(5) - 1, 1)
    : (() => { const h = p.criadoEm?.toDate?.() || new Date(); return new Date(h.getFullYear(), h.getMonth() + 1, 1); })();
  for (let i = 2; i <= total; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + (i - 2), dia);
    out.push({
      n: i,
      data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
      valor: valor.toFixed(2).replace('.', ',')
    });
  }
  return out;
}

export function _buildEmailConfirmacaoHTML(p, produto, S) {
  const isParcelado = produto?.parcelamento?.ativo && (p.parcelas_total||1) > 1;
  const isInscricao = produto?.turmas && produto.turmas.length > 0;
  const acaoTitulo = isParcelado ? 'Matrícula confirmada' : (isInscricao ? 'Inscrição confirmada' : 'Pedido confirmado');
  const turma = p.turma_id ? (produto?.turmas||[]).find(t => t.id === p.turma_id) : null;
  const proxParcelas = _proximasParcelas(p, produto);
  // PIX: override do produto (se preenchido) > central do terreiro (cfgAgendamento.pix)
  const pixKey = esc((produto?.pix && produto.pix.trim()) || (S.cfgAgendamento?.pix || '').trim());
  const mensagemInicial = isParcelado
    ? `A 1ª parcela chegou. Bom te ter com a gente nesse processo.`
    : (isInscricao ? `Sua vaga tá garantida. A gente te espera no dia.` : `Pagamento recebido. Obrigado por confiar na casa.`);
  const proxPassos = isParcelado
    ? `Sua turma começa em <strong style="color:${C.osso}">${esc(turma?.detalhes || 'breve')}</strong>. As próximas parcelas saem por PIX (chave logo abaixo). Quando pagar, manda o comprovante no WhatsApp pra gente confirmar.`
    : (isInscricao ? `A gente te espera no dia: <strong style="color:${C.osso}">${esc(turma?.detalhes || 'a combinar')}</strong>. Se for sua primeira vez na casa, chega uns 15 min antes pra você se localizar com calma.` : `Qualquer coisa, manda mensagem no WhatsApp.`);
  const selo = (t, cor) => `<span style="display:inline-block;margin:12px 6px 0 0;padding:5px 11px;border:1px solid ${cor};color:${cor};font:700 12px/1.3 ${SANS};border-radius:14px">${t}</span>`;

  const parcelas = proxParcelas.length ? `
    ${rotulo('Próximas parcelas', C.osso)}
    ${cartao(proxParcelas.map((x, i) => `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${i < proxParcelas.length-1 ? `border-bottom:1px solid ${C.linha};` : ''}"><tr>
        <td style="padding:10px 0;font:700 14px/1.4 ${SANS};color:${C.osso}">${x.n}ª parcela<div style="font-weight:400;font-size:13px;color:${C.apagado}">${x.data}</div></td>
        <td align="right" style="padding:10px 0;font:700 15px/1.4 ${SANS};color:${C.osso}">R$ ${x.valor}</td>
      </tr></table>`).join(''))}
    ${pixKey ? nota('PIX', `<span style="font:700 15px/1.5 ${MONO};color:${C.osso};word-break:break-all"><a style="color:${C.osso};text-decoration:none">${pixKey}</a></span>`, C.verde) : ''}` : '';

  return moldura({
    cabecalho: 'pedido', alt: acaoTitulo,
    aviso: `${p.produto_nome || ''} · ${mensagemInicial}`,
    titulo: `${acaoTitulo}, ${primeiroNome(p.nome)}.`,
    corpo: `
      ${par(mensagemInicial)}
      ${cartao(`
        ${campo(acaoTitulo.startsWith('Pedido') ? 'O que você comprou' : 'O que você reservou', esc(p.produto_nome || 'Produto'), !turma && !produto?.local)}
        ${turma ? campo('Turma', `${esc(turma.nome)}${turma.detalhes ? `<div style="font-weight:400;font-size:14px;color:${C.osso2}">${esc(turma.detalhes)}</div>` : ''}`, !produto?.local) : ''}
        ${produto?.local ? campo('Local', esc(produto.local), true) : ''}
        <div style="height:1px;background:${C.linha};margin:18px 0;line-height:1px;font-size:0">&nbsp;</div>
        ${rotulo(isParcelado ? '1ª parcela paga' : 'Valor pago')}
        <div style="font:800 28px/1.2 ${SANS};color:${C.osso}">${reais(p.valor)}</div>
        ${isParcelado ? `<div style="font:400 13px/1.5 ${SANS};color:${C.apagado};margin-top:6px">De ${p.parcelas_total} parcelas mensais · vencimento dia ${produto.parcelamento.vencimento_dia}</div>` : ''}
        ${p.desconto_afirmativo ? selo('Desconto afirmativo aplicado', C.verde) : ''}
        ${p.promo_aplicada ? selo(`${esc(p.promo_label || 'Promoção')} aplicada`, C.verde) : ''}
      `)}
      ${parcelas}
      ${nota('O que vem agora', proxPassos, C.vermelho)}
      ${produto?.descricao && !isParcelado ? `${rotulo(`Sobre ${esc(p.produto_nome)}`, C.osso)}${par(esc(produto.descricao.slice(0, 1000)) + (produto.descricao.length > 1000 ? '…' : ''), 'white-space:pre-wrap;font-size:14px')}` : ''}
      ${fio}
      ${par('Qualquer coisa, é só chamar.')}
      ${botao(ZAP, 'Falar no WhatsApp', C.zap)}
    `
  });
}

export function _buildEmailConfirmacaoText(p, produto) {
  const isParcelado = produto?.parcelamento?.ativo && (p.parcelas_total||1) > 1;
  const turma = p.turma_id ? (produto?.turmas||[]).find(t => t.id === p.turma_id) : null;
  const valor = (Number(p.valor) || 0).toFixed(2).replace('.', ',');
  const linhas = [
    `Salve ${(p.nome||'').split(' ')[0]},`,
    '',
    isParcelado ? 'Matrícula confirmada por aqui.' : 'Pedido confirmado por aqui.',
    '',
    `Produto: ${p.produto_nome}`,
    turma ? `Turma: ${turma.nome}${turma.detalhes ? ' · ' + turma.detalhes : ''}` : '',
    `Valor pago: R$ ${valor}${isParcelado ? ' (1ª parcela)' : ''}`,
    isParcelado ? `Total de parcelas: ${p.parcelas_total}, vencimento dia ${produto.parcelamento.vencimento_dia}` : '',
    p.desconto_afirmativo ? 'Desconto afirmativo aplicado.' : '',
    '',
    'Qualquer coisa, chama no WhatsApp: https://wa.me/5519992494267',
    '',
    'Terreiro do Candieiro',
    'R. Angelo Vicentim, 236 · Barão Geraldo · Campinas-SP',
    'terreirodocandieiro.com.br'
  ];
  return linhas.filter(Boolean).join('\n');
}

// ── LEMBRETE DE AMANHÃ ───────────────────────────────────────────────────────
// Morava no index.html; veio pra cá pra usar a mesma moldura e ter teste.
export function _buildLembreteHTML(filho, dataBr) {
  return moldura({
    cabecalho: 'amanha', alt: 'Amanhã na casa',
    aviso: `${filho.itens.length} coisa${filho.itens.length===1?'':'s'} pra você ${dataBr}.`,
    titulo: `Salve, ${primeiroNome(filho.nome)}.`,
    corpo: `
      ${par(`Amanhã, <strong style="color:${C.osso}">${esc(dataBr)}</strong>, você tem na casa:`)}
      ${cartao(filho.itens.map((it, i) => `<div style="font:600 16px/1.45 ${SANS};color:${C.osso};padding:${i ? '12px' : '0'} 0 0;${i ? `border-top:1px solid ${C.linha};margin-top:12px` : ''}"><span style="color:${C.vermelho}">●</span>&nbsp; ${esc(it.desc)}</div>`).join(''))}
      ${nota('', 'Se rolar imprevisto, avisa antes pra gente encaixar alguém no seu lugar.', C.vermelho)}
      ${botao(`${SITE}/area-filho.html`, 'Abrir minha área')}
    `
  });
}

export function _buildLembreteText(filho, dataBr) {
  const nomePrim = (filho.nome||'').split(' ')[0];
  return `Salve ${nomePrim},

Amanhã (${dataBr}) você tem na casa:

${filho.itens.map(it => `• ${it.desc}`).join('\n')}

Se rolar imprevisto, avisa antes pra gente encaixar alguém no seu lugar.

Sua área pessoal: ${SITE}/area-filho.html

Terreiro do Candieiro`;
}

// ── BOAS-VINDAS ──────────────────────────────────────────────────────────────
// Sai quando o admin aprova um cadastro de filho e a ficha tem email. É o
// único email que a pessoa recebe antes de entrar na área, então ele é o guia
// de como entrar: nome → 4 finais do celular → PIN → instalar. Os passos
// descrevem o que a area-filho.html faz HOJE; mudou a entrada, muda aqui.
export function _emailBoasVindasSubject(f) {
  return `Boas-vindas ao Candieiro, ${String(f.nome||'').trim().split(/\s+/)[0]}`;
}

const contribuicao = f => {
  const v = Number(f.valor) || 0;
  if (v <= 0) return '';
  return `${reais(v)} por mês${/^\d{1,2}$/.test(String(f.prazo||'')) ? `, até o dia ${f.prazo}` : ''}`;
};

export function _buildEmailBoasVindasHTML(f) {
  const area = `${SITE}/area-filho.html`;
  const mens = contribuicao(f);
  return moldura({
    cabecalho: 'boas-vindas', alt: 'Boas-vindas à casa',
    aviso: 'Seu cadastro foi aprovado. Veja como entrar na sua área.',
    titulo: `Salve, ${primeiroNome(f.nome)}. Seu cadastro foi aprovado.`,
    corpo: `
      ${par('A partir de agora você tem uma área só sua no site da casa. É por ela que chegam as suas escalas, os avisos e a mensalidade.')}
      ${par('Deixar tudo pronto leva uns dois minutos:', 'color:' + C.osso + ';font-weight:600')}
      <div style="height:6px"></div>
      ${passo(1, 'Abra a área do filho', `Escolha o seu nome na lista.${botao(area, 'Abrir minha área')}`)}
      ${passo(2, 'Crie o seu PIN', 'Na primeira vez, a tela pede os <strong style="color:' + C.osso + '">4 últimos dígitos do seu celular</strong>, o mesmo do cadastro. Depois você escolhe um PIN de 4 números. Ele é a sua senha daqui pra frente.')}
      ${passo(3, 'Leia o termo da casa', 'Se a tela mostrar o termo, leia com calma e aceite. Ele aparece uma vez só.')}
      ${passo(4, 'Instale no celular e ative os avisos', 'Os avisos da casa chegam como notificação no celular, não por email. A própria área mostra o botão <strong style="color:' + C.osso + '">Instalar</strong>. No iPhone, abra pelo Safari, toque em Compartilhar e depois em <strong style="color:' + C.osso + '">Adicionar à Tela de Início</strong>. Abra pelo ícone novo e ative as notificações.')}
      ${fio}
      ${rotulo('O que tem na sua área', C.osso)}
      ${cartao([
        ['Início', 'suas tarefas e as perguntas da casa pra você'],
        ['Avisos', 'tudo que a casa mandou, guardado'],
        ['Agenda', 'suas escalas e a sua disponibilidade'],
        ['Mensalidade', 'o valor do mês, o pagamento e o pedido de reembolso'],
        ['Casa', 'a lista de afazeres e o que mais for seu'],
      ].map(([t, d], i) => `<div style="font:400 14px/1.5 ${SANS};color:${C.osso2};${i ? `border-top:1px solid ${C.linha};padding-top:11px;margin-top:11px` : ''}"><strong style="color:${C.osso};font-weight:700">${t}</strong> · ${d}</div>`).join(''))}
      ${mens ? nota('Sua contribuição', `${mens}. O lembrete e o link de pagamento aparecem na aba Mensalidade.`, C.verde) : ''}
      ${nota('Esqueceu o PIN?', 'A própria tela destrava pelo celular do seu cadastro. Se o número mudou, chama a gente no WhatsApp.', C.vermelho)}
      ${fio}
      ${par('Qualquer dúvida, é só chamar.')}
      ${botao(ZAP, 'Falar no WhatsApp', C.zap)}
    `
  });
}

export function _buildEmailBoasVindasText(f) {
  const mens = contribuicao(f);
  return `Salve ${String(f.nome||'').trim().split(/\s+/)[0]},

Seu cadastro foi aprovado. A partir de agora você tem uma área só sua no site da casa: escalas, avisos e mensalidade chegam por ela.

1. Abra a área do filho e escolha o seu nome: ${SITE}/area-filho.html
2. Na primeira vez, digite os 4 últimos dígitos do seu celular. Depois crie um PIN de 4 números, que é a sua senha daqui pra frente.
3. Se aparecer o termo da casa, leia e aceite. Ele aparece uma vez só.
4. Instale no celular e ative as notificações. Os avisos chegam por lá, não por email. No iPhone: Safari, Compartilhar, Adicionar à Tela de Início.
${mens ? `\nSua contribuição: ${mens}.\n` : ''}
Esqueceu o PIN? A tela destrava pelo celular do cadastro.

Dúvidas: ${ZAP}

Terreiro do Candieiro
terreirodocandieiro.com.br`;
}

// ── PEDIDO ESPERANDO PAGAMENTO ──────────────────────────────────────────────
// Mesma ideia da reserva da consulta: o pedido fica guardado 24h, e o
// "Pedido confirmado" só sai quando o Pai confirma o pagamento.
export function _emailPedidoReservaSubject(p) {
  return `Seu pedido está reservado, falta o pagamento${p.produto_nome ? ` (${p.produto_nome})` : ''}`;
}

export function _buildEmailPedidoReservaHTML(p, produto, S) {
  const pixKey = esc((produto?.pix && produto.pix.trim()) || (S.cfgAgendamento?.pix || '').trim());
  const pixTit = esc((S.cfgAgendamento?.pix_titular || '').trim());
  return moldura({
    cabecalho: 'pedido', alt: 'Seu pedido reservado',
    aviso: `${p.produto_nome || 'Seu pedido'} fica guardado por 24 horas. Falta o pagamento.`,
    titulo: `Salve, ${primeiroNome(p.nome)}.`,
    corpo: `
      ${par('Seu pedido fica guardado por 24 horas. Falta só o pagamento pra confirmar. Quando ele entrar, a gente te manda a confirmação.')}
      ${cartao(`
        ${campo('O que você pediu', esc(p.produto_nome || 'Produto'))}
        ${rotulo('Valor')}
        <div style="font:800 28px/1.2 ${SANS};color:${C.osso}">${reais(p.valor)} <span style="font-size:13px;font-weight:600;color:${C.apagado}">· a pagar</span></div>
      `)}
      ${blocoPagar({ pixKey, pixTit, cardLink: p.checkout_url, pedidoZap: `Salve! Quero pagar meu pedido (${p.produto_nome || 'produto'}) no cartão de crédito.` })}
      ${fio}
      ${par('Qualquer coisa, é só chamar.')}
      ${botao(ZAP, 'Falar no WhatsApp', C.zap)}
    `
  });
}

export function _buildEmailPedidoReservaText(p, produto, S) {
  const pixKey = ((produto?.pix && produto.pix.trim()) || (S.cfgAgendamento?.pix || '').trim());
  return `Salve ${(p.nome||'').split(' ')[0]},

Seu pedido fica guardado por 24 horas. Falta só o pagamento pra confirmar.

Pedido: ${p.produto_nome || 'Produto'}
Valor: ${reais(p.valor)} (a pagar)
${pixKey ? `\nPIX: ${pixKey}\nManda o comprovante no WhatsApp pra gente confirmar.\n` : ''}${p.checkout_url ? `\nCartão (crédito ou débito): ${p.checkout_url}\nConfirma na hora, sem comprovante.\n` : `\nPrefere pagar no cartão de crédito? Manda uma mensagem no WhatsApp que a gente te envia o link: https://wa.me/5519992494267\n`}
Terreiro do Candieiro
terreirodocandieiro.com.br`;
}
