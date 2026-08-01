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

export function _emailAtendSubject(a) {
  const servico = a.servico_nome || 'consulta';
  const dataPart = a.data ? new Date(a.data+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long'}) : '';
  return `${servico} confirmada${dataPart?` (${dataPart})`:''}`;
}

export function _buildEmailAtendHTML(a, S) {
  const nomePrim = (a.consulente_nome||'').split(' ')[0];
  const servico = a.servico_nome || 'Consulta';
  const dataBr = a.data ? new Date(a.data+'T00:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}) : '—';
  const modalidade = a.modalidade === 'online' ? '💻 Online' : '🏠 Presencial';
  const valor = Number(a.valor)||0;
  const pago = (a.status_pagamento||'').startsWith('pago');
  const cfgA = S.cfgAgendamento || {};
  const endereco = cfgA.endereco || 'R. Angelo Vicentim 236, Barão Geraldo, Campinas-SP';
  const pixKey = (cfgA.pix || '').trim();
  const pixTit = (cfgA.pix_titular || '').trim();
  const wa = '5519992494267';
  const linkAgenda = `https://wa.me/${wa}?text=${encodeURIComponent('Salve! Sobre meu agendamento de '+dataBr+'…')}`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#1a1410;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#1a1410">
    <tr><td align="center" style="padding:30px 16px">
      <table cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#fdf8ee;border-radius:14px;overflow:hidden">
        <tr><td align="center" style="padding:30px 24px 18px;background:#2a1f17">
          <img src="https://terreirodocandieiro.com.br/logocandieiro.png" alt="Candieiro" width="58" height="58" style="display:block;margin:0 auto 12px;background:#fff;border-radius:50%;padding:5px;box-shadow:0 4px 14px rgba(0,0,0,0.35)"/>
          <div style="font-size:12px;color:#d4a843;letter-spacing:.2em;text-transform:uppercase;font-weight:700">Terreiro do Candieiro</div>
        </td></tr>
        <tr><td style="padding:28px 28px 22px;color:#3e2f1c">
          <p style="font-size:17px;margin:0 0 16px;line-height:1.4">Salve <strong>${nomePrim}</strong>,</p>
          <p style="font-size:15px;margin:0 0 22px;line-height:1.55;color:#5a4738">Tá tudo certo com o seu agendamento. Os dados ficam aqui pra você se localizar:</p>

          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:rgba(212,168,67,.12);border-radius:10px;margin-bottom:22px">
            <tr><td style="padding:18px 20px">
              <div style="font-size:12px;color:#8a7560;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">Serviço</div>
              <div style="font-size:17px;color:#3e2f1c;font-weight:700;margin-bottom:12px">${servico}</div>
              <div style="font-size:12px;color:#8a7560;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">Data e horário</div>
              <div style="font-size:15px;color:#3e2f1c;font-weight:600;margin-bottom:12px;text-transform:capitalize">${dataBr} · ${a.hora||''}</div>
              <div style="font-size:12px;color:#8a7560;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">Modalidade</div>
              <div style="font-size:15px;color:#3e2f1c;font-weight:600;margin-bottom:12px">${modalidade}</div>
              <div style="font-size:12px;color:#8a7560;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">Valor</div>
              <div style="font-size:17px;color:#d4a843;font-weight:800">R$ ${valor.toFixed(2).replace('.',',')} ${pago?'<span style="color:#2a7a3a;font-size:13px;font-weight:600">· pago ✓</span>':'<span style="color:#a8825a;font-size:13px;font-weight:600">· a confirmar</span>'}</div>
            </td></tr>
          </table>

          ${a.modalidade === 'presencial' ? `
            <div style="padding:14px 18px;background:rgba(46,204,113,.1);border-left:3px solid #2a7a3a;border-radius:6px;margin-bottom:18px">
              <div style="font-size:12px;color:#2a7a3a;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">📍 Endereço</div>
              <div style="font-size:14px;color:#3e2f1c;line-height:1.5">${endereco}</div>
            </div>
          ` : `
            <div style="padding:14px 18px;background:rgba(52,152,219,.1);border-left:3px solid #3498db;border-radius:6px;margin-bottom:18px;font-size:13.5px;color:#3e2f1c;line-height:1.5">
              💻 <strong>Online</strong> · o link da chamada chega uns minutos antes, por email ou WhatsApp.
            </div>
          `}

          ${!pago ? (() => {
            const servicoDoc = (S.servicos||[]).find(x => x.id === a.servico_id);
            const cardLink = servicoDoc?.infinity_link;
            const indCartao = ['cartao','cartão','credito','crédito','debito','débito'].some(m => (a.metodo_indicado||'').toLowerCase().includes(m));
            const pixBox = pixKey ? `
              <div style="padding:14px 18px;background:rgba(212,168,67,.15);border:1px solid rgba(212,168,67,.4);border-radius:8px;margin-bottom:12px">
                <div style="font-size:11.5px;color:#8a7560;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px">📱 PIX</div>
                <div style="font-size:13.5px;color:#3e2f1c;line-height:1.55"><strong style="font-family:monospace;font-size:14px">${pixKey}</strong>${pixTit?` <span style="color:#8a7560">(${pixTit})</span>`:''}</div>
                <div style="font-size:12px;color:#8a7560;margin-top:6px;line-height:1.45">Manda o comprovante no WhatsApp pra gente confirmar.</div>
              </div>` : '';
            const cartaoBox = cardLink ? `
              <div style="padding:14px 18px;background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.4);border-radius:8px;margin-bottom:12px">
                <div style="font-size:11.5px;color:#1e6090;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:8px">💳 Cartão de crédito ou débito</div>
                <p style="margin:0 0 10px"><a href="${cardLink}" style="display:inline-block;padding:11px 20px;background:#3498db;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Pagar pelo InfinityPay</a></p>
                <div style="font-size:12px;color:#5a4738;line-height:1.45">Confirma na hora, sem precisar de comprovante.</div>
              </div>` : '';
            return indCartao ? (cartaoBox + pixBox) : (pixBox + cartaoBox);
          })() : ''}

          <p style="font-size:13.5px;color:#5a4738;line-height:1.55;margin:0 0 18px">Qualquer coisa antes do dia, me chama:</p>
          <p style="margin:0 0 12px"><a href="${linkAgenda}" style="display:inline-block;padding:12px 22px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14.5px">💬 WhatsApp</a></p>
        </td></tr>
        <tr><td align="center" style="padding:18px 28px 24px;background:#fdf8ee;border-top:1px solid #e5d5b8;font-size:11px;color:#8a7560;line-height:1.5">
          Terreiro do Candieiro · R. Angelo Vicentim 236, Barão Geraldo, Campinas-SP<br/>
          <a href="https://terreirodocandieiro.com.br" style="color:#d4a843;text-decoration:none">terreirodocandieiro.com.br</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function _buildEmailAtendText(a, S) {
  const nomePrim = (a.consulente_nome||'').split(' ')[0];
  const servico = a.servico_nome || 'Consulta';
  const dataBr = a.data ? new Date(a.data+'T00:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}) : '—';
  const modalidade = a.modalidade === 'online' ? 'Online' : 'Presencial';
  const valor = Number(a.valor)||0;
  const pago = (a.status_pagamento||'').startsWith('pago');
  const cfgA = S.cfgAgendamento || {};
  const pixKey = (cfgA.pix || '').trim();
  const servicoDoc = (S.servicos||[]).find(x => x.id === a.servico_id);
  const cardLink = servicoDoc?.infinity_link;

  return `Salve ${nomePrim},

Agendamento confirmado por aqui.

Serviço: ${servico}
Quando: ${dataBr} às ${a.hora||''}
Modalidade: ${modalidade}
Valor: R$ ${valor.toFixed(2).replace('.',',')} ${pago?'(pago)':'(a confirmar)'}

${a.modalidade === 'presencial' ? `Endereço: R. Angelo Vicentim 236, Barão Geraldo, Campinas-SP\n` : `Online: o link da chamada chega por email ou WhatsApp uns minutos antes.\n`}
${!pago ? `${pixKey?`PIX: ${pixKey}\nManda o comprovante no WhatsApp pra gente confirmar.\n`:''}${cardLink?`\nCartão (crédito ou débito): ${cardLink}\nConfirma na hora, sem comprovante.\n`:''}` : ''}
Qualquer coisa antes do dia, chama: https://wa.me/5519992494267

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
  const hoje = new Date();
  // Próximo dia X — se hoje > dia X do mês atual, pula pro próximo mês
  let baseMes = hoje.getDate() > dia ? hoje.getMonth() + 1 : hoje.getMonth() + 1; // sempre próximo mês como 2ª parcela
  for (let i = 2; i <= total; i++) {
    const d = new Date(hoje.getFullYear(), baseMes + (i - 2), dia);
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
  const acaoLabel = isParcelado ? 'matrícula' : (isInscricao ? 'inscrição' : 'compra');
  const acaoTitulo = isParcelado ? 'Matrícula confirmada' : (isInscricao ? 'Inscrição confirmada' : 'Pedido confirmado');
  const turma = p.turma_id ? (produto?.turmas||[]).find(t => t.id === p.turma_id) : null;
  const valor = (Number(p.valor) || 0).toFixed(2).replace('.', ',');
  const proxParcelas = _proximasParcelas(p, produto);
  // PIX: override do produto (se preenchido) > central do terreiro (cfgAgendamento.pix)
  const pixKey = (produto?.pix && produto.pix.trim()) || (S.cfgAgendamento?.pix || '').trim();
  const mensagemInicial = isParcelado
    ? `A 1ª parcela chegou. Bom te ter com a gente nesse processo.`
    : (isInscricao ? `Sua vaga tá garantida. A gente te espera no dia.` : `Pagamento recebido. Obrigado por confiar na casa.`);

  const proxPassos = isParcelado
    ? `Sua turma começa em <strong>${turma?.detalhes || 'breve'}</strong>. As próximas parcelas saem por PIX (chave logo abaixo). Quando pagar, manda o comprovante no WhatsApp pra gente confirmar.`
    : (isInscricao ? `A gente te espera no dia: <strong>${turma?.detalhes || 'a combinar'}</strong>. Se for sua primeira vez na casa, chega uns 15 min antes pra você se localizar com calma.` : `Qualquer coisa, manda mensagem no WhatsApp.`);

  const fundoEscuro = '#1a1410';
  const fundoCard = '#fdf8ee';
  const dourado = '#d4a843';
  const douradoEscuro = '#b8922a';
  const tinta = '#1a1209';
  const tinta2 = '#3a2f24';
  const muted = '#7a6a55';
  const muted2 = '#a89880';
  const border = '#ebe0c8';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${acaoTitulo}</title>
</head>
<body style="margin:0;padding:0;background:${fundoEscuro};font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:${tinta2};-webkit-font-smoothing:antialiased">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${fundoEscuro};padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${fundoCard};border-radius:14px;overflow:hidden;box-shadow:0 12px 50px rgba(0,0,0,0.4)">

      <!-- Faixa dourada com logo -->
      <tr><td style="background:linear-gradient(135deg,${dourado},${douradoEscuro});padding:36px 32px 28px;text-align:center">
        <img src="https://terreirodocandieiro.com.br/logocandieiro.png" alt="Candieiro" width="64" height="64" style="display:block;margin:0 auto 14px;background:#fff;border-radius:50%;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,0.2)">
        <div style="color:${tinta};font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:800">Terreiro do Candieiro</div>
        <div style="color:rgba(26,18,9,0.7);font-size:10.5px;letter-spacing:.15em;margin-top:6px;font-style:italic">Umbanda Omoloko · Jurema Sagrada</div>
      </td></tr>

      <!-- Hero confirmação -->
      <tr><td style="padding:44px 32px 12px;text-align:center">
        <div style="font-size:56px;line-height:1;margin-bottom:14px">🕯️</div>
        <h1 style="color:${tinta};font-size:26px;font-weight:700;margin:0 0 10px;line-height:1.25;letter-spacing:-.01em">${acaoTitulo}, ${(p.nome||'').split(' ')[0]}</h1>
        <p style="color:${muted};font-size:15px;line-height:1.65;margin:0 auto;max-width:440px">${mensagemInicial}</p>
      </td></tr>

      <!-- Card do pedido -->
      <tr><td style="padding:36px 32px 8px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border:1px solid ${border};border-radius:12px">
          <tr><td style="padding:22px 24px;border-bottom:1px solid #f5ecd6">
            <div style="color:${muted2};font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:8px">O que você ${acaoLabel === 'compra' ? 'comprou' : 'reservou'}</div>
            <div style="color:${tinta};font-size:18px;font-weight:700;line-height:1.35">${p.produto_nome || 'Produto'}</div>
            ${turma ? `<div style="color:${muted};font-size:13.5px;margin-top:10px;line-height:1.55">
              <span style="color:${douradoEscuro};font-weight:700">🗓️ ${turma.nome}</span>${turma.detalhes ? `<br><span style="color:${muted2}">${turma.detalhes}</span>` : ''}
            </div>` : ''}
            ${produto?.local ? `<div style="color:${muted};font-size:13px;margin-top:8px;line-height:1.5">📍 ${produto.local}</div>` : ''}
          </td></tr>
          <tr><td style="padding:22px 24px">
            <div style="color:${muted2};font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">${isParcelado ? '1ª parcela paga' : 'Valor pago'}</div>
            <div style="color:${tinta};font-size:28px;font-weight:800;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">R$ ${valor}</div>
            ${isParcelado ? `<div style="color:${muted};font-size:12.5px;margin-top:8px;line-height:1.55">De ${p.parcelas_total} parcelas mensais · vencimento dia ${produto.parcelamento.vencimento_dia}</div>` : ''}
            ${p.desconto_afirmativo ? `<div style="display:inline-block;margin-top:10px;padding:5px 11px;background:#f3eaf7;color:#7d3a9e;font-size:11.5px;font-weight:700;border-radius:14px;letter-spacing:.02em">✊🏿 Desconto afirmativo aplicado</div>` : ''}
            ${p.promo_aplicada ? `<div style="display:inline-block;margin-top:10px;padding:5px 11px;background:#e3f5e8;color:#1e7e3c;font-size:11.5px;font-weight:700;border-radius:14px">🎉 ${p.promo_label || 'Promoção'} aplicada</div>` : ''}
          </td></tr>
        </table>
      </td></tr>

      ${proxParcelas.length > 0 ? `
      <!-- Próximas parcelas -->
      <tr><td style="padding:24px 32px 8px">
        <div style="color:${muted2};font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:12px">Próximas parcelas</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border:1px solid ${border};border-radius:12px">
          ${proxParcelas.map((par, i) => `
            <tr><td style="padding:14px 22px;${i < proxParcelas.length - 1 ? `border-bottom:1px solid #f5ecd6` : ''}">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align:middle">
                    <div style="color:${tinta};font-size:13.5px;font-weight:700">${par.n}ª parcela</div>
                    <div style="color:${muted};font-size:12px;margin-top:2px;text-transform:capitalize">${par.data}</div>
                  </td>
                  <td style="vertical-align:middle;text-align:right">
                    <div style="color:${douradoEscuro};font-size:15px;font-weight:700">R$ ${par.valor}</div>
                  </td>
                </tr>
              </table>
            </td></tr>
          `).join('')}
        </table>
        ${pixKey ? `<div style="background:#fff8e8;border-left:3px solid ${dourado};border-radius:6px;padding:14px 16px;margin-top:14px;color:${tinta2};font-size:13px;line-height:1.6">
          <strong style="color:${tinta}">PIX:</strong><br>
          <span style="font-family:'SF Mono','Monaco','Menlo','Consolas',monospace;font-size:13.5px;color:${douradoEscuro};word-break:break-all">${pixKey}</span>
        </div>` : ''}
      </td></tr>
      ` : ''}

      <!-- Próximos passos -->
      <tr><td style="padding:28px 32px 8px">
        <div style="color:${muted2};font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:12px">O que vem agora</div>
        <div style="background:#fff8e8;border-left:3px solid ${dourado};border-radius:8px;padding:18px 20px;color:${tinta2};font-size:14px;line-height:1.7">${proxPassos}</div>
      </td></tr>

      ${produto?.descricao && !isParcelado ? `
      <!-- Descrição do produto -->
      <tr><td style="padding:28px 32px 8px">
        <div style="color:${muted2};font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:12px">Sobre ${p.produto_nome}</div>
        <div style="color:${tinta2};font-size:13.5px;line-height:1.7;white-space:pre-wrap">${(produto.descricao || '').slice(0, 1000)}${(produto.descricao || '').length > 1000 ? '...' : ''}</div>
      </td></tr>
      ` : ''}

      <!-- CTA WhatsApp -->
      <tr><td style="padding:32px;text-align:center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
          <tr><td>
            <a href="https://wa.me/5519992494267" target="_blank" style="display:inline-block;background:#25d366;color:#fff;font-weight:700;font-size:14.5px;padding:14px 30px;border-radius:10px;text-decoration:none;letter-spacing:.02em;box-shadow:0 4px 14px rgba(37,211,102,0.3)">💬 Falar com a gente</a>
          </td></tr>
        </table>
        <div style="color:${muted2};font-size:12px;margin-top:16px">Qualquer coisa, é só chamar.</div>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f5ecd6;padding:28px 32px;text-align:center;border-top:1px solid ${border}">
        <div style="color:${tinta};font-size:13px;font-weight:700;letter-spacing:.02em;margin-bottom:8px">Terreiro do Candieiro</div>
        <div style="color:${muted};font-size:12px;line-height:1.7">
          R. Angelo Vicentim, 236 · Barão Geraldo · Campinas-SP<br>
          <a href="https://terreirodocandieiro.com.br" style="color:${douradoEscuro};text-decoration:none;font-weight:600">terreirodocandieiro.com.br</a>
          &nbsp;·&nbsp;
          <a href="https://instagram.com/terreirodocandieiro" style="color:${douradoEscuro};text-decoration:none;font-weight:600">@terreirodocandieiro</a>
        </div>
        <div style="color:${muted2};font-size:10.5px;margin-top:14px;font-style:italic">Pai Nando · Umbanda Omoloko + Jurema Sagrada em paralelo</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
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
