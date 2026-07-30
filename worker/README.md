| `POST /lote` | admin (mensalidade) | `X-Auth-Secret` |
| `POST /mensalidade` | `area-filho.html` | 4 dígitos do telefone do filho |
| `POST /papel` | você, na mão | `X-Auth-Secret` |
# Worker do Candieiro — email + checkout automático

Um Worker, quatro assuntos: email, checkout, mensalidade e papéis.

| Rota | Quem chama | Protegida por |
|---|---|---|
| `POST /` e `/email` | admin (`index.html`) | `X-Auth-Secret` |
| `POST /checkout` | páginas públicas | nada — só aceita id de pedido, nunca valor |
| `POST /status` | `pago.html` | nada — só responde pago/não, e confirma no `payment_check` |
| `POST /webhook` | InfinitePay | `payment_check` + conferência de valor |
| `POST /mensalidade` | `area-filho.html` | 4 últimos dígitos do telefone do filho |
| `POST /lote` | admin (mensalidade) | `X-Auth-Secret` |
| `POST /papel` | você, na mão | `X-Auth-Secret` |
| cron `0 9 1 * *` | Cloudflare | — gera o lote do mês |

Arquivo: **`worker.js`** (era `email-worker.js`, que virou este).

---

## Por que o valor não vem do navegador

O preço nunca chega pelo request. O cliente manda só `{ tipo, doc_id }`; o Worker
lê o serviço/produto/evento no Firestore e cobra o que está lá. Se o preço viesse
do frontend, dava pra abrir o devtools, trocar 150 por 1 e pagar 1.

A conferência acontece duas vezes:

1. **Ao criar o link** — o valor sai do Firestore e fica gravado no pedido, no
   campo `checkout_centavos`. O público não consegue escrever nesse campo: quem
   escreve é a service account, que ignora as security rules.
2. **No webhook** — `payment_check` confirma na InfinitePay que aquilo foi pago
   de verdade, e o valor pago é comparado com o gravado. Pagou menos, não marca
   pago: grava `pagamento_suspeito` e o admin mostra um chip vermelho.

O passo 2 não é paranoia. O endpoint `/links` da InfinitePay não pede
autenticação: qualquer pessoa com o handle `pai-nando` consegue gerar um link de
R$ 1. E o webhook também não vem assinado. Sem o passo 2, um link desses marcaria
o pedido como pago.

---

## Deploy

### 1. Sobe o código

Cloudflare → Workers & Pages → o worker que já existe (`terreiro-email`) →
**Edit code** → apaga o que está lá → cola **`worker.js`** inteiro → **Deploy**.

A rota do email continua na raiz, então o admin não quebra durante a troca.

### 2. Service account do Firebase

É ela que deixa o Worker marcar "pago" — e é justamente o que o público não pode
fazer.

1. Firebase Console → projeto **terreiro-pvd** → ⚙️ Configurações do projeto →
   **Contas de serviço**
2. **Gerar nova chave privada** → baixa o JSON
3. Do JSON, você usa dois campos:
   - `client_email` → vai em `GCP_SA_EMAIL`
   - `private_key` → vai em `GCP_SA_KEY` (copia o valor **inteiro**, com os `\n`
     literais que vêm no JSON; o Worker resolve)

Guarda esse JSON num lugar seguro. Quem tem ele escreve em todo o Firestore.

### 3. Variáveis

Cloudflare → o Worker → **Settings → Variables and Secrets**:

| Nome | Tipo | Valor |
|---|---|---|
| `RESEND_API_KEY` | Encrypt | `re_xxx` (já existe) |
| `ADMIN_SECRET` | Encrypt | a palavra que já está lá |
| `DEFAULT_FROM` | Texto | `Terreiro do Candieiro <contato@terreirodocandieiro.com.br>` |
| `INFINITEPAY_HANDLE` | Texto | `pai-nando` — **sem o `$`** |
| `SITE_URL` | Texto | `https://hunterms.github.io/terreiro-admin` |
| `GCP_SA_EMAIL` | Texto | `xxx@terreiro-pvd.iam.gserviceaccount.com` |
| `GCP_SA_KEY` | **Encrypt** | `-----BEGIN PRIVATE KEY-----\n...` |
| `CAND_API_KEY` | Texto | `AIzaSyAViFU3bdl8RKSHBuxMGAc97SPITd1aJWM` |

`CAND_API_KEY` é a chave web do projeto `terreiro-candieiro`, usada só pra **ler**
o preço dos eventos (leitura que já é pública). É a mesma que está no HTML.

`SITE_URL` é pra onde o cliente volta depois de pagar (`pago.html`). Sem barra no fim.

O endereço do webhook o Worker descobre sozinho — não tem o que configurar.

### 4. Liga no admin

Admin → **Atendimentos do Pai → Config do agendamento** → bloco
"💳 Checkout automático":

1. Cola a URL do Worker
2. Clica **🔍 Testar conexão** — ele manda um pedido inexistente de propósito.
   Resposta esperada: *"Worker respondendo, Firestore e handle OK"*. Se faltar
   alguma variável, ele diz qual.
3. Marca **Checkout automático ligado**
4. **Salvar configuração**

Isso grava `checkout_ativo` e `checkout_worker_url` em `adm_config/agendamento`,
que as três páginas públicas já leem.

### 5. Teste com dinheiro de verdade

Não tem sandbox na InfinitePay. Então:

1. Cria um produto de teste em **Vendas externas → Produtos** com valor R$ 1,00
2. Abre o link público, faz o pedido, paga no PIX pelo checkout
3. Em **Pedidos**, ele deve virar **Confirmado** com o chip
   **⚡ pago automático · R$ 1** e link pro recibo, em segundos
4. Arquiva o produto de teste

Se ficar pendente, olha o log: Cloudflare → o Worker → **Logs** → Begin log
stream, e repete. `payment_check` negando ou valor divergente aparecem lá.

---

## O que muda em cada fluxo

| Página | Antes | Depois |
|---|---|---|
| `agendar.html` | PIX pra copiar + link fixo do serviço | botão "Pagar agora" com o valor do serviço |
| `vendas.html` | PIX + 3 links fixos (cheio/promo/afirmativo) | um link só, com o preço efetivo do pedido |
| `evento.html` | pagava fora e clicava "já paguei" | "Inscrever e pagar" leva direto pro checkout |

O PIX copia e cola **continua em todas**, como segunda opção. Se o Worker cair, a
página some com o botão e segue no PIX manual — pagamento não pode virar beco sem
saída.

Os campos `infinity_link` de serviço e produto continuam existindo e voltam a
funcionar sozinhos se você desligar o checkout.

### O que o webhook escreve

Comum às três collections:

```
pago_automatico: true
metodo_pagamento: 'pix' | 'cartao'
pagoEm, pagamento_transaction_nsu, pagamento_slug,
pagamento_centavos, pagamento_parcelas, pagamento_recibo_url
comprovante_anexado: true
```

O `status` muda conforme a collection, porque o vocabulário é diferente em cada:

- `vendas_pedidos` → `confirmado`
- `evento_inscricoes` → `pago`
- `adm_solicitacoes` → **não muda**

### Pedido só chega no admin depois de pago

Ao gerar o link, o Worker põe `status: 'aguardando_pagamento'` em
`vendas_pedidos` e `adm_solicitacoes`. Assim o Pai não vê como fila de trabalho
algo que ninguém pagou.

Quem escreve esse status é o Worker, nunca a página, e a ordem é de propósito: a
página cria o doc como `pendente` igual sempre, e ele só sai da fila **se o link
for gerado de verdade**. Checkout fora do ar → o pedido continua `pendente`, o
Pai vê normalmente e o PIX manual funciona como antes. Nenhum pedido some por
erro nosso.

Preso em `aguardando_pagamento` é carrinho abandonado: aparece numa aba própria
em Pedidos e numa seção própria em Solicitações, fora do badge e fora do total
arrecadado. Em Solicitações tem "→ Mandar pra fila" pra quando a pessoa combinou
de pagar de outro jeito.

A solicitação de consulta é de propósito: pagar não aprova. Quem aprova é o Pai,
porque a aprovação é que cria o atendimento e ocupa o horário na agenda. O que o
pagamento faz é abrir a tela de aprovação já com "já pago" marcado e o método
certo, então aprovar leva `pago_cartao` pro atendimento sem ninguém digitar nada.

---

## Self-check

Três, todos sem framework:

```bash
node worker/test-preco.mjs        # preço de produto: promo, desconto afirmativo
node worker/test-mensalidade.mjs  # vencimento por prazo, multa, isento
node worker/test-resumo.mjs       # o que a caixa de checkout mostra
```

Roda **sempre que mexer em preço**. Cada regra está escrita em dois lugares (uma
no navegador pra mostrar, uma no Worker pra cobrar), e se as duas discordarem o
cliente vê um preço e paga outro. Os testes existem pra pegar essa divergência.

---

## Limites do free tier

- **Cloudflare Workers**: 100.000 requests/dia
- **Resend**: 100 emails/dia, 3.000/mês
- **InfinitePay**: sem mensalidade; a taxa sai por transação, conforme o plano

## Segurança

- Chave do Resend e da service account ficam só no Worker, encrypted
- `/checkout` é público de propósito (a página do cliente precisa chamar), mas só
  aceita id de pedido: não tem como pedir um valor
- `/webhook` não confia no próprio corpo — confirma no `payment_check` e compara valor
- Reenvio do mesmo webhook é ignorado (dedupe por `transaction_nsu`)
- CORS está em `*`. Pra apertar, troca `ALLOW_ORIGINS` no topo do `worker.js` pela
  URL exata do admin. O `X-Auth-Secret` já protege a rota de email de qualquer jeito

Se o `ADMIN_SECRET` vazar: muda no Cloudflare e atualiza
`adm_config/email.worker_secret` no Firestore com o mesmo valor novo.

Se o JSON da service account vazar: Firebase Console → Contas de serviço →
apaga a chave antiga, gera outra, atualiza `GCP_SA_EMAIL` / `GCP_SA_KEY`.

---

## Lote de mensalidade (dia 1)

Gera um pedido de mensalidade por filho pagante do ciclo. Isento (`valor: 0` ou
campo ausente) não gera cobrança.

**Idempotente por construção**: o id do doc é `{filho_id}__{ciclo}` e a criação
usa `POST ?documentId=`, que devolve 409 se já existe. Rodar duas vezes não
duplica nem sobrescreve — e não sobrescrever importa, porque quem já pagou não
pode voltar pra `aberto`.

Dois gatilhos, uma função:

```bash
# manual (o botão do admin chama isto)
curl -X POST https://terreiro-email.hunter-soares-c.workers.dev/lote \
  -H "Content-Type: application/json" \
  -H "X-Auth-Secret: SEU_ADMIN_SECRET" \
  -d '{"ciclo":"2026-08"}'
```

Sem `ciclo`, usa o mês atual. Resposta:

```json
{ "ciclo":"2026-08", "filhos_lidos":55, "pagantes":48,
  "isentos":7, "criados":48, "existentes":0, "falhas":0 }
```

### Cron

Precisa ser configurado no painel, não sai do código: o Worker → **Settings →
Triggers → Cron Triggers → Add** → `0 9 1 * *`.

Dia 1 às 9h UTC = **6h de Brasília**. O cron da Cloudflare é sempre UTC.

### Fuso

Data e ciclo saem de `America/Sao_Paulo`, não de UTC. Das 21h de Brasília em
diante o UTC já virou o dia seguinte — sem isso a multa cairia algumas horas
antes da hora, e a promo de produto venceria um dia mais cedo.

---

## Papéis (custom claims)

Custom claim **não se põe pelo console do Firebase** — exige chamada
privilegiada. O Worker tem a service account, então tem uma rota pra isso.

```bash
# consultar os papéis de uma conta (não escreve)
curl -X POST https://terreiro-email.hunter-soares-c.workers.dev/papel \
  -H "Content-Type: application/json" -H "X-Auth-Secret: SEU_SECRET" \
  -d '{"email":"hunter.soares.c@gmail.com"}'

# gravar
... -d '{"email":"hunter.soares.c@gmail.com","papeis":["admin"]}'
... -d '{"email":"loja@terreirodocandieiro.com.br","papeis":["loja"]}'
... -d '{"email":"...","papeis":[]}'      # tira todos
```

Papéis válidos: `admin`, `financeiro`, `loja`. `admin` inclui os outros dois.

### ⚠️ O claim só vale depois de renovar a sessão

Ele entra no ID token na próxima renovação — quem já está logado precisa **sair e
entrar de novo** (ou esperar ~1h). Por isso as rules têm rede de segurança por
email: sem ela, publicar as rules novas antes de todos renovarem trancaria admin,
financeiro e PDV de uma vez.

### Ordem segura

1. Deploy do Worker (rota `/papel` passa a existir)
2. Grava `admin` nas duas contas de hoje
3. Confere com o GET (`{"email":"..."}` sem `papeis`)
4. Publica `firestore.rules.pvd`
5. Sai e entra de novo em admin, financeiro e PDV
6. Só então cria conta nova (ex: `loja`) — nunca antes do passo 4

A rede de email nas rules pode sair quando o passo 3 confirmar as duas contas.
