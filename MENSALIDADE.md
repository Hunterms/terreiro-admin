# Mensalidade e pagamento recorrente — desenho

**Data**: 2026-07-30 · escrito antes de codar, pra decisão não virar arqueologia de commit.

Dois casos que parecem um: **mensalidade do terreiro** (filho paga todo mês) e
**produto recorrente** (pilates, ninjutsu, curso com mensalidade). O segundo já
existe quase inteiro; o primeiro é novo.

---

## 1. O fato que define tudo: não existe assinatura

A InfinitePay **não tem assinatura na API**. A recorrência dela é a "Gestão de
Cobranças", que vive no app: manda lembrete e gera cobrança, mas **não debita
sozinha** — cada mês o pagador confirma. Não há endpoint de plano junto do
`/links` que usamos.

Então recorrência aqui é **uma cobrança por ciclo**, não cartão guardado. Isso
serve bem ao caso: o valor varia por filho sem mexer em plano nenhum, e ninguém
é debitado por engano.

A peça que resolve os dois casos é uma só: **`ciclo`** (`YYYY-MM`) no pedido,
com id determinístico. Dá idempotência (não paga julho duas vezes), "quem está
em dia" (existe pedido pago do ciclo?) e histórico (um doc por mês, com valor e
método).

---

## 2. Dado real (medido em 2026-07-30, não estimado)

`fin_filhos`, filhos com `status: 'ativo'`:

| | |
|---|---|
| ativos | 55 |
| isentos (`valor: 0`) | 7 |
| pagantes | 48 — 44 × R$ 200, 4 × R$ 150 |
| esperado/mês | R$ 9.400 |
| sem o campo `valor` | **0** |
| prazos | 45 → dia 10 · 8 → dia 15 · 1 → dia 20 · 1 → último |
| `prazo: 'combinado'` | **0** |

Duas consequências:

- O `f.valor || 200` do financeiro é **código morto na prática**. Não vamos
  inventar default: sem valor definido, não se cobra.
- O caso `'combinado'` (que não tem data) **não existe hoje**. A regra fica
  completa pra todo filho ativo. Se aparecer um, fica sem multa automática e
  aparece numa lista pro admin resolver na mão.

---

## 3. Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Quando cai o acréscimo de R$ 10 | **o `prazo` de cada filho** | O dado já está em `fin_filhos.prazo` e já foi combinado com cada um. Quem tem prazo 20 só é multado no dia 21. |
| Atraso acumula no mês seguinte | **não, cada mês é independente** | É o que o booleano de hoje já faz. Acumular exige regra de juros e mexe no `fin_dividas` — outro projeto. |
| Quem gera a cobrança | **lote do admin + cron dia 1; e o Worker cria sob demanda se faltar** | Fica perto da "Gestão de Cobranças" e o Pai vê o mês inteiro de uma vez. |
| Toggle manual do financeiro | **continua** | Webhook fora do ar, dinheiro na gira, filho mais velho que não usa a interface. Automação não pode tirar a saída manual. |
| Financeiro reflete o detalhe | **sim** | Sem isso a automação só troca de lugar o trabalho: alguém ainda teria que olhar extrato pra saber quanto e como entrou. |

---

## 4. O acréscimo quebra uma invariante — e por que a saída não é abrir mão dela

Hoje o Worker **recalcula** o valor na confirmação de propósito: o público pode
criar o pedido, então valor gravado não é confiável (ver `valorEsperado()` no
`worker/worker.js`).

Com multa por data isso vira bug: link gerado dia 5 por R$ 200, pago dia 12 → o
recálculo esperaria R$ 210, veria R$ 200 e **recusaria como divergente**.

A saída é notar que a razão da invariante não existe neste tipo:
`fin_mensalidade_pedidos` **não é criável pelo público** — nasce do lote do
admin. Então:

- tipos criados pelo público (`sol`, `ped`, `ins`) → **recalcula** na confirmação
- tipos criados pelo admin (`men`) → **valor fixado** na geração do link, e a
  confirmação compara com o fixado

É propriedade por tipo, declarada na tabela `TIPOS`, não exceção solta no meio
do código.

---

## 5. Contrato de dados

### `fin_mensalidade_pedidos/{filho_id}__{ciclo}`

Id determinístico é o que garante um pedido por filho por mês. Criável só por
admin e Worker — as rules **negam create público** nesta collection.

**Enquanto aberto, o pedido não guarda dinheiro.** Ele é só um marcador de que o
ciclo existe pra aquele filho. Valor e vencimento são **derivados de
`fin_filhos` na hora**, todas as vezes:

```
filho_id:        string        // FK fin_filhos
filho_nome:      string        // cópia só pra view rápida (não decide nada)
ciclo:           string        // "2026-07"
avisou_atraso:   boolean       // toggle do admin: filho comunicou o atraso
status:          'aberto' | 'pago' | 'cancelado'
geradoEm:        timestamp

// escritos SÓ ao pagar — aí sim congelam
valor_cobrado:      number     // o que de fato foi cobrado
multa_aplicada:     number     // 0 ou 10
vencimento_aplicado: string    // ISO, o vencimento que valia naquele momento
+ campos de pagamento do Worker (ver SCHEMA.md 5.11)
```

Por que assim: ver seção 7. Copiar valor no lote é o que faria "mudei o valor do
filho no dia 15" exigir regerar o lote.

`status: 'aberto'` durante o mês é normal, **não é carrinho abandonado** — é a
régua de cobrança do mês. Diferente de `aguardando_pagamento` em
`vendas_pedidos`, que ali significa "foi pro checkout e não voltou".

Isento não tem pedido: `fin_filhos.valor === 0` → o lote não gera. Se o filho
virar isento no meio do mês, o pedido aberto para de pedir dinheiro sozinho,
porque o valor é derivado.

### `fin_pagamentos/{ciclo}` — continua, e é fonte de verdade

O booleano `{filhoId: true}` não morre: é o que o financeiro atual renderiza, e
é o registro do lançamento manual. O Worker **flipa ele** ao confirmar, então o
financeiro se marca sozinho mesmo antes de qualquer mudança lá.

#### O caminho de volta (achado quebrado em 01/08/2026)

A ida existia desde o começo; a volta não. Resultado medido: **filha com baixa
manual ontem viu "mensalidade atrasada" na área dela, com acréscimo** — e
entraria pré-marcada na lista de lembretes, recebendo email de cobrança.

Falhava calado dos dois lados: quem pagou era cobrado, e nada no sistema
reclamava.

**Regra agora**: pago é `pedido pago` **ou** `fin_pagamentos/{ciclo}[filho] ===
true`. Uma função pura, `estaPago()`, e todo mundo que decide passa por ela:

| Onde | O que fazia errado antes |
|---|---|
| `rotaMensalidade` | mostrava atrasado e cobrava multa de quem pagou |
| `listarLembretes` | pré-marcava pra cobrança por email |
| `enviarLembreteDeUm` | mandava o email |
| `rotaCheckout` (`men`) | deixava pagar o mês duas vezes |

**Deriva, não copia.** Marcar `status: 'pago'` no pedido ao ver o booleano
seria mais barato e estaria errado: desmarcar no financeiro deixaria o pedido
pago pra sempre — a mesma divergência ao contrário. Mesma razão da seção 7.

Se os dois estiverem marcados, **`checkout` ganha**: só ele tem recibo, método e
valor congelado. E só `true` conta — o financeiro grava `false` ao desmarcar, e
o campo fica no doc.

Custa **um** `fsGet`: `fin_pagamentos/{ciclo}` é um doc só, com o mapa inteiro.

Teste: `worker/test-pago.mjs`, 15 asserts.

### `vendas_pedidos` — ganha `ciclo`

Produto recorrente é o mesmo mecanismo. Sem `ciclo` não há como saber se aquele
pagamento é de junho ou julho, nem avisar "você já pagou este mês".

---

## 6. Regra do valor (uma só, espelhada e testada)

```
valor = valor_base + (atrasado && !avisou_atraso ? 10 : 0)

atrasado   = hoje > vencimento && status !== 'pago'
vencimento = prazo 10|15|20 → dia do mês do ciclo
             prazo 'ultimo' → último dia do mês do ciclo
             prazo 'combinado' ou vazio → sem multa automática
valor_base = fin_filhos.valor        (0 = isento, não gera pedido)
```

Mesma situação de `precoEfetivo` × `precoCentavos`: a regra existe em dois
lugares (Worker pra cobrar, tela pra mostrar) e por isso **tem teste**
(`worker/test-mensalidade.mjs`, 30 asserts). Se as duas discordarem, o filho vê um preço e
paga outro.

---

## 7. Mudar o valor ou o prazo de um filho no meio do mês

Requisito explícito: mudar o dia final ou o valor de um filho e o sistema
continuar funcionando, sem regerar nada.

**Regra: enquanto aberto, segue o cadastro. Ao pagar, congela.**

| Momento | De onde sai o valor |
|---|---|
| ciclo aberto | derivado de `fin_filhos.valor` + `prazo`, sempre na hora |
| ao pagar | congela em `valor_cobrado` / `multa_aplicada` / `vencimento_aplicado` |
| ciclos passados | o congelado, intocado |

Consequências, todas desejadas:

- Mudou de R$ 200 pra R$ 150 no dia 15 → julho aberto passa a cobrar 150 na hora
  seguinte. **Sem regerar lote.**
- Mudou o `prazo` de 10 pra 20 no dia 12 → a multa que tinha aparecido
  desaparece, porque o vencimento passou a ser dia 20. Você mudou o combinado.
- Virou isento no meio do mês → o pedido aberto para de pedir dinheiro.
- Julho já pago em R$ 200 e você muda pra R$ 150 → **julho não se altera**. A
  mudança vale de agosto em diante. Histórico é histórico.

### O link já gerado

Um link é uma oferta com valor dentro dele. Se o cadastro muda depois de o link
existir, o link fica desatualizado. A regra de confirmação resolve sem ninguém
precisar limpar nada:

```
aceita se  valor_pago >= valor_que_a_gente_ofereceu
```

Não `>= valor_atual`. Se a gente mostrou R$ 200 e o valor virou R$ 210 depois,
quem pagou 200 pagou o que foi oferecido — e é aceito. Se virou R$ 150 e a
pessoa pagou os 200 do link velho, também é aceito, e fica registrado o que ela
de fato pagou. Cobrar diferente do que foi mostrado é que seria errado.

Isso vale porque em `men` o valor oferecido é **fixado pelo Worker** no
`checkout_centavos`, e essa collection não é escrita pelo público (seção 4). Nos
tipos que o público cria, a comparação continua contra o recálculo.

---

## 8. Fluxo

```
dia 1     lote do admin        cria pedido por filho pagante do ciclo
          (botão + cron)       isento não gera pedido

qualquer  filho abre a área    Worker calcula base + multa, FIXA em
dia       e clica pagar        checkout_centavos, gera o link

          pagou                ├─► pedido: pago, valor, método, recibo, nsu
                               ├─► fin_pagamentos/{ciclo}.{filho} = true
                               └─► financeiro mostra valor, data e método
```

**O lote não precisa ser clique.** Cloudflare Worker aceita Cron Trigger no
plano free: mesma função, dois gatilhos — botão no admin (pra ver acontecer) e
cron dia 1 às 6h (pra não depender de alguém lembrar).

Onde o filho paga: **`area-filho.html`**, que já é a casa dele e já é
trust-based por 4 dígitos do telefone. O módulo de Lembretes que já existe passa
a mandar o link, e o `prazo` diz quando.

---

## 9. Fases

0. ~~Repo e deploy do financeiro~~ — feito: Netlify conectada ao git, login
   trocado por Firebase Auth de verdade (os painéis não liam nada sem isso).
1. **Worker + dados** — tipo `men` na tabela `TIPOS`, valor fixado, regra da
   multa com teste, rules negando create público em `fin_mensalidade_pedidos`.
2. **Lote** — botão no admin + Cron Trigger, idempotente (rodar duas vezes não
   duplica, por causa do id determinístico).
3. **Filho paga** — bloco de mensalidade na `area-filho.html`, reusando o
   `checkout.js` que já existe.
4. **Governança no financeiro** — decidido em 30/07: fica na aba de mensalidades
   que já existe, não vira tela nova no admin. O painel lê o pedido do ciclo e
   mostra pago-no-cartão, acréscimo, recibo, e o botão "avisou o atraso". O
   toggle manual continua. **Feito** (`candieiro-financeiro` 5e794ca).
5. ~~Financeiro responde~~ — virou a fase 4.
6. **Produto recorrente** — `ciclo` em `vendas_pedidos` e aviso de "já pago
   este mês" no `vendas.html`.

---

## 10. Risco aberto: a produção do financeiro está 2 meses atrás do repo dele

O financeiro **é versionado**: `Hunterms/candieiro-financeiro` (privado), 3
commits, modular desde 11/04 (`index.html` + `js/app.js` + `css/main.css`).
Repo em `~/Desktop/Docs/candieiro-financeiro`.

O problema é outro: **a Netlify não está conectada ao repo**. O que está no ar é
o monolito da linhagem antiga (250 KB num arquivo, sha `f120b877ce75bf0d`), que
sobrevive em `~/Desktop/Docs/candieiro-simples` e é de onde os deploys manuais
saíam.

Medido, não estimado — marcadores de funcionalidade dos dois lados:

| | |
|---|---|
| só no repo | `fin_reembolsos`, `renderReembolsos`, `panel-reembolsos`, `aprovarReembolso`, `pagarReembolso`, `rejeitarReembolso`, `setReembTab` |
| só na produção | `window.salvarTemplate` — e **não é perda**: no repo o template salva no `input` via `addEventListener`, o botão ficou desnecessário |

**Custo que isso já tem hoje**: `fin_reembolsos` é escrito pelo form público
(`reembolso.html`, linkado na área do filho) e **lido por ninguém em produção** —
o `terreiro-admin` não tem tela de reembolso (zero referências), e a única que
existe é a aba que nunca foi publicada. Todo reembolso pedido desde junho está
invisível.

Então a ordem certa é: **conectar a Netlify ao repo** (ganha Reembolsos e o fix
de isento, perde nada), conferir no ar, e só depois a fase 5. Feito isso, a
pasta `candieiro-simples` deve sair do disco — enquanto existir, alguém pode
arrastar ela pra Netlify e reverter dois meses.

### Nota de implementação achada aqui

O repo já tem `getPrazoNum(f)`, que é exatamente a conversão que a multa precisa:
`10|15|20` → o dia, `'ultimo'` → 31, `'combinado'` → 99. A regra da seção 6 deve
**espelhar essa**, não inventar outra.

Um detalhe: `'ultimo'` → 31 significa que em mês de 30 dias o vencimento nunca
chega. Pra exibição tanto faz, pra multa não — no Worker o `'ultimo'` usa o
último dia real do mês do ciclo. É divergência deliberada, e é por isso que a
regra tem teste.

---

## 11. Dívida achada de passagem: dois tokens em texto puro

Dois remotes guardavam Personal Access Token na URL, legível em `.git/config`:

- `terreiro-pdv` → `ghp_3NYO…`
- `candieiro-financeiro` → `ghp_aqI5…` (já trocado pro alias SSH `github-hunterms`)

Os dois apareceram em output de terminal em 30/07/2026. **Revogar ambos** em
github.com/settings/tokens e deixar os remotes em SSH. O `terreiro-pdv` ainda
está com token na URL.
