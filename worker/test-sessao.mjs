// Self-check da identidade: PIN, pimenta e sessão assinada.
//
// Isto tem teste porque é o único lugar do sistema onde um bug deixa alguém
// entrar como outra pessoa. O resto do Worker erra dinheiro ou data; aqui erra
// quem você é.
//
//   node worker/test-sessao.mjs

import assert from 'node:assert/strict';
import { pinHash, igual, assinarSessao, lerSessao } from './worker.js';

const env = { ADMIN_SECRET: 'segredo-de-teste-nao-e-o-de-producao' };
const outro = { ADMIN_SECRET: 'outra-pimenta-qualquer' };

// ── comparação em tempo constante ──────────────────────────────────────────
assert.equal(igual('abc', 'abc'), true);
assert.equal(igual('abc', 'abd'), false);
assert.equal(igual('abc', 'ab'), false);       // tamanho diferente
assert.equal(igual('abc', null), false);
assert.equal(igual(undefined, undefined), false); // não-string nunca é igual

// ── o hash do PIN ──────────────────────────────────────────────────────────
const h = await pinHash(env, 'filho1', '4731');
assert.equal(typeof h, 'string');
assert.ok(h.length > 20);

// mesmo PIN, mesmo filho, mesma pimenta → mesmo hash
assert.equal(await pinHash(env, 'filho1', '4731'), h);

// PIN diferente → hash diferente
assert.notEqual(await pinHash(env, 'filho1', '4732'), h);

// MESMO PIN, filho diferente → hash diferente. Sem isto, duas pessoas com o
// mesmo PIN teriam o mesmo hash no banco, e quem lesse veria quem repetiu.
assert.notEqual(await pinHash(env, 'filho2', '4731'), h);

// A pimenta é o que segura tudo: sem o ADMIN_SECRET, o banco não dá palpite.
// Trocar o segredo invalida os PINs — está documentado no worker.js, e este
// assert é o que impede alguém "consertar" isso sem perceber a consequência.
assert.notEqual(await pinHash(outro, 'filho1', '4731'), h);

// ── sessão ─────────────────────────────────────────────────────────────────
const t = await assinarSessao(env, 'filho1');
assert.equal(await lerSessao(env, t), 'filho1');

// assinada com outra pimenta não vale
assert.equal(await lerSessao(outro, t), null);

// token mexido não vale — troca um caractere do corpo e a assinatura cai
const [corpo, sig] = t.split('.');
const mexido = `${corpo.slice(0, -1)}${corpo.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`;
assert.equal(await lerSessao(env, mexido), null);

// assinatura trocada por outra válida, de OUTRO filho: não pode colar o corpo
// de um com a assinatura de outro
const t2 = await assinarSessao(env, 'filho2');
assert.equal(await lerSessao(env, `${corpo}.${t2.split('.')[1]}`), null);

// lixo não derruba, devolve null
for (const ruim of [null, undefined, '', 'a', 'a.b', 'sem-ponto', '....', 123]) {
  assert.equal(await lerSessao(env, ruim), null, `token ruim aceito: ${ruim}`);
}

// expirada não vale. Monta uma à mão com validade no passado.
const b64url = (s) => Buffer.from(s).toString('base64url');
const corpoVelho = b64url(JSON.stringify({ f: 'filho1', e: Math.floor(Date.now() / 1000) - 10 }));
const sigVelha = await pinHash(env, 'sessao', corpoVelho);
assert.equal(await lerSessao(env, `${corpoVelho}.${sigVelha}`), null);

// e uma que ainda vale, montada do mesmo jeito, PASSA — senão o teste acima
// estaria certo por acidente (ex: se lerSessao rejeitasse tudo)
const corpoNovo = b64url(JSON.stringify({ f: 'filho1', e: Math.floor(Date.now() / 1000) + 60 }));
const sigNova = await pinHash(env, 'sessao', corpoNovo);
assert.equal(await lerSessao(env, `${corpoNovo}.${sigNova}`), 'filho1');

console.log('ok — 24 asserts de identidade passaram');
