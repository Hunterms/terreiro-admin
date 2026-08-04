/**
 * As duas contas de adesão, conferidas no fonte de verdade.
 *
 *   node worker/test-adesao.mjs
 *
 * Estas contas moram no `index.html` (são de tela, não de servidor), e um teste
 * que copiasse a lógica pra cá não testaria nada — confirmaria a cópia. Então
 * este arquivo EXTRAI as funções do próprio HTML pelo nome e roda elas contra um
 * `S` de mentira. Se alguém renomear ou mexer, o teste fala.
 *
 * O que está sob teste é o que olho nenhum confere contra o Firestore:
 *   · gente se conta por filho_id distinto, não por aparelho
 *   · token de iPhone conta como instalado (no iOS, push exige tela de início)
 *   · o público do aviso é a lista congelada do grupo, quando houver
 *   · a marca d'água é ISO e o `publicadoEm` é Timestamp — comparar os dois
 *     crus daria sempre falso, e o número nasceria zero pra sempre
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Recorta `function nome(...) { ... }` do HTML, contando chaves. */
function extrair(nome) {
  const abre = html.indexOf(`function ${nome}(`);
  assert.notEqual(abre, -1, `não achei function ${nome}( no index.html`);
  let i = html.indexOf('{', abre), nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}' && --nivel === 0) return html.slice(abre, j + 1);
  }
  throw new Error(`chaves não fecham em ${nome}`);
}

const S = { filhos: [], pushTokens: [], avisosLidos: [] };
const { adesaoApp, quemViuOAviso, nomeDeChip } = new Function('S',
  ['adesaoApp', 'quemViuOAviso', 'nomeDeChip'].map(extrair).join('\n') +
  '\nreturn { adesaoApp, quemViuOAviso, nomeDeChip };')(S);

// ── ADESÃO AO APP ──────────────────────────────────────────────────────────
S.filhos = [
  { id: 'a', nome: 'Ana Maria' },                                  // 2 aparelhos
  { id: 'b', nome: 'Bruno Silva', pwa_em: '2026-08-03', pwa_visto_em: '2026-08-03' },
  { id: 'c', nome: 'Carla Souza' },                                // iPhone, sem pwa_em
  { id: 'd', nome: 'Davi Rocha' },                                 // nada
  { id: 'e', nome: 'Elza Dias', status: 'afastado', pwa_em: '2026-08-03' },
];
S.pushTokens = [
  { papel: 'filho', filho_id: 'a', ua: 'Mozilla/5.0 (Linux; Android 14)' },
  { papel: 'filho', filho_id: 'a', ua: 'Mozilla/5.0 (Linux; Android 13)' },
  { papel: 'filho', filho_id: 'c', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)' },
  { papel: 'admin', filho_id: null, ua: 'Mozilla/5.0 (Macintosh)' },  // não é filho
  { papel: 'filho', filho_id: null, ua: 'Mozilla/5.0 (iPhone)' },     // sem dono
];

const a = adesaoApp();
assert.equal(a.total, 4, 'afastado fica fora do denominador');
assert.equal(a.comAvisos, 2, 'Ana (2 aparelhos) e Carla — gente, não aparelho');
assert.equal(a.aparelhos, 3, 'aparelhos dos ativos, com o token órfão fora');
assert.equal(a.instalados, 2, 'Bruno pela marca, Carla pelo iPhone');
assert.equal(a.linhas.find(l => l.f.id === 'a').instalado, false,
  'Android com push NÃO prova instalação — lá o push funciona no navegador');
assert.equal(a.linhas.find(l => l.f.id === 'c').medido, false,
  'Carla entra por inferência, e a tela precisa saber disso');
assert.equal(a.semProva, 1,
  'Ana tem notificação e nenhuma prova de instalação — é ela que explica a ' +
  'diferença entre os dois primeiros números do cartão');

// ── O NOME NO CHIP ─────────────────────────────────────────────────────────
const casa = ['Ana Maria Souza', 'Ana Paula Lima', 'Bruno Silva', 'Cida'];
assert.equal(nomeDeChip('Bruno Silva', casa), 'Bruno S.');
assert.equal(nomeDeChip('Ana Maria Souza', casa), 'Ana Maria',
  'primeiro nome repetido na casa pede o sobrenome inteiro, senão não é nome');
assert.equal(nomeDeChip('Ana Paula Lima', casa), 'Ana Paula');
assert.equal(nomeDeChip('Cida', casa), 'Cida', 'nome de uma palavra passa inteiro');
assert.equal(nomeDeChip('', casa), '', 'cadastro sem nome não derruba a tela');

// ── QUEM VIU O AVISO ───────────────────────────────────────────────────────
const ts = (iso) => ({ toDate: () => new Date(iso) });
S.avisosLidos = [
  { id: 'a', ate: '2026-08-02T10:00:00.000Z' },   // abriu ANTES: não viu
  { id: 'b', ate: '2026-08-04T09:00:00.000Z' },   // abriu depois: viu
  { id: 'c', ate: '2026-08-03T12:00:00.001Z' },   // um milésimo depois: viu
  // Davi nunca abriu: sem doc.
];
const aviso = { publicadoEm: ts('2026-08-03T12:00:00.000Z') };

const r = quemViuOAviso(aviso);
assert.equal(r.publico.length, 4, 'sem grupo, o público é a casa ativa');
assert.deepEqual(r.viram.map(f => f.id), ['b', 'c']);
assert.deepEqual(r.faltam.map(f => f.id), ['a', 'd'], 'quem nunca abriu conta como não viu');

const doGrupo = quemViuOAviso({ ...aviso, filho_ids: ['b', 'e'], grupo_nome: 'Médiuns' });
assert.deepEqual(doGrupo.publico.map(f => f.id), ['b', 'e'],
  'a lista congelada manda, e ela pode incluir quem está afastado');
assert.deepEqual(doGrupo.viram.map(f => f.id), ['b']);

assert.equal(quemViuOAviso({ publicadoEm: null }).medivel, false,
  'aviso sem data de publicação não é mensurável, e a tela não desenha número');

console.log('✓ adesão ao app e leitura dos avisos');
