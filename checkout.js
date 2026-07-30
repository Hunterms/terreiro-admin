/**
 * Checkout InfinitePay — lado do cliente.
 *
 * Só duas coisas moram aqui: pedir o link pro Worker, e desenhar o botão.
 * O cálculo do valor NÃO está aqui e não pode estar: quem calcula é o Worker,
 * lendo o preço do Firestore. Esta página só manda o id do pedido.
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

/**
 * Caixa azul de "pagar agora".
 *
 * Com o checkout ligado, é a única forma de pagar mostrada: a InfinitePay
 * também recebe PIX, então a chave copia e cola só duplicaria o caminho — e
 * duplicaria justo o caminho que precisa de confirmação na mão. A chave PIX
 * continua na página como fallback escondido, e só aparece se o Worker falhar.
 */
export function caixaCheckout(url, valor) {
  return `
    <div id="cx-box" style="padding:18px;background:linear-gradient(135deg,rgba(52,152,219,0.14),rgba(52,152,219,0.04));border:1px solid rgba(52,152,219,0.4);border-radius:12px;margin-bottom:14px;text-align:center">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💳 Cartão ou PIX</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:12px">Checkout da InfinitePay. Cai na hora e <strong style="color:var(--text)">não precisa mandar comprovante</strong>.</div>
      <a id="cx-pagar" href="${url}" style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;font-size:15px;background:#3498db;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">🔒 Pagar R$ ${Number(valor).toFixed(0)} agora</a>
      <div style="font-size:11.5px;color:var(--text3);margin-top:10px">Crédito em até 12x · débito · PIX</div>
    </div>
  `;
}

/**
 * Troca a caixa pra "aguardando confirmação" no clique do pagar.
 *
 * A página não tem como saber se pagou: ler o pedido exige auth, e os
 * parâmetros que a InfinitePay devolve na URL vêm do cliente, então não provam
 * nada. Quem sabe é o webhook. Então, em vez de mentir pros dois lados, a tela
 * para de perguntar "escolhe como pagar" e passa a dizer o que é verdade: se
 * concluiu, já está resolvido; se desistiu, o link continua ali.
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
    box.innerHTML = `
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">⏳ Aguardando confirmação</div>
      <div style="font-size:13.5px;color:var(--text);line-height:1.6;margin-bottom:14px">
        <strong>Se você concluiu o pagamento, está tudo certo.</strong><br>
        <span style="color:var(--text2)">Ele entra no sistema do terreiro sozinho, em segundos. Não precisa mandar comprovante nem avisar ninguém — pode fechar a página.</span>
      </div>
      <a href="${url}" style="display:inline-flex;align-items:center;gap:7px;padding:10px 18px;font-size:13px;background:rgba(255,255,255,0.06);border:1px solid rgba(52,152,219,0.4);color:#3498db;border-radius:8px;text-decoration:none;font-weight:600">↻ Não terminei — voltar pro pagamento</a>
    `;
  });
}

/** Espaço reservado enquanto o link não chega (evita a tela pular). */
export function caixaCheckoutCarregando() {
  return `
    <div id="cx-checkout-load" style="padding:18px;background:rgba(52,152,219,0.06);border:1px dashed rgba(52,152,219,0.3);border-radius:12px;margin-bottom:14px;text-align:center">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">💳 Cartão ou PIX</div>
      <div style="font-size:13px;color:var(--text3)">Preparando seu checkout...</div>
    </div>
  `;
}
