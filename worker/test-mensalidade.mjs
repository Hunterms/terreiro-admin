// Self-check da mensalidade. A regra vive em dois lugares — Worker pra cobrar,
// tela pra mostrar — e se discordarem o filho vê um preço e paga outro.
//
//   node worker/test-mensalidade.mjs

import assert from 'node:assert/strict';
import {
  mensalidadeReais, vencimentoMensalidade, ultimoDiaDoCiclo, precoCentavos, MULTA_ATRASO,
  podeAjustar, dataDeAjusteValida, minutosDoDia, naJanelaDeUmaHora, ehAtividadePublica,
} from './worker.js';

// ── vencimento por prazo ───────────────────────────────────────────────────
assert.equal(vencimentoMensalidade('10', '2026-07'), '2026-07-10');
assert.equal(vencimentoMensalidade('15', '2026-07'), '2026-07-15');
assert.equal(vencimentoMensalidade('20', '2026-07'), '2026-07-20');

// prazo vazio conta como dia 10 — mesmo default do getPrazoNum do financeiro
assert.equal(vencimentoMensalidade(undefined, '2026-07'), '2026-07-10');
assert.equal(vencimentoMensalidade('', '2026-07'), '2026-07-10');

// 'combinado' não tem data, então não tem multa automática
assert.equal(vencimentoMensalidade('combinado', '2026-07'), null);

// 'ultimo' usa o último dia REAL do mês. O financeiro usa 31 como atalho, o que
// em mês de 30 dias faria o vencimento nunca chegar.
assert.equal(ultimoDiaDoCiclo('2026-07'), 31);
assert.equal(ultimoDiaDoCiclo('2026-04'), 30);
assert.equal(ultimoDiaDoCiclo('2026-02'), 28);
assert.equal(ultimoDiaDoCiclo('2024-02'), 29); // bissexto
assert.equal(vencimentoMensalidade('ultimo', '2026-04'), '2026-04-30');
assert.equal(vencimentoMensalidade('ultimo', '2026-02'), '2026-02-28');

// ── valor: base, atraso e a flag de avisado ────────────────────────────────
const jul = { ciclo: '2026-07' };
const f200 = { valor: 200, prazo: '10' };

// em dia, e no próprio dia do vencimento ainda é em dia
assert.equal(mensalidadeReais(jul, f200, '2026-07-05'), 200);
assert.equal(mensalidadeReais(jul, f200, '2026-07-10'), 200);

// um dia depois, cai a multa
assert.equal(mensalidadeReais(jul, f200, '2026-07-11'), 210);

// avisou do atraso → sem multa, mesmo atrasado
assert.equal(mensalidadeReais({ ...jul, avisou_atraso: true }, f200, '2026-07-25'), 200);

// prazo maior atrasa a multa: dia 12 é em dia pra quem tem prazo 15
assert.equal(mensalidadeReais(jul, { valor: 200, prazo: '15' }, '2026-07-12'), 200);
assert.equal(mensalidadeReais(jul, { valor: 200, prazo: '15' }, '2026-07-16'), 210);

// valor diferente por filho — 4 filhos pagam 150
assert.equal(mensalidadeReais(jul, { valor: 150, prazo: '10' }, '2026-07-05'), 150);
assert.equal(mensalidadeReais(jul, { valor: 150, prazo: '10' }, '2026-07-20'), 160);

// isento não paga, e atraso não inventa dívida pra quem é isento
assert.equal(mensalidadeReais(jul, { valor: 0, prazo: '10' }, '2026-07-25'), 0);
assert.equal(mensalidadeReais(jul, { prazo: '10' }, '2026-07-25'), 0); // sem campo valor

// ── data combinada pelo próprio filho, só naquele mês ──────────────────────
// Ela vence o prazo do cadastro...
assert.equal(vencimentoMensalidade('10', '2026-07', '2026-07-25'), '2026-07-25');
assert.equal(mensalidadeReais({ ...jul, venc_combinado: '2026-07-25' }, f200, '2026-07-20'), 200);
assert.equal(mensalidadeReais({ ...jul, venc_combinado: '2026-07-25' }, f200, '2026-07-26'), 210);

// ...mas só dentro do ciclo dela. Data de outro mês é ignorada, senão um valor
// torto no pedido adiaria a multa pra sempre.
assert.equal(vencimentoMensalidade('10', '2026-07', '2026-09-25'), '2026-07-10');
assert.equal(mensalidadeReais({ ...jul, venc_combinado: '2026-09-25' }, f200, '2026-07-11'), 210);

// prefixo tem que ser o ciclo inteiro: '2026-0' não pode casar com '2026-07'
assert.equal(vencimentoMensalidade('10', '2026-07', '2026-070-1'), '2026-07-10');

// ── isenção do mês ─────────────────────────────────────────────────────────
// Aprovada zera. Pedida ainda não vale nada — quem decide é gente.
assert.equal(mensalidadeReais({ ...jul, isencao_status: 'aprovada' }, f200, '2026-07-25'), 0);
assert.equal(mensalidadeReais({ ...jul, isencao_status: 'pedida' }, f200, '2026-07-25'), 210);
assert.equal(mensalidadeReais({ ...jul, isencao_status: 'recusada' }, f200, '2026-07-25'), 210);

// ── janela de ajuste: dia 1 a 5 do próprio ciclo ───────────────────────────
assert.equal(podeAjustar('2026-07', '2026-07-01'), true);
assert.equal(podeAjustar('2026-07', '2026-07-05'), true);
assert.equal(podeAjustar('2026-07', '2026-07-06'), false);
assert.equal(podeAjustar('2026-07', '2026-08-03'), false); // ciclo passado não reabre
assert.equal(podeAjustar('2026-09', '2026-07-03'), false); // ciclo futuro também não

// a data escolhida tem que ser deste mês e não pode ser pra trás
assert.equal(dataDeAjusteValida('2026-07-25', '2026-07', '2026-07-03'), true);
assert.equal(dataDeAjusteValida('2026-07-03', '2026-07', '2026-07-03'), true);  // hoje vale
assert.equal(dataDeAjusteValida('2026-07-02', '2026-07', '2026-07-03'), false); // ontem não
assert.equal(dataDeAjusteValida('2026-08-10', '2026-07', '2026-07-03'), false); // outro mês
assert.equal(dataDeAjusteValida('2026-07-31', '2026-07', '2026-07-03'), true);
assert.equal(dataDeAjusteValida('2026-04-31', '2026-04', '2026-04-03'), false); // 31 de abril
assert.equal(dataDeAjusteValida('25/07/2026', '2026-07', '2026-07-03'), false); // formato
assert.equal(dataDeAjusteValida('', '2026-07', '2026-07-03'), false);
assert.equal(dataDeAjusteValida(null, '2026-07', '2026-07-03'), false);

// ── lembrete de 1h: leitura da hora e a janela ─────────────────────────────
assert.equal(minutosDoDia('09:30'), 570);
assert.equal(minutosDoDia('9:30'), 570);
assert.equal(minutosDoDia('00:00'), 0);
// hora torta ou vazia vira null, NÃO zero: senão consulta sem hora vira
// meia-noite e dispara o lembrete na primeira batida do dia
assert.equal(minutosDoDia(''), null);
assert.equal(minutosDoDia(undefined), null);
assert.equal(minutosDoDia('25:00'), null);
assert.equal(minutosDoDia('10:70'), null);

// a janela é [45, 75] minutos à frente — larga o bastante pra nenhuma consulta
// escapar entre duas batidas de 15 em 15
assert.equal(naJanelaDeUmaHora(540, 600), true);   // 1h exata
assert.equal(naJanelaDeUmaHora(540, 585), true);   // 45min: borda de baixo
assert.equal(naJanelaDeUmaHora(540, 615), true);   // 75min: borda de cima
assert.equal(naJanelaDeUmaHora(540, 584), false);  // 44min
assert.equal(naJanelaDeUmaHora(540, 616), false);  // 76min
assert.equal(naJanelaDeUmaHora(540, 530), false);  // já passou

// A janela é larga de propósito: com 31 minutos, DUAS ou TRÊS batidas caem
// dentro dela, e é isso que faz o lembrete sobreviver a um tick perdido. Quem
// garante um push só é a flag `push_1h_em` gravada no atendimento — a janela
// garante que sempre há pelo menos uma chance.
const BATIDAS = [0, 15, 30, 45, 60, 75, 90, 105, 120].map((m) => 480 + m);
for (const consulta of [600, 607, 615, 622, 630]) {
  const dentro = BATIDAS.filter((agora) => naJanelaDeUmaHora(agora, consulta));
  assert.ok(dentro.length >= 1, `consulta às ${consulta}min ficaria sem lembrete`);

  // O tick real, com a flag: passa em todas as batidas e conta os envios.
  let marca = null, enviados = 0;
  for (const agora of BATIDAS) {
    if (marca === '2026-07-03') continue;                  // já avisou hoje
    if (!naJanelaDeUmaHora(agora, consulta)) continue;
    enviados++;
    marca = '2026-07-03';
  }
  assert.equal(enviados, 1, `consulta às ${consulta}min: ${enviados} pushes`);
}

// 'combinado' nunca leva multa automática
assert.equal(mensalidadeReais(jul, { valor: 200, prazo: 'combinado' }, '2026-12-31'), 200);

// 'ultimo' em mês de 30 dias: dia 30 em dia, dia 1 do mês seguinte atrasado
assert.equal(mensalidadeReais({ ciclo: '2026-04' }, { valor: 200, prazo: 'ultimo' }, '2026-04-30'), 200);
assert.equal(mensalidadeReais({ ciclo: '2026-04' }, { valor: 200, prazo: 'ultimo' }, '2026-05-01'), 210);

// ── integração com o preço em centavos ─────────────────────────────────────
assert.equal(precoCentavos('men', jul, f200, '2026-07-05'), 20000);
assert.equal(precoCentavos('men', jul, f200, '2026-07-11'), 21000);
assert.equal(precoCentavos('men', jul, { valor: 149.9, prazo: '10' }, '2026-07-05'), 14990);
assert.equal(precoCentavos('men', jul, { valor: 0 }, '2026-07-05'), 0);

// o valor gravado no pedido é ignorado: quem manda é fin_filhos
assert.equal(precoCentavos('men', { ...jul, valor_cobrado: 1 }, f200, '2026-07-05'), 20000);

assert.equal(MULTA_ATRASO, 10);

console.log('ok — 81 asserts de mensalidade passaram');

// ── o que é de dentro não sai na agenda pública ────────────────────────────
// Esta lista decide o que a internet vê da casa. Ela morava num Set dentro do
// index.html do site, e o dado continuava aberto por trás.
assert.equal(ehAtividadePublica({ tipo: 'gira_aberta' }), true);
assert.equal(ehAtividadePublica({ tipo: 'festa' }), true);
assert.equal(ehAtividadePublica({ tipo: 'apresentacao_cultural' }), true);

assert.equal(ehAtividadePublica({ tipo: 'desenvolvimento' }), false);   // segunda, dos médiuns
assert.equal(ehAtividadePublica({ tipo: 'gira_fechada' }), false);
assert.equal(ehAtividadePublica({ tipo: 'trabalho_interno' }), false);
assert.equal(ehAtividadePublica({ tipo: 'obrigacao_coletiva' }), false);
assert.equal(ehAtividadePublica({ tipo: 'reuniao' }), false);
assert.equal(ehAtividadePublica({ tipo: 'mutirao' }), false);
assert.equal(ehAtividadePublica({ tipo: 'ensaio_curimba' }), false);

// a marca manual do admin vence o tipo
assert.equal(ehAtividadePublica({ tipo: 'gira_aberta', publico: false }), false);
assert.equal(ehAtividadePublica({ tipo: 'gira_aberta', arquivado: true }), false);

// sem tipo NÃO some. Os docs antigos não têm o campo, e sumir com a agenda
// inteira do site num deploy é pior que mostrar um evento a mais.
assert.equal(ehAtividadePublica({ data: '2026-09-01' }), true);
assert.equal(ehAtividadePublica(null), false);
