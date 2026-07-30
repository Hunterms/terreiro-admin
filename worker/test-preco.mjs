// Self-check do cálculo de preço do checkout. É o caminho do dinheiro:
// se isso quebrar, alguém paga o valor errado.
//
//   node worker/test-preco.mjs
//
// Sem framework de propósito. Falha = exit code 1.

import assert from 'node:assert/strict';
import { precoCentavos } from './worker.js';

const HOJE = '2026-07-30';

// serviço de consulta: preço é o do adm_servicos, direto
assert.equal(precoCentavos('sol', {}, { valor: 150 }, HOJE), 15000);

// evento: preço é o do doc do evento
assert.equal(precoCentavos('ins', {}, { valor: 40 }, HOJE), 4000);

// produto sem promo nem desconto
assert.equal(precoCentavos('ped', {}, { valor: 200 }, HOJE), 20000);

// promo ativa e dentro do prazo → vale a promo
assert.equal(
  precoCentavos('ped', {}, { valor: 200, promo_ativa: true, promo_valor: 150, promo_ate: '2026-08-10' }, HOJE),
  15000
);

// promo vencida ontem → volta pro cheio
assert.equal(
  precoCentavos('ped', {}, { valor: 200, promo_ativa: true, promo_valor: 150, promo_ate: '2026-07-29' }, HOJE),
  20000
);

// último dia da promo ainda conta (<=, igual ao vendas.html)
assert.equal(
  precoCentavos('ped', {}, { valor: 200, promo_ativa: true, promo_valor: 150, promo_ate: HOJE }, HOJE),
  15000
);

// promo desligada, mesmo com valor e prazo preenchidos → cheio
assert.equal(
  precoCentavos('ped', {}, { valor: 200, promo_ativa: false, promo_valor: 150, promo_ate: '2026-08-10' }, HOJE),
  20000
);

// desconto afirmativo ganha da promo (autodeclaração tem prioridade)
assert.equal(
  precoCentavos(
    'ped',
    { desconto_afirmativo: true },
    { valor: 200, promo_ativa: true, promo_valor: 150, promo_ate: '2026-08-10', desconto_afirmativo: { ativo: true, valor: 100 } },
    HOJE
  ),
  10000
);

// pediu afirmativo mas o produto não oferece → cai na promo
assert.equal(
  precoCentavos(
    'ped',
    { desconto_afirmativo: true },
    { valor: 200, promo_ativa: true, promo_valor: 150, promo_ate: '2026-08-10', desconto_afirmativo: { ativo: false, valor: 100 } },
    HOJE
  ),
  15000
);

// afirmativo de valor 0 (isento) é valor válido, não "vazio"
assert.equal(
  precoCentavos('ped', { desconto_afirmativo: true }, { valor: 200, desconto_afirmativo: { ativo: true, valor: 0 } }, HOJE),
  0
);

// centavos: 149.90 não pode virar 14989.999...
assert.equal(precoCentavos('sol', {}, { valor: 149.9 }, HOJE), 14990);

// item sem valor → 0 (o Worker recusa criar checkout nesse caso)
assert.equal(precoCentavos('sol', {}, {}, HOJE), 0);

// o valor que o cliente mandar no pedido é ignorado: só a fonte manda
assert.equal(precoCentavos('ped', { valor: 1, checkout_centavos: 100 }, { valor: 200 }, HOJE), 20000);

console.log('ok — 13 asserts de preço passaram');
