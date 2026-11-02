import assert from 'node:assert/strict';
import { resumoDeVisitas, visitaDescartada } from './worker.js';

const SITE = 'https://terreirodocandieiro.com.br', IG = 'Mozilla/5.0 (iPhone) Instagram 300';
assert.equal(visitaDescartada({ tipo: 'home' }, SITE, IG, 'Claro NXT'), false, 'gente no site conta');
assert.equal(visitaDescartada({ tipo: 'home' }, SITE, IG, 'Cloudflare London, LLC'), false, 'iCloud Private Relay é gente');
assert.equal(visitaDescartada({ tipo: 'home' }, SITE, 'Googlebot/2.1', 'Claro'), true, 'robô fora');
assert.equal(visitaDescartada({ tipo: 'home' }, SITE, IG, 'DigitalOcean, LLC'), true, 'datacenter fora');
assert.equal(visitaDescartada({ tipo: 'home' }, 'https://outro.site', IG, 'Claro'), true, 'origem estranha fora');
assert.equal(visitaDescartada({ tipo: 'admin' }, SITE, IG, 'Claro'), true, 'tipo fora da lista');

const L = (sessao, tipo, extra = {}) => ({ sessao, tipo, dia: '2026-11-01', hora: 12, fonte: 'Instagram', aparelho: 'iPhone', cidade: 'Campinas', ...extra });
const linhas = [
  L('a', 'home'), L('a', 'agendar'), L('a', 'horario', { servico: 'Búzios' }), L('a', 'enviou'),
  L('b', 'home', { fonte: 'direto', hora: 20 }),
  L('c', 'agendar'), L('c', 'horario', { servico: 'Búzios' }),
];
const sols = [
  { origem: 'agendar_publico', servico_nome: 'Búzios', criadoEm: '2026-11-01T15:00:00Z' },
  { origem: 'admin', servico_nome: 'Búzios', criadoEm: '2026-11-01T15:00:00Z' },
  { origem: 'agendar_publico', servico_nome: 'Búzios', criadoEm: '2026-10-20T15:00:00Z' },
];
const r = resumoDeVisitas(linhas, sols, '2026-11-01');
assert.equal(r.pessoas, 3);
assert.equal(r.uma_pagina, 2, 'b viu só a home, c só o agendar');
assert.deepEqual([r.agendar, r.horario, r.enviou], [2, 2, 1]);
assert.equal(r.pedidos, 1, 'só pedido público e do período');
assert.deepEqual(r.procurados, [{ nome: 'Búzios', n: 2 }]);
assert.deepEqual(r.pico, { nome: '12', n: 2 });
assert.equal(resumoDeVisitas([], [], '2026-11-01').pessoas, 0);
console.log('✓ visitas');

// Rota inteira com fetch falso: confere o que vai pro Firestore.
import { rotaVisita } from './worker.js';
import { generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { GCP_SA_EMAIL: 'x@y', GCP_SA_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const gravados = [];
globalThis.fetch = async (url, op) => {
  if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  gravados.push(JSON.parse(op.body).fields);
  return new Response('{"name":"x/1"}');
};
const req = (ua, origin = SITE) => ({ headers: new Headers({ 'user-agent': ua, origin, 'cf-connecting-ip': '1.2.3.4' }), cf: { city: 'Campinas', asOrganization: 'Claro' } });
await rotaVisita({ tipo: 'horario', servico: 'Búzios' }, req(IG), env);
await rotaVisita({ tipo: 'home' }, req('Googlebot'), env);
assert.equal(gravados.length, 1, 'robô não grava');
const g = gravados[0];
assert.equal(g.tipo.stringValue, 'horario');
assert.equal(g.servico.stringValue, 'Búzios');
assert.equal(g.fonte.stringValue, 'Instagram');
assert.equal(g.cidade.stringValue, 'Campinas');
assert.match(g.criado.stringValue, /^\d{4}-\d\d-\d\dT/, 'data gravada como texto ISO');
assert.match(g.sessao.stringValue, /^[0-9a-f]{16}$/);
assert.ok(!JSON.stringify(g).includes('1.2.3.4'), 'IP não vai pro banco');
console.log('✓ rota');
