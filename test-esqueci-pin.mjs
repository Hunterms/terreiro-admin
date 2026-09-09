// Confere que a tela de PIN entrega o CAMINHO do reset, e não só o conselho.
// Roda: node test-esqueci-pin.mjs
//
// Por que existe: quem esquece o PIN está do lado de fora do app, e o chaveiro
// é humano (o botão "Esqueceu o PIN" do admin). Se o link do WhatsApp sumir,
// ou vier sem o nome de quem pediu, a pessoa fica trancada e o admin não sabe
// de quem é o pedido — e nada nesta tela dá erro pra avisar.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./area-filho.html', import.meta.url), 'utf8');
const bloco = html.split('function dicaDestrava(filho, motivo = \'pin\') {')[1]?.split('\n}')[0];
assert.ok(bloco, 'dicaDestrava não encontrada em area-filho.html');

const fazer = (whatsapp, filho, motivo) =>
  new Function('APP', 'filho', 'motivo', bloco)({ cfgAgendamento: { whatsapp } }, filho, motivo);

const ana = { nome: 'Ana Maria' };

// ── esqueceu o PIN: link com o nome dentro ────────────────────────────────
const pin = fazer('5519999999999', ana, 'pin');
assert.match(pin, /wa\.me\/5519999999999\?text=/, 'sem link de WhatsApp');
assert.match(pin, /Ana%20Maria/, 'o pedido não diz quem está pedindo');
assert.match(pin, /esqueci%20meu%20PIN/, 'o pedido não diz o que a pessoa quer');
assert.match(pin, /Esqueceu o PIN\?/);

// ── telefone desatualizado é outro pedido ─────────────────────────────────
const tel = fazer('5519999999999', ana, 'tel');
assert.match(tel, /telefone%20do%20meu%20cadastro/, 'o caso do telefone virou o pedido de PIN');
assert.doesNotMatch(tel, /zera/, 'pedir correção de cadastro não é pedir pra zerar PIN');

// ── casa sem WhatsApp configurado não mostra link quebrado ────────────────
const semWpp = fazer('', ana, 'pin');
assert.doesNotMatch(semWpp, /wa\.me/, 'link com número vazio');
assert.match(semWpp, /administração/, 'sem número, ao menos diz pra procurar a administração');

// ── número com máscara continua servindo ──────────────────────────────────
assert.match(fazer('+55 (19) 99999-9999', ana, 'pin'), /wa\.me\/5519999999999\?/, 'a máscara do número foi pro link');

console.log('✓ o reset do PIN tem caminho na tela do filho');

// ── O LAÇO DO DESTRAVE ────────────────────────────────────────────────────
//
// Três coisas que só aparecem no uso, e nenhuma delas dá erro na tela:
// celular errado tem que voltar pra tela do CELULAR (e não pedir o PIN de
// novo), trava tem que abortar, e o acerto tem que devolver o PIN novo pra
// quem chamou entrar com ele.
const fonte = html.split('async function recuperarPin(filho) {')[1]
  ?.split('\n// ── TROCAR O PIN DE DENTRO')[0]
  ?.trimEnd().replace(/\}$/, '');   // o } que fecha a própria função
assert.ok(fonte, 'recuperarPin não encontrada');

function rodar({ respostas, resultados }) {
  const telas = [];
  const pedirPin = async (opts) => {
    telas.push(opts.digitos === 11 ? 'celular' : 'pin');
    const r = respostas.shift();
    return r === undefined ? null : r;
  };
  const Filhos = {
    explicar: (e) => e,
    criarPin: async () => {
      const r = resultados.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const fn = new Function('pedirPin', 'dicaDestrava', 'Filhos', 'APP', 'alert', 'toast',
    `return async function recuperarPin(filho) {${fonte}}`)(
    pedirPin, () => '', Filhos, { cfgAgendamento: {} }, () => {}, () => {});
  return fn({ id: 'ana', nome: 'Ana' }).then((pin) => ({ pin, telas }));
}

const erro = (msg, status) => Object.assign(new Error(msg), { status });

// acerto: celular + PIN novo → devolve o PIN pra quem chamou
assert.deepEqual(
  await rodar({ respostas: ['19998877665', '4731'], resultados: [{ ok: true, sessao: 's' }] }),
  { pin: '4731', telas: ['celular', 'pin'] });

// celular errado: volta pro CELULAR, não pro PIN
const r403 = await rodar({
  respostas: ['19998877600', '4731', '19998877665', '4731'],
  resultados: [erro('a prova atual não confere', 403), { ok: true, sessao: 's' }],
});
assert.equal(r403.pin, '4731');
assert.deepEqual(r403.telas, ['celular', 'pin', 'celular', 'pin'], 'não voltou pra tela do celular');

// travado (429): para de insistir
const r429 = await rodar({
  respostas: ['19998877665', '4731', '19998877665', '4731'],
  resultados: [erro('Muitas tentativas. Tenta em 9 min.', 429)],
});
assert.equal(r429.pin, null, 'insistiu depois da trava');
assert.deepEqual(r429.telas, ['celular', 'pin']);

// desistiu na primeira tela: ninguém pede PIN novo
assert.deepEqual(await rodar({ respostas: [null], resultados: [] }),
  { pin: null, telas: ['celular'] });

// a dica de quem esqueceu tem o link do destrave, e não só o WhatsApp
assert.match(pin, /id="pin-esqueci"/, 'a tela de entrada não oferece o destrave sozinho');
assert.doesNotMatch(tel, /id="pin-esqueci"/, 'quem trocou de número não destrava pelo número');

console.log('✓ o destrave pelo celular volta pro campo certo, respeita a trava e devolve o PIN');
