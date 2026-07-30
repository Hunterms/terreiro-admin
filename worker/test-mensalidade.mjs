// Self-check da mensalidade. A regra vive em dois lugares — Worker pra cobrar,
// tela pra mostrar — e se discordarem o filho vê um preço e paga outro.
//
//   node worker/test-mensalidade.mjs

import assert from 'node:assert/strict';
import { mensalidadeReais, vencimentoMensalidade, ultimoDiaDoCiclo, precoCentavos, MULTA_ATRASO } from './worker.js';

// ── vencimento por prazo ───────────────────────────────────────────────────
assert.equal(vencimentoMensalidade('10', '2026-07'), '2026-07-10');
assert.equal(vencimentoMensalidade('15', '2026-07'), '2026-07-15');
assert.equal(vencimentoMensalidade('20', '2026-07'), '2026-07-20');

// prazo vazio conta como dia 10 — mesmo default do getPrazoNum do financeiro
assert.equal(vencimentoMensalidade(undefined, '2026-07'), '2026-07-10');
assert.equal(vencimentoMensalidade('', '2026-07'), '2026-07-10');

// 'combinado' não tem data, então não tem multa automática
assert.equal(vencimentoMensalidade('combinado', '2026-07'), null);

// 'ultimo' usa o último dia REAL do mês. O financeiro usa 31 como atalho, o que
// em mês de 30 dias faria o vencimento nunca chegar.
assert.equal(ultimoDiaDoCiclo('2026-07'), 31);
assert.equal(ultimoDiaDoCiclo('2026-04'), 30);
assert.equal(ultimoDiaDoCiclo('2026-02'), 28);
assert.equal(ultimoDiaDoCiclo('2024-02'), 29); // bissexto
assert.equal(vencimentoMensalidade('ultimo', '2026-04'), '2026-04-30');
assert.equal(vencimentoMensalidade('ultimo', '2026-02'), '2026-02-28');

// ── valor: base, atraso e a flag de avisado ────────────────────────────────
const jul = { ciclo: '2026-07' };
const f200 = { valor: 200, prazo: '10' };

// em dia, e no próprio dia do vencimento ainda é em dia
assert.equal(mensalidadeReais(jul, f200, '2026-07-05'), 200);
assert.equal(mensalidadeReais(jul, f200, '2026-07-10'), 200);

// um dia depois, cai a multa
assert.equal(mensalidadeReais(jul, f200, '2026-07-11'), 210);

// avisou do atraso → sem multa, mesmo atrasado
assert.equal(mensalidadeReais({ ...jul, avisou_atraso: true }, f200, '2026-07-25'), 200);

// prazo maior atrasa a multa: dia 12 é em dia pra quem tem prazo 15
assert.equal(mensalidadeReais(jul, { valor: 200, prazo: '15' }, '2026-07-12'), 200);
assert.equal(mensalidadeReais(jul, { valor: 200, prazo: '15' }, '2026-07-16'), 210);

// valor diferente por filho — 4 filhos pagam 150
assert.equal(mensalidadeReais(jul, { valor: 150, prazo: '10' }, '2026-07-05'), 150);
assert.equal(mensalidadeReais(jul, { valor: 150, prazo: '10' }, '2026-07-20'), 160);

// isento não paga, e atraso não inventa dívida pra quem é isento
assert.equal(mensalidadeReais(jul, { valor: 0, prazo: '10' }, '2026-07-25'), 0);
assert.equal(mensalidadeReais(jul, { prazo: '10' }, '2026-07-25'), 0); // sem campo valor

// 'combinado' nunca leva multa automática
assert.equal(mensalidadeReais(jul, { valor: 200, prazo: 'combinado' }, '2026-12-31'), 200);

// 'ultimo' em mês de 30 dias: dia 30 em dia, dia 1 do mês seguinte atrasado
assert.equal(mensalidadeReais({ ciclo: '2026-04' }, { valor: 200, prazo: 'ultimo' }, '2026-04-30'), 200);
assert.equal(mensalidadeReais({ ciclo: '2026-04' }, { valor: 200, prazo: 'ultimo' }, '2026-05-01'), 210);

// ── integração com o preço em centavos ─────────────────────────────────────
assert.equal(precoCentavos('men', jul, f200, '2026-07-05'), 20000);
assert.equal(precoCentavos('men', jul, f200, '2026-07-11'), 21000);
assert.equal(precoCentavos('men', jul, { valor: 149.9, prazo: '10' }, '2026-07-05'), 14990);
assert.equal(precoCentavos('men', jul, { valor: 0 }, '2026-07-05'), 0);

// o valor gravado no pedido é ignorado: quem manda é fin_filhos
assert.equal(precoCentavos('men', { ...jul, valor_cobrado: 1 }, f200, '2026-07-05'), 20000);

assert.equal(MULTA_ATRASO, 10);

console.log('ok — 30 asserts de mensalidade passaram');
