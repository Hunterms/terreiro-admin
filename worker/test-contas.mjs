/**
 * Regra de calendário das contas fixas e do "amanhã".
 *
 *   node worker/test-contas.mjs
 *
 * Por que tem teste: mês com 28, 30 e 31 dias é onde a conta do dia 31 some sem
 * ninguém notar, e virada de mês é onde "amanhã" erra por um dia. As duas
 * falham em silêncio — o aviso simplesmente não sai, e ninguém sabe que faltou.
 */

import { contaVenceEm, maisDias } from './worker.js';

let n = 0;
const eq = (a, b, msg) => {
  n++;
  if (a !== b) { console.error(`FALHOU: ${msg}\n  esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); process.exit(1); }
};

// ── dia normal ────────────────────────────────────────────────────────────
eq(contaVenceEm({ dia_venc: 10 }, '2026-08-10'), true,  'dia 10 vence no dia 10');
eq(contaVenceEm({ dia_venc: 10 }, '2026-08-09'), false, 'dia 10 não vence no dia 9');
eq(contaVenceEm({ dia_venc: 10 }, '2026-08-11'), false, 'dia 10 não vence no dia 11');
eq(contaVenceEm({ dia_venc: '5' }, '2026-08-05'), true, 'aceita string do input');

// ── sem o campo: não avisa ────────────────────────────────────────────────
eq(contaVenceEm({}, '2026-08-10'), false,               'sem dia_venc não vence nunca');
eq(contaVenceEm({ dia_venc: 0 }, '2026-08-10'), false,  'dia 0 não vence');
eq(contaVenceEm({ dia_venc: null }, '2026-08-10'), false, 'null não vence');
eq(contaVenceEm(null, '2026-08-10'), false,             'gasto nulo não derruba');

// ── o dia que não existe no mês cai no último ─────────────────────────────
eq(contaVenceEm({ dia_venc: 31 }, '2026-08-31'), true,  'dia 31 em agosto (31 dias)');
eq(contaVenceEm({ dia_venc: 31 }, '2026-09-30'), true,  'dia 31 em setembro cai no dia 30');
eq(contaVenceEm({ dia_venc: 31 }, '2026-09-29'), false, 'e não no penúltimo');
eq(contaVenceEm({ dia_venc: 30 }, '2026-02-28'), true,  'dia 30 em fevereiro comum cai no 28');
eq(contaVenceEm({ dia_venc: 30 }, '2028-02-29'), true,  'em ano bissexto cai no 29');
eq(contaVenceEm({ dia_venc: 30 }, '2028-02-28'), false, 'e não no 28 do ano bissexto');
eq(contaVenceEm({ dia_venc: 28 }, '2026-02-28'), true,  'dia 28 em fevereiro é dia normal');

// ── maisDias: virada de mês, de ano, e bissexto ───────────────────────────
eq(maisDias('2026-08-01', 1), '2026-08-02', 'amanhã comum');
eq(maisDias('2026-08-31', 1), '2026-09-01', 'vira o mês');
eq(maisDias('2026-12-31', 1), '2027-01-01', 'vira o ano');
eq(maisDias('2028-02-28', 1), '2028-02-29', '29 de fevereiro existe em 2028');
eq(maisDias('2026-02-28', 1), '2026-03-01', 'e não existe em 2026');
eq(maisDias('2026-08-01', -1), '2026-07-31', 'ontem também');

console.log(`ok — ${n} asserts de contas e calendário passaram`);
