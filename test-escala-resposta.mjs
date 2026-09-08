// Confere que salvar a escala NÃO apaga a resposta do filho.
// Roda: node test-escala-resposta.mjs
//
// Por que existe: esta tela reconstrói o array de alocações inteiro a cada
// save, e a resposta ("confirmo" / "não posso") mora dentro da alocação. Abrir
// a escala e clicar em Salvar sem mudar nada apagaria a confirmação de todo
// mundo — calado, e justamente na véspera, que é quando o admin abre a escala.
//
// A outra metade: trocar a pessoa de função NÃO pode levar a resposta junto.
// Quem disse "posso" pra limpeza não disse "posso" pra cambone.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const bloco = html.split("$('#es-save').onclick = async () => {")[1]?.split('const data = {')[0];
assert.ok(bloco, 'bloco do save da escala não encontrado');

// O save lê do DOM. Aqui o DOM é de mentira: cada função devolve os chips
// marcados que o teste quiser.
function salvar(alocAntigas, selecao) {
  const esc = { alocacoes: alocAntigas };
  const funcoesAtivas = Object.keys(selecao).map(id => ({ id }));
  const $$ = (q) => {
    const fnId = q.match(/#e-([^\s]+)/)[1];
    return (selecao[fnId] || []).map(fid => ({ dataset: { fid } }));
  };
  return new Function('esc', 'funcoesAtivas', '$$', bloco + '\nreturn alocacoes;')(esc, funcoesAtivas, $$);
}

const antes = [
  { funcao_id:'limpeza', filho_id:'ana',  resposta:'aceito',   resposta_em:'2026-09-01', resposta_motivo:'' },
  { funcao_id:'limpeza', filho_id:'beto', resposta:'recusado', resposta_em:'2026-09-02', resposta_motivo:'trabalho' },
  { funcao_id:'cambone', filho_id:'carla' },   // não respondeu
];

// ── salvar sem mudar nada preserva tudo ──────────────────────────────────
const igual = salvar(antes, { limpeza:['ana','beto'], cambone:['carla'] });
assert.equal(igual.find(a => a.filho_id==='ana').resposta, 'aceito', 'o "confirmo" da Ana sumiu no save');
assert.equal(igual.find(a => a.filho_id==='beto').resposta, 'recusado');
assert.equal(igual.find(a => a.filho_id==='beto').resposta_motivo, 'trabalho', 'o motivo sumiu');
assert.equal(igual.find(a => a.filho_id==='carla').resposta, undefined, 'quem não respondeu não ganha resposta');

// ── trocar de função NÃO leva a resposta junto ───────────────────────────
const trocou = salvar(antes, { limpeza:['beto'], cambone:['ana','carla'] });
assert.equal(trocou.find(a => a.filho_id==='ana').resposta, undefined,
  'a Ana confirmou LIMPEZA; movida pra cambone, a resposta não vale mais');
assert.equal(trocou.find(a => a.filho_id==='beto').resposta, 'recusado', 'o Beto ficou na mesma função');

// ── quem sai da escala some, e quem entra entra limpo ────────────────────
const novo = salvar(antes, { limpeza:['dito'] });
assert.equal(novo.length, 1);
assert.equal(novo[0].filho_id, 'dito');
assert.equal(novo[0].resposta, undefined, 'pessoa nova não herda resposta de ninguém');

// ── os campos que a tela sempre gravou continuam lá ──────────────────────
assert.equal(novo[0].status, 'escalado');
assert.equal(novo[0].notificado, false);

// ── escala nova (sem alocações anteriores) não quebra ────────────────────
assert.doesNotThrow(() => salvar(undefined, { limpeza:['ana'] }));
assert.equal(salvar([], { limpeza:['ana'] }).length, 1);

console.log('✓ resposta de escala: 12 asserções');
