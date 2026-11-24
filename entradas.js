// Entradas de dinheiro por período. Função pura: recebe as collections já
// carregadas e devolve uma linha por dinheiro que entrou, com data de pagamento.
//
// Fontes e o que conta como "entrou":
//   fin_mensalidade_pedidos  status 'pago'           (checkout da área do filho)
//   adm_atendimentos         status_pagamento pago_* (jogos e consultas do Pai)
//   adm_solicitacoes         pago_automatico sem atendimento ainda (pagou, Pai não aprovou)
//   vendas_pedidos           status 'confirmado' ou pago_automatico
//   evento_inscricoes        status 'pago'
//
// O toggle manual da mensalidade (fin_pagamentos/{ciclo}) fica de fora: é um
// booleano sem data nem valor, então não cabe num filtro por dia.

const dia = v => {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v)
    : v.toDate ? v.toDate()
    : v.seconds ? new Date(v.seconds * 1000) : null;
  if (!d || isNaN(d)) return '';
  // dia LOCAL: pago às 22h de Brasília não pode cair no dia seguinte
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const valorDe = x => x.pagamento_centavos ? x.pagamento_centavos / 100 : (Number(x.valor_cobrado ?? x.valor ?? x.valor_proposto) || 0);
const metodoDe = x => x.pago_automatico
  ? `checkout · ${x.metodo_pagamento === 'pix' ? 'pix' : 'cartão'}`
  : ((x.status_pagamento || '').replace('pago_', '') || x.metodo_pagamento || 'manual');

export function linhasDeEntrada({ mensalidades = [], atendimentos = [], solicitacoes = [], pedidos = [], inscricoes = [], eventos = [] }) {
  const L = [];
  const push = (x, grupo, item, nome, dataPag) => {
    const v = valorDe(x);
    if (v > 0) L.push({ data: dia(dataPag), grupo, item, nome: nome || '', valor: v, metodo: metodoDe(x), mensalidade: grupo === 'Mensalidade' });
  };

  for (const m of mensalidades) if (m.status === 'pago')
    push(m, 'Mensalidade', `Mensalidade ${m.ciclo || ''}`.trim(), m.nome || m.filho_nome, m.pagoEm);

  const comAtendimento = new Set();
  for (const a of atendimentos) {
    if (a.origem_solicitacao_id) comAtendimento.add(a.origem_solicitacao_id);
    if (!(a.status_pagamento || '').startsWith('pago') || a.status_atendimento === 'cancelado') continue;
    push(a, 'Jogos e consultas', a.servico_nome || 'Consulta', a.consulente_nome, a.pago_em || a.data);
  }
  for (const s of solicitacoes) if (s.pago_automatico && !comAtendimento.has(s.id))
    push(s, 'Jogos e consultas', s.servico_nome || 'Consulta', s.nome, s.pagoEm);

  for (const p of pedidos) if (p.status !== 'cancelado' && (p.status === 'confirmado' || p.pago_automatico))
    push(p, p.filho_id ? 'Produtos (filhos)' : 'Produtos', p.produto_nome || 'Produto', p.nome, p.pagoEm || p.confirmadoEm || p.criadoEm);

  const nomeEv = Object.fromEntries(eventos.map(e => [e.id, e.titulo || e.nome || 'Evento']));
  for (const i of inscricoes) if (i.status === 'pago')
    push(i, 'Eventos', nomeEv[i.evento_id] || 'Evento', i.nome, i.pagoEm || i.criadoEm);

  return L;
}

// Soma por chave, maior primeiro.
export function somarPor(linhas, chave) {
  const m = new Map();
  for (const l of linhas) {
    const k = l[chave];
    const t = m.get(k) || { chave: k, total: 0, qtd: 0 };
    t.total += l.valor; t.qtd++;
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
