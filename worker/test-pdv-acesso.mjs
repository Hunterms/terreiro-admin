// Self-check do /pdv-aprovar: é a porta que transforma uma conta qualquer em
// conta da loja. Erro aqui deixa qualquer um aprovar a si mesmo.
//
//   node worker/test-pdv-acesso.mjs

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { rotaPdvAprovar } from './worker.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { GCP_SA_EMAIL: 'teste@x.iam', GCP_SA_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

// Google de mentira: quem é o dono do token, o pedido no Firestore, e o que foi pedido pra conta.
let quem, pedido, chamadas;
globalThis.fetch = async (url, op = {}) => {
  const u = String(url), corpo = op.body && String(op.body).startsWith('{') ? JSON.parse(op.body) : null;
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 't', expires_in: 3600 });
  if (u.includes('accounts:lookup?key=')) return ok(quem ? { users: [quem] } : {});
  if (u.includes('documents/pdv_cadastros/') && op.method === 'PATCH') { chamadas.push(['patch', corpo]); return ok({}); }
  if (u.includes('documents/pdv_cadastros/')) return pedido ? ok({ fields: { status: { stringValue: pedido } } }) : new Response('', { status: 404 });
  if (u.endsWith('accounts:update') || u.endsWith('accounts:delete')) { chamadas.push([u.split(':').pop(), corpo]); return ok({}); }
  throw new Error('fetch inesperado ' + u);
};
const roda = async (body) => { chamadas = []; const r = await rotaPdvAprovar(body, env); return { status: r.status, d: await r.json() }; };

// sem token não passa
assert.equal((await roda({ uid: 'u1', aprovar: true })).status, 400);

// token que o Google não reconhece
quem = null; pedido = 'pendente';
assert.equal((await roda({ idToken: 'x', uid: 'u1', aprovar: true })).status, 401);

// conta da loja tentando aprovar (inclusive a si mesma): barrada, nada muda
quem = { email: 'caixa@x.com', customAttributes: '{"loja":true}' };
let r = await roda({ idToken: 'x', uid: 'u1', aprovar: true });
assert.equal(r.status, 403);
assert.equal(chamadas.length, 0);

// admin por claim aprova: habilita e dá SÓ loja
quem = { email: 'alguem@x.com', customAttributes: '{"admin":true}' };
r = await roda({ idToken: 'x', uid: 'u1', aprovar: true });
assert.equal(r.status, 200);
assert.deepEqual(chamadas[0], ['update', { localId: 'u1', disableUser: false, customAttributes: '{"loja":true}' }]);
assert.equal(chamadas[1][0], 'patch');

// admin pela rede de email recusa: a conta é apagada
quem = { email: 'Nandomacedo42@gmail.com' };
r = await roda({ idToken: 'x', uid: 'u1', aprovar: false });
assert.equal(r.status, 200);
assert.deepEqual(chamadas[0], ['delete', { localId: 'u1' }]);

// pedido já julgado não é julgado de novo
pedido = 'aprovado';
assert.equal((await roda({ idToken: 'x', uid: 'u1', aprovar: true })).status, 409);
pedido = null;
assert.equal((await roda({ idToken: 'x', uid: 'u1', aprovar: true })).status, 409);

console.log('pdv-acesso ok');
