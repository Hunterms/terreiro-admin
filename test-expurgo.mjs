// Confere a contagem de rastro LENDO O index.html — não uma cópia dela.
// Roda: node test-expurgo.mjs
//
// Por que existe: este número aparece logo antes de um botão que apaga. Se
// `rastrosDe` contar de menos, a tela promete "3 registros" e some com 9 —
// e o dossiê que baixa junto sai incompleto, que é o pior dos dois, porque
// é o que sobra depois. Se contar de mais, alguém adia um expurgo legítimo.
//
// As três formas de guardar `filho_id` são diferentes e cada uma já errou em
// algum sistema: campo direto, lista de objetos (`alocacoes[].filho_id`) e
// lista de strings (`responsaveis[]`). É isso que está sob teste.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const bloco = html.split('// ── RETENÇÃO E EXPURGO ─')[1]?.split('async function apagarPessoa')[0];
assert.ok(bloco, 'bloco RETENÇÃO não encontrado no index.html');

const montar = new Function('S', bloco.slice(bloco.indexOf('\n')) +
  '\nreturn { RASTROS, rastrosDe, totalRastros, mesesAfastado, RETENCAO_PADRAO_MESES };');

const S = {
  disponibilidade: [{ id:'d1', filho_id:'alvo' }, { id:'d2', filho_id:'outro' }],
  regas:           [{ id:'2026-03-01', filho_id:'alvo' }],
  respostas:       [{ id:'r1', filho_id:'alvo' }, { id:'r2', filho_id:'alvo' }],
  pushTokens:      [{ id:'p1', filho_id:'alvo' }],
  avisosLidos:     [{ id:'a1', filho_id:'outro' }],
  eventoInscricoes:[],
  escalas: [
    { id:'e1', alocacoes:[{ filho_id:'alvo' }, { filho_id:'outro' }] },
    { id:'e2', alocacoes:[{ filho_id:'outro' }] },
    { id:'e3' },                                    // escala sem alocações
  ],
  kanban: [
    { id:'k1', responsaveis:['alvo','outro'] },
    { id:'k2', responsaveis:[] },
    { id:'k3' },                                    // card sem responsáveis
  ],
};
const { RASTROS, rastrosDe, totalRastros, mesesAfastado, RETENCAO_PADRAO_MESES } = montar(S);

// ── contagem ─────────────────────────────────────────────────────────────
assert.equal(totalRastros('alvo'), 7, 'disp 1 + rega 1 + respostas 2 + push 1 + escala 1 + kanban 1');
assert.equal(totalRastros('outro'), 5, 'disp 1 + aviso lido 1 + escalas 2 + kanban 1');
assert.equal(totalRastros('ninguem'), 0, 'quem não tem rastro conta zero, não quebra');

// Lista vazia e campo ausente não podem virar match nem exceção — é o que
// acontece quando se escreve `d.responsaveis.includes(...)` sem guarda.
assert.doesNotThrow(() => rastrosDe('alvo'));
const porCol = Object.fromEntries(rastrosDe('alvo').map(r => [r.col, r.docs.length]));
assert.equal(porCol['adm_escalas'], 1, 'só a escala que tem a pessoa dentro');
assert.equal(porCol['adm_kanban'], 1);
assert.equal(porCol['adm_avisos_lidos'], undefined, 'collection sem rastro não entra na lista');

// ── o mapa cobre o que a tela promete ────────────────────────────────────
assert.equal(RASTROS.length, 8, 'a tela diz "os oito lugares" — se mudar, muda o texto junto');
for (const r of RASTROS) {
  assert.ok(['doc','lista'].includes(r.modo), `modo desconhecido em ${r.col}`);
  assert.ok(r.rotulo, `${r.col} sem rótulo — a tela mostraria undefined antes de apagar`);
  if (r.modo === 'lista') assert.ok(r.chave, `${r.col} é lista e não diz qual campo`);
}
// Nenhuma collection do financeiro entra: a tela promete que não toca no dinheiro.
for (const r of RASTROS) assert.ok(!r.col.startsWith('fin_'), `${r.col} é do financeiro e não pode estar aqui`);

// ── prazo ────────────────────────────────────────────────────────────────
assert.equal(mesesAfastado({}), null, 'sem saiu_em é null, não zero — zero venceria na hora');
const doisAnos = { saiu_em: { seconds: Math.floor(Date.now()/1000) - Math.floor(24*30.44*86400) } };
assert.ok(mesesAfastado(doisAnos) >= RETENCAO_PADRAO_MESES, 'dois anos tem que vencer o padrão');
assert.equal(mesesAfastado({ saiu_em: { seconds: Math.floor(Date.now()/1000) } }), 0);

console.log('✓ expurgo: 17 asserções');
