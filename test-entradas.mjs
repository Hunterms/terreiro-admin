import { linhasDeEntrada, somarPor } from './entradas.js';
import assert from 'node:assert';
const L = linhasDeEntrada({
  mensalidades: [
    { status:'pago', ciclo:'2026-11', filho_nome:'Ana', pagamento_centavos:20000, pago_automatico:true, metodo_pagamento:'pix', pagoEm:'2026-11-10T15:00:00Z' },
    { status:'aberto', ciclo:'2026-11', filho_nome:'Bia' },
  ],
  atendimentos: [
    { servico_nome:'Búzios', valor:150, status_pagamento:'pago_dinheiro', pago_em:{ seconds: Date.parse('2026-11-12T15:00:00Z')/1000 }, origem_solicitacao_id:'s1' },
    { servico_nome:'Búzios', valor:150, status_pagamento:'pendente' },
  ],
  solicitacoes: [
    { id:'s1', pago_automatico:true, pagamento_centavos:15000, pagoEm:'2026-11-11T15:00:00Z' }, // virou atendimento: não conta 2x
    { id:'s2', servico_nome:'Búzios', pago_automatico:true, pagamento_centavos:15000, metodo_pagamento:'cartao', pagoEm:'2026-11-13T15:00:00Z' },
  ],
  pedidos: [
    { status:'confirmado', produto_nome:'Vela', valor:30, criadoEm:'2026-11-14T15:00:00Z' },
    { status:'cancelado', pago_automatico:true, valor:99 },
    { status:'pendente', pago_automatico:true, filho_id:'f1', produto_nome:'Guia', pagamento_centavos:5000, pagoEm:'2026-11-14T15:00:00Z' },
  ],
  inscricoes: [{ status:'pago', evento_id:'e1', valor:40, criadoEm:'2026-11-15T15:00:00Z' }],
  eventos: [{ id:'e1', titulo:'Festa de Exu' }],
});
assert.strictEqual(L.length, 6);
assert.strictEqual(L.reduce((s,l)=>s+l.valor,0), 200+150+150+30+50+40);
assert.strictEqual(L.filter(l=>l.mensalidade).reduce((s,l)=>s+l.valor,0), 200);
assert.deepStrictEqual(somarPor(L,'grupo').map(g=>[g.chave,g.total]),
  [['Jogos e consultas',300],['Mensalidade',200],['Produtos (filhos)',50],['Eventos',40],['Produtos',30]]);
assert.strictEqual(L.find(l=>l.item==='Festa de Exu').data, '2026-11-15');
assert.strictEqual(L[0].metodo, 'checkout · pix');
console.log('ok');
