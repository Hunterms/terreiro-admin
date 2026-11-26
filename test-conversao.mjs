import assert from 'node:assert';
import { resumoDeVisitas, sugestaoDaSemana } from './worker/worker.js';
const L = (sessao, tipo, campanha, fonte='Instagram') => ({ sessao, tipo, campanha, fonte, dia:'2026-11-26', hora:10 });
const linhas = [L('a','home','story-buzios'), L('a','agendar',null), L('a','horario',null), L('a','enviou',null),
  L('b','home',null,'google.com'), L('c','agendar',null,'direto')];
const sols = [{ origem:'agendar_publico', criadoEm:'2026-11-26T12:00:00Z', campanha:'story-buzios', fonte:'Instagram', status:'aprovada', valor_proposto:150, servico_nome:'Búzios' },
  { origem:'agendar_publico', criadoEm:'2026-11-26T12:00:00Z', status:'pendente', servico_nome:'X' }];
const r = resumoDeVisitas(linhas, sols, '2026-11-20');
const o = Object.fromEntries(r.origens.map(x => [x.nome, x]));
assert.deepEqual([o['story-buzios'].pessoas, o['story-buzios'].enviou, o['story-buzios'].pedidos, o['story-buzios'].pagos, o['story-buzios'].valor], [1,1,1,1,150]);
assert.equal(o['google.com'].pessoas, 1); assert.equal(o['direto'].agendar, 1); assert.equal(o['antes da medição'].pedidos, 1);
console.log(sugestaoDaSemana(r));
console.log('ok');
