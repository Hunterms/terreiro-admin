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

/** Caixa azul de "pagar agora". `pos` é o número da opção mostrada ao cliente. */
export function caixaCheckout(url, valor, pos = 1) {
  return `
    <div style="padding:18px;background:linear-gradient(135deg,rgba(52,152,219,0.14),rgba(52,152,219,0.04));border:1px solid rgba(52,152,219,0.4);border-radius:12px;margin-bottom:14px;text-align:center">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💳 Opção ${pos} · Cartão ou PIX automático</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:12px">Checkout da InfinitePay. Cai na hora e <strong style="color:var(--text)">não precisa mandar comprovante</strong>.</div>
      <a href="${url}" style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;font-size:15px;background:#3498db;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">🔒 Pagar R$ ${Number(valor).toFixed(0)} agora</a>
      <div style="font-size:11.5px;color:var(--text3);margin-top:10px">Crédito em até 12x · débito · PIX</div>
    </div>
  `;
}

/** Espaço reservado enquanto o link não chega (evita a tela pular). */
export function caixaCheckoutCarregando(pos = 1) {
  return `
    <div id="cx-checkout-load" style="padding:18px;background:rgba(52,152,219,0.06);border:1px dashed rgba(52,152,219,0.3);border-radius:12px;margin-bottom:14px;text-align:center">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">💳 Opção ${pos} · Cartão ou PIX automático</div>
      <div style="font-size:13px;color:var(--text3)">Preparando seu checkout...</div>
    </div>
  `;
}
