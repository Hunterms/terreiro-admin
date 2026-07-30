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
assert.ok(a.includes('ou até 12x de R$ 16,67'), 'parcela do cartão');
assert.ok(a.includes('href="https://x"'), 'link');
assert.ok(a.includes('Curso de Tarot'), 'nome do item');

const b = n(caixaCheckout({ url:'https://x', valor:100, item:'Curso', valorCheio:200, descontoLabel:'Desconto afirmativo' }));
assert.ok(b.includes('Subtotal') && b.includes('R$ 200,00'), 'subtotal cheio');
assert.ok(b.includes('− R$ 100,00'), 'economia');
assert.ok(b.includes('Desconto afirmativo'), 'label do desconto');

// valorCheio igual ao total não pode virar desconto de zero
const c = n(caixaCheckout({ url:'https://x', valor:200, item:'Curso', valorCheio:200 }));
assert.ok(!c.includes('Subtotal'), 'sem desconto falso');

// curso parcelado: mostra 1ª de N e não oferece 12x em cima da parcela
const d = n(caixaCheckout({ url:'https://x', valor:150, item:'Curso', parcelaDe:4 }));
assert.ok(d.includes('1ª de 4 parcelas'), 'primeira parcela');
assert.ok(!d.includes('ou até 12x'), 'não empilha parcelamento');

console.log('ok — 13 asserts do resumo passaram');
