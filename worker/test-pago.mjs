/**
 * "Pagou" mora em dois lugares. Este teste é o que impede voltar a olhar um só.
 *
 *   node worker/test-pago.mjs
 *
 * Defeito real, 01/08/2026: filha com baixa manual no financeiro (dinheiro na
 * gira) viu "mensalidade atrasada" com acréscimo na área dela — e teria
 * recebido email de cobrança. O Worker só lia `fin_mensalidade_pedidos`, e a
 * baixa manual vive em `fin_pagamentos/{ciclo}`.
 *
 * Falha em silêncio dos dois lados: quem pagou é cobrado, e o sistema não
 * reclama de nada. Por isso a regra virou função pura, e a função tem teste.
 */

import { estaPago } from './worker.js';

let n = 0;
const eq = (a, b, msg) => {
  n++;
  if (a !== b) { console.error(`FALHOU: ${msg}\n  esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); process.exit(1); }
};

const ABERTO = { status: 'aberto', avisou_atraso: false };
const F = 'filha123';

// ── o caso que quebrou ────────────────────────────────────────────────────
eq(estaPago(ABERTO, { [F]: true }, F), 'manual',
   'pedido aberto + baixa manual no financeiro = PAGO');
eq(estaPago(null, { [F]: true }, F), 'manual',
   'nem o pedido do ciclo precisa existir pra baixa manual valer');

// ── pagamento pelo link ───────────────────────────────────────────────────
eq(estaPago({ ...ABERTO, pago_automatico: true }, {}, F), 'checkout', 'pago_automatico');
eq(estaPago({ status: 'pago' }, {}, F), 'checkout', 'status pago');
eq(estaPago({ ...ABERTO, pago_automatico: true }, { [F]: true }, F), 'checkout',
   'os dois marcados: checkout ganha, porque só ele tem recibo e valor congelado');

// ── não pago ──────────────────────────────────────────────────────────────
eq(estaPago(ABERTO, {}, F), null, 'aberto e sem baixa');
eq(estaPago(ABERTO, null, F), null, 'mapa ausente não derruba');
eq(estaPago(null, {}, F), null, 'sem pedido e sem baixa');
eq(estaPago(ABERTO, { outroFilho: true }, F), null, 'baixa de outra pessoa não conta');

// ── o mapa é booleano, e só `true` conta ──────────────────────────────────
// O financeiro grava false ao DESMARCAR, e o campo fica no doc. Se qualquer
// valor contasse, desmarcar não desmarcaria nada.
eq(estaPago(ABERTO, { [F]: false }, F), null, 'false = desmarcado, não pago');
eq(estaPago(ABERTO, { [F]: 'sim' }, F), null, 'string não é baixa');
eq(estaPago(ABERTO, { [F]: 1 }, F), null, '1 não é baixa');

// ── status que não é 'pago' não vira pago ─────────────────────────────────
eq(estaPago({ status: 'cancelado' }, {}, F), null, 'cancelado não é pago');
eq(estaPago({ status: 'aguardando_pagamento' }, {}, F), null, 'aguardando não é pago');
eq(estaPago({ pago_automatico: false }, {}, F), null, 'pago_automatico false');

console.log(`ok — ${n} asserts de "pagou" passaram`);
