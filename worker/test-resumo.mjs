import assert from 'node:assert/strict';
import { caixaCheckout, brl } from '../checkout.js';

// O Intl usa espaço não-quebrável entre R$ e o número. Normaliza pra comparar.
const n = s => s.replace(/[  ]/g, ' ');

assert.equal(n(brl(1)), 'R$ 1,00');
assert.equal(n(brl(149.9)), 'R$ 149,90');
assert.equal(n(brl(1000)), 'R$ 1.000,00');

const a = n(caixaCheckout({ url:'https://x', valor:200, item:'Curso de Tarot' }));
assert.ok(a.includes('R$ 200,00'), 'total');
assert.ok(!a.includes('Subtotal'), 'sem subtotal quando não tem desconto');
assert.ok(a.includes('href="https://x"'), 'link');
assert.ok(a.includes('Curso de Tarot'), 'nome do item');

// Não induzir crédito parcelado: quem oferece isso é a InfinitePay, na tela
// dela. O terreiro mostra o que está sendo comprado e quanto é.
assert.ok(!/\d+x/.test(a), 'não fala de parcelar no cartão');
assert.ok(!a.includes('parcela'), 'nem menciona parcela quando não é curso');

const b = n(caixaCheckout({ url:'https://x', valor:100, item:'Curso', valorCheio:200, descontoLabel:'Desconto afirmativo' }));
assert.ok(b.includes('Subtotal') && b.includes('R$ 200,00'), 'subtotal cheio');
assert.ok(b.includes('− R$ 100,00'), 'economia');
assert.ok(b.includes('Desconto afirmativo'), 'label do desconto');

// valorCheio igual ao total não pode virar desconto de zero
const c = n(caixaCheckout({ url:'https://x', valor:200, item:'Curso', valorCheio:200 }));
assert.ok(!c.includes('Subtotal'), 'sem desconto falso');

// Mensalidade de curso é outra coisa e continua: o que está sendo cobrado
// agora é a 1ª de N. Omitir isso seria esconder o preço real.
const d = n(caixaCheckout({ url:'https://x', valor:150, item:'Curso', parcelaDe:4 }));
assert.ok(d.includes('1ª de 4 parcelas'), 'primeira parcela da matrícula');
assert.ok(!/\d+x de R\$/.test(d), 'ainda sem oferta de crédito parcelado');

console.log('ok — 14 asserts do resumo passaram');
