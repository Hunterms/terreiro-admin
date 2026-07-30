/**
 * Checkout InfinitePay — lado do cliente.
 *
 * Só duas coisas moram aqui: pedir o link pro Worker, e desenhar o resumo do
 * pedido. O cálculo do valor NÃO está aqui e não pode estar: quem calcula é o
 * Worker, lendo o preço do Firestore. Esta página só manda o id do pedido.
 *
 * Os valores que aparecem no resumo são só para LER. O que vai ser cobrado é o
 * que o Worker calculou — ele devolve em `valor` e é esse que a caixa mostra,
 * justamente pra tela e cobrança nunca discordarem.
 *
 * Config vem de adm_config/agendamento (que as páginas públicas já leem):
 *   checkout_ativo:       true
 *   checkout_worker_url:  https://terreiro-email.SEU-SUBDOMINIO.workers.dev
 *
 * Se estiver desligado, ou se o Worker falhar, retorna null e a página segue
 * mostrando o PIX manual. Pagamento nunca deve virar beco sem saída.
 */

export async function criarCheckout(cfg, tipo, docId) {
  const base = cfg?.checkout_worker_url;
  if (!cfg?.checkout_ativo || !base || !docId) return null;

  try {
    const resp = await fetch(base.replace(/\/+$/, '') + '/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, doc_id: docId }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.url) {
      console.warn('checkout indisponível:', resp.status, data?.error || '');
      return null;
    }
    return { url: data.url, valor: (Number(data.valor_centavos) || 0) / 100 };
  } catch (e) {
    console.warn('checkout falhou:', e?.message || e);
    return null;
  }
}

export const brl = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── ÍCONES ────────────────────────────────────────────────────────────────
// Inline porque a página não carrega asset externo (e não deve: bandeira de
// cartão vinda de CDN é rastreador de graça).

const ICO_CADEADO = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
const ICO_CARTAO = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
const ICO_PIX = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l4.5 4.5L12 11 7.5 6.5 12 2zm-6 6L1.5 12.5 6 17l4.5-4.5L6 8zm12 0l-4.5 4.5L18 17l4.5-4.5L18 8zm-6 6l-4.5 4.5L12 22l4.5-3.5L12 14z"/></svg>`;

/**
 * Resumo do pedido + botão de pagar. É a tela que faz o fluxo parecer compra,
 * e não recado: item, subtotal, desconto, total, e um CTA só.
 *
 * dados = {
 *   url,                    // link do checkout (obrigatório)
 *   valor,                  // total que o Worker vai cobrar (obrigatório)
 *   item,                   // nome do que está sendo comprado
 *   detalhe,                // linha fina embaixo do item (data, hora, turma…)
 *   valorCheio,             // preço sem desconto — só se for MAIOR que o total
 *   descontoLabel,          // "promo de julho", "desconto afirmativo"…
 *   parcelaDe,              // n de parcelas, quando é matrícula de curso
 *   parcelasCartao,         // até quantas vezes dá pra dividir (default 12)
 * }
 *
 * Com o checkout ligado, esta é a única forma de pagar mostrada: a InfinitePay
 * também recebe PIX, então a chave copia e cola só duplicaria o caminho — e
 * duplicaria justo o caminho que precisa de confirmação na mão. A chave PIX
 * continua na página como fallback escondido, e só aparece se o Worker falhar.
 */
export function caixaCheckout(dados) {
  const { url, valor, item, detalhe, descontoLabel, parcelaDe, parcelasCartao = 12 } = dados;
  const cheio = Number(dados.valorCheio) || 0;
  const temDesconto = cheio > Number(valor);
  const economia = temDesconto ? cheio - Number(valor) : 0;
  const parcela = Number(valor) / parcelasCartao;

  const linha = (rot, val, cor) => `
    <div style="display:flex;justify-content:space-between;gap:12px;font-size:13.5px;padding:5px 0">
      <span style="color:var(--text2)">${rot}</span>
      <span style="color:${cor || 'var(--text)'};white-space:nowrap;font-variant-numeric:tabular-nums">${val}</span>
    </div>`;

  return `
    <div id="cx-box" style="background:rgba(255,255,255,0.03);border:1px solid var(--border2);border-radius:14px;overflow:hidden;margin-bottom:14px;text-align:left">

      <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Resumo do pedido</span>
        <span style="font-size:11px;color:var(--text3);display:inline-flex;align-items:center;gap:5px">${ICO_CADEADO} seguro</span>
      </div>

      <div style="padding:16px 18px">
        ${item ? `
          <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:${detalhe ? '3px' : '12px'}">
            <span style="font-size:15px;font-weight:700;color:var(--text);line-height:1.35">${item}</span>
            <span style="font-size:14px;color:var(--text2);white-space:nowrap;font-variant-numeric:tabular-nums">${brl(cheio || valor)}</span>
          </div>
          ${detalhe ? `<div style="font-size:12.5px;color:var(--text3);line-height:1.45;margin-bottom:12px">${detalhe}</div>` : ''}
        ` : ''}

        ${temDesconto ? `
          <div style="border-top:1px solid var(--border);padding-top:8px">
            ${linha('Subtotal', brl(cheio))}
            ${linha(descontoLabel || 'Desconto', '− ' + brl(economia), 'var(--green)')}
          </div>
        ` : ''}

        <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:12px;display:flex;justify-content:space-between;align-items:baseline;gap:12px">
          <span style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;font-weight:700">Total</span>
          <span style="font-size:26px;font-weight:800;color:var(--gold);line-height:1;font-variant-numeric:tabular-nums">${brl(valor)}</span>
        </div>
        ${parcelaDe ? `
          <div style="font-size:12px;color:var(--text3);text-align:right;margin-top:6px">1ª de ${parcelaDe} parcelas · as próximas combinadas com o terreiro</div>
        ` : `
          <div style="font-size:12px;color:var(--text3);text-align:right;margin-top:6px">ou até ${parcelasCartao}x de ${brl(parcela)} no cartão</div>
        `}
      </div>

      <div style="padding:0 18px 18px">
        <a id="cx-pagar" href="${url}" style="display:flex;align-items:center;justify-content:center;gap:9px;padding:16px;font-size:16px;background:#3498db;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;letter-spacing:.01em">
          ${ICO_CADEADO} Ir para o pagamento
        </a>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:12px;font-size:11.5px;color:var(--text3);flex-wrap:wrap">
          <span style="display:inline-flex;align-items:center;gap:5px">${ICO_CARTAO} crédito e débito</span>
          <span style="display:inline-flex;align-items:center;gap:5px">${ICO_PIX} PIX</span>
        </div>
        <div style="font-size:11.5px;color:var(--text3);text-align:center;margin-top:10px;line-height:1.5">
          Processado pela <strong style="color:var(--text2)">InfinitePay</strong>. Seus dados de pagamento não passam pelo terreiro.
        </div>
      </div>

    </div>
  `;
}

/** Espaço reservado enquanto o link não chega (evita a tela pular). */
export function caixaCheckoutCarregando() {
  return `
    <div id="cx-checkout-load" style="background:rgba(255,255,255,0.02);border:1px dashed var(--border2);border-radius:14px;padding:26px 18px;margin-bottom:14px;text-align:center">
      <div style="width:22px;height:22px;border:2px solid var(--border2);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px"></div>
      <div style="font-size:13px;color:var(--text3)">Preparando seu pagamento...</div>
    </div>
  `;
}

/**
 * Troca a caixa pra "aguardando confirmação" no clique do pagar.
 *
 * A página não tem como saber se pagou: ler o pedido exige auth. Quem sabe é o
 * Worker. Então, em vez de mentir pros dois lados, a tela para de pedir
 * pagamento e passa a dizer o que é verdade: se concluiu, já está resolvido; se
 * desistiu, o link continua ali.
 *
 * Vale quando a pessoa volta pelo botão do navegador (o estado do DOM é
 * restaurado) — que foi exatamente o caminho que apareceu confuso no teste.
 */
export function armarCheckout(url) {
  const a = document.getElementById('cx-pagar');
  if (!a) return;
  a.addEventListener('click', () => {
    const box = document.getElementById('cx-box');
    if (!box) return;
    box.style.borderColor = 'var(--border2)';
    box.innerHTML = `
      <div style="padding:24px 20px;text-align:center">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:12px">⏳ Aguardando confirmação</div>
        <div style="font-size:14.5px;color:var(--text);line-height:1.6;margin-bottom:16px">
          <strong>Se você concluiu o pagamento, está tudo certo.</strong><br>
          <span style="color:var(--text2);font-size:13.5px">Ele entra no sistema do terreiro sozinho, em segundos. Não precisa mandar comprovante nem avisar ninguém — pode fechar a página.</span>
        </div>
        <a href="${url}" style="display:inline-flex;align-items:center;gap:7px;padding:11px 20px;font-size:13.5px;background:rgba(255,255,255,0.06);border:1px solid rgba(52,152,219,0.45);color:#3498db;border-radius:9px;text-decoration:none;font-weight:600">↻ Não terminei — voltar pro pagamento</a>
      </div>
    `;
  });
}
