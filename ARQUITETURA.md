# Revisão de arquitetura — sistema do Terreiro do Candieiro

**Data**: 2026-07-30 · **Decisores**: escalabilidade · arquitetura limpa e simples ·
governança · manutenção · modelagem e hierarquia de dados

Tudo aqui é **medido**, não estimado. Onde é juízo, está marcado como juízo.

---

## O sistema hoje

| App | Repo | Domínio | Tamanho | Auth |
|---|---|---|---|---|
| Admin da casa | `terreiro-admin` | `hunterms.github.io/terreiro-admin` | 8.305 linhas, 1 arquivo | Firebase Auth |
| Site + páginas públicas | `site-candieiro` | `terreirodocandieiro.com.br` | — | nenhuma (público) |
| Área do filho | (dentro dos 2 acima) | `/area-filho.html` | 2.589 linhas | 4 dígitos do telefone |
| Financeiro | `candieiro-financeiro` | `financeiro.…` (Netlify) | 3.107 linhas, modular | Firebase Auth (desde hoje) |
| PDV | `terreiro-pdv` | `vendas.…` | 2.357 linhas, 1 arquivo | Firebase Auth (desde hoje) |
| Worker | `terreiro-admin/worker` | `…workers.dev` | 924 linhas | shared secret + service account |

**Dados**: 2 projetos Firebase, **37 collections**.

---

## 1. Governança — o problema mais grave

### 1.1 Login decorativo era o padrão, não a exceção

Três dos quatro apps guardavam senha em texto puro no JS do cliente e nunca
autenticavam no Firebase:

| App | Antes | Consequência |
|---|---|---|
| Financeiro | `USERS = {'candieiro':'terreiro2024',…}` | painéis vazios, `permission-denied` |
| PDV | `CREDENTIALS = [{user:'pai',pass:'candieiro2025'},…]` | **não gravava venda** |
| Área do filho | 4 dígitos do telefone | deliberado, e continua |

Os dois primeiros foram corrigidos em 30/07 (Firebase Auth de verdade). Ficaram
de pé enquanto as rules eram abertas; no dia em que passaram a exigir
`request.auth != null`, os dois pararam — cada um de um jeito diferente e nenhum
com erro visível pro usuário.

**A causa não é descuido, é estrutura**: não existe camada de auth compartilhada.
Cada app resolveu login sozinho, e "sozinho" virou "de mentira" em dois deles.

### 1.2 Autorização é binária

A regra que governa quase tudo:

```js
match /{document=**} { allow read, write: if request.auth != null; }
```

**Qualquer** usuário autenticado escreve **qualquer** coisa. Não há papel, não há
escopo. Hoje isso é aceitável porque só existem 2 contas (você e o Pai).

Mas o `SCHEMA.md` prevê `auth_uid` por filho e login pra eles. **No dia em que o
primeiro filho ganhar conta, ele poderá apagar a contabilidade inteira** — não
por má fé, por um clique num app que não deveria alcançar aquilo.

Isso é o maior risco do sistema, e é o de menor diff pra resolver.

### 1.3 `fin_filhos` é leitura pública

Nome e telefone de **55 pessoas**, abertos a qualquer visitante. É a base do
modelo de confiança da área do filho (busca o nome, confirma com 4 dígitos).

É uma troca consciente e documentada nas rules. Vale saber que o custo é real:
qualquer um baixa a lista de contatos da casa.

---

## 2. Modelagem de dados

### 2.1 Quatro collections de "coisa que se vende ou se guarda"

Medido: **nenhuma** delas é referenciada por mais de um app.

| Collection | Quem escreve | O que é de verdade |
|---|---|---|
| `vendas_produtos` | Admin | curso e festa, vendidos por link |
| `products` | PDV | venda de gira, na hora |
| `adm_despensa` | Admin | despensa da casa (refeita aqui) |
| `fin_estoque` | Financeiro | estoque — a versão anterior da despensa |

Duas dessas separações são **legítimas** e não devem ser mexidas: curso/festa e
venda de gira são domínios diferentes, com ciclo de vida diferente. Ter
collection separada ali é acerto, não dívida.

Os problemas são outros dois, e são reais:

**a) `adm_despensa` e `fin_estoque` são o mesmo conceito em dois lugares.** A
despensa foi refeita no admin e ficou em collection nova; o painel de estoque do
financeiro continua vivo, editável, lendo a antiga. Confirmado por contagem:
admin não toca `fin_estoque` (0 referências), financeiro não toca `adm_despensa`
(0 referências). **Dois números pro mesmo assunto, e nada avisa quando
divergem.** É a duplicação que custa hoje.

**b) Vender no PDV não baixa estoque em lugar nenhum.** `products` não referencia
`adm_despensa` nem `fin_estoque`. A baixa é mental.

E o `SCHEMA.md` descreve (b) como um fluxo que funciona: "Fluxo C — Estoque baixo
vira lista de compras", com trigger e card automático no kanban. Esse fluxo **não
existe**. Doc que descreve intenção como implementação é a pior espécie de
dívida, porque ninguém vai conferir.

### 2.2 Cinco convenções de nome, e o prefixo já mente

37 collections: `fin_` (14) · `adm_` (14) · `vendas_` (3) · `pub_` (1) ·
`pdv_` (1) · `evento_inscricoes` (1) · e **4 sem prefixo** (`sales`, `products`,
`eventos`, `eventos_caixa`).

O `SCHEMA.md` diz que o prefixo marca o dono ("`fin_*` continua sendo do
financeiro"). Isso não é mais verdade: `fin_filhos` é escrito pelo admin, pelo
financeiro e pelo Worker; `fin_pagamentos` pelo financeiro e pelo Worker;
`fin_mensalidade_pedidos` só pelo Worker.

O prefixo hoje diz **onde nasceu**, não quem manda. Não é fatal — é uma pista
falsa que custa tempo de quem chega.

### 2.3 O que a modelagem acerta

`fin_filhos` é a entidade compartilhada de verdade: os 4 apps leem, ninguém
duplicou. Foi a decisão mais importante do sistema e está certa.

E o `ciclo` + id determinístico (`{filho}__{2026-07}`) resolveu recorrência sem
inventar tabela de assinatura. Idempotência por construção, não por checagem.

---

## 3. Manutenção

### 3.1 Oito arquivos duplicados entre dois repos, sincronizados à mão

`agendar.html` · `area-filho.html` · `vendas.html` · `evento.html` ·
`reembolso.html` · `disponibilidade.html` · `checkout.js` · `pago.html`

Editam-se em `terreiro-admin`, copiam-se pra `site-candieiro` (que serve o
domínio). Hoje estão idênticos, porque foram sincronizados hoje.

**O custo já se realizou, duas vezes:**

- A produção do financeiro ficou **2 meses** atrás do próprio repo.
- `fin_reembolsos` é escrito pelo form público e **não era lido por ninguém em
  produção** desde junho: o admin não tem tela de reembolso, e a aba que existe
  no repo do financeiro nunca havia sido publicada. Todo pedido de reembolso
  ficou invisível.

Sincronia manual não falha com barulho. Falha em silêncio, e alguém descobre
meses depois.

### 3.2 Um arquivo de 8.305 linhas

O admin tem 24 rotas num único `index.html` de 456 KB. Comparação útil: o
financeiro foi fatiado em `index.html` + `js/app.js` + `css/main.css` e ficou
navegável.

**Juízo**: não é urgente. Vira urgente no dia em que duas pessoas mexerem no
admin ao mesmo tempo.

### 3.3 Rede de proteção existe só no Worker

57 asserts em 3 arquivos (`test-preco`, `test-mensalidade`, `test-resumo`), todos
escritos hoje, todos no caminho do dinheiro. É onde mais importa.

Fora dali: zero. Sem CI, sem lint, sem verificação de deploy. Duas quebras de
hoje (`initializeApp is not defined`, PDV sem auth) teriam sido pegas por
qualquer smoke test que abrisse a página.

---

## 4. Escalabilidade

Honestamente: **não é o gargalo, e não deve ser tratado como se fosse.**

- 55 filhos, ~50 pagamentos/mês, algumas centenas de vendas/mês
- Firestore free tier: 50 mil leituras/dia. O sistema usa uma fração
- Worker free: 100 mil requests/dia; o uso real são dezenas por mês

O que **não** escala não é volume, é **pessoa**: sincronizar arquivo na mão,
colar Worker no painel, publicar rules por copiar-e-colar. Cada um desses é um
passo que só uma pessoa sabe fazer.

---

## 5. Arquitetura limpa e simples

### 5.1 O que está certo e deve ser preservado

- **HTML vanilla + CDN, sem build step.** Para este tamanho, é a escolha certa.
  Zero pipeline pra quebrar, qualquer pessoa abre e edita. Não troque isso por
  framework.
- **Worker como única fronteira de confiança.** Preço, confirmação de pagamento e
  escrita privilegiada num lugar só, com teste. É a melhor parte do sistema.
- **Um arquivo por página pública.** Simples e entendível.

### 5.2 O que está torto

**Dois projetos Firebase.** Todo app inicializa os dois; o Worker precisa de
credencial dos dois (service account + chave web). O `terreiro-candieiro` guarda
5 collections de CMS (`eventos`, `slides`, `galeria`, `paideanto`, `config`).

O split cobra em toda linha de código que precisa saber em qual banco a coisa
mora. **Juízo**: hoje não paga o próprio custo, mas migrar `eventos` é arriscado
(o site público depende dele). Deixar como está e não criar collection nova lá.

**Cinco lugares onde uma mudança de deploy pode dar errado**: GitHub Pages ×3
(admin, site, PDV), Netlify ×1 (financeiro), painel do Cloudflare ×1 (Worker).
Cada um com um jeito próprio de publicar.

---

## 6. Recomendações, por razão valor/esforço

### A. Papéis nas rules — fazer primeiro

Maior risco, menor diff. Hoje qualquer conta autenticada escreve tudo.

```js
function ehAdmin() { return request.auth.token.admin == true; }
// fin_*, adm_config, vendas_produtos: só admin escreve
// leitura autenticada continua ampla — o risco é escrita
```

Custa uma custom claim nas 2 contas existentes e um punhado de linhas. Faz o
plano de dar login pro filho deixar de ser uma bomba armada.

### B. Matar a duplicação das 8 páginas

Uma fonte só. **Juízo**: `site-candieiro` é o dono natural (é quem serve o
domínio), e o `terreiro-admin` passa a linkar em vez de copiar.

Já custou dois meses de produção e reembolsos invisíveis. Não custa nada além de
decidir de quem é a página.

### C. Alinhar o `SCHEMA.md` com a realidade

Especificamente: apagar ou marcar como não-implementado o Fluxo C (estoque→
kanban) e a promessa de que o prefixo indica dono. Doc que descreve intenção como
implementação é pior que doc ausente.

### D. Um smoke test por app, no deploy

Uma linha que abre a página publicada e confirma um marcador. As duas quebras de
hoje teriam morrido em 30 segundos.

### E. Escolher UMA despensa e aposentar a outra

`adm_despensa` (nova, no admin) × `fin_estoque` (antiga, no financeiro). Não é
refactor grande: é decidir qual é a verdade e tirar a outra da tela.

**Juízo**: a do admin ganha — foi refeita depois e é onde o trabalho acontece. O
painel de Estoque do financeiro passa a ler `adm_despensa`, ou sai. Enquanto os
dois existirem editáveis, os números vão divergir sem ninguém notar.

`vendas_produtos` e `products` ficam como estão: curso/festa e venda de gira são
domínios diferentes de verdade.

Baixa automática de estoque na venda do PDV é outro assunto, maior, e só vale
depois de existir uma despensa só.

---

## 7. O que eu NÃO faria

Registrado porque o impulso natural é o contrário:

- **Framework** (React/Vue) — resolveria problema que este sistema não tem, e
  criaria build step, dependências e um jeito novo de quebrar.
- **Monorepo** — junta 4 deploys diferentes num lugar só pra ganhar o quê? A
  duplicação se resolve escolhendo dono, não movendo pasta.
- **Migrar as 37 collections pra uma hierarquia bonita** — Firestore não cobra
  por collection. Renomear é migração de dados em app que mexe com dinheiro, e o
  ganho é estético.
- **Fatiar o admin agora** — 8.305 linhas incomodam, mas o arquivo funciona e é
  mexido por uma pessoa. Fatiar no dia em que virar duas.
- **TypeScript, bundler, testes de UI** — o teste que faltava era o smoke test de
  deploy, e ele é uma linha de `curl`.

A ordem A → B → C → D resolve o que de fato machucou hoje. E, ex-C, nenhuma delas
mexe em dado nenhum.

---

# Parte II — Organização: fronteira entre apps, e por dentro de cada um

Escrito em 30/07 depois da revisão acima, a pedido: deixar cada app com sua
governança clara, e mais limpo por dentro.

## 8. Fronteira: um dono por collection

Hoje o prefixo diz onde a collection **nasceu**. A proposta é ele passar a dizer
quem **manda**: um app escreve, os outros leem.

| Domínio | Dono (escreve) | Collections |
|---|---|---|
| Pessoas e vida da casa | **Admin** | `fin_filhos`, `adm_funcoes`, `adm_escalas`, `adm_disponibilidade`, `adm_kanban`, `adm_perguntas`, `adm_respostas`, `adm_avisos`, `adm_rega_diaria`, `adm_despensa`, `eventos` |
| Agenda do Pai | **Admin** | `adm_atendimentos`, `adm_consulentes`, `adm_servicos`, `adm_solicitacoes`, `pub_slots_ocupados` |
| Venda online | **Admin** | `vendas_produtos` · (`vendas_pedidos` nasce do público) |
| Dinheiro da casa | **Financeiro** | `fin_gastos*`, `fin_dividas`, `fin_doacoes`, `fin_sonhos`, `fin_cursos*`, `fin_eventos`, `fin_reembolsos`, `fin_pagamentos` |
| Loja física | **PDV** | `products`, `sales`, `eventos_caixa`, `pdv_repasses` |
| Pagamento confirmado | **Worker** | tudo que marca pago: `pago_automatico` e afins, `fin_mensalidade_pedidos`, e o flip de `fin_pagamentos` |

Três conflitos reais pra resolver, em ordem de dano:

### 8.1 `fin_filhos` tem duas telas de cadastro

Medido: o admin grava 17 campos, o financeiro grava 6, e os dois se sobrepõem em
`tel`, `valor`, `prazo`, `obs`. Não há perda de dado (`updateDoc` não apaga o
resto), mas **quem salva por último ganha** e ninguém sabe disso.

**Feito em 30/07** (`candieiro-financeiro` 84de254): o admin é o dono da pessoa.
No financeiro o formulário de cadastro virou link pro admin, o modal de edição
virou "Mensalidade" e grava só `valor`/`prazo`/`prazoObs`, e o botão de remover
saiu (o admin já exclui). Nome, telefone e observação aparecem como contexto.

Fica o que é fluxo daquele app e não formulário duplicado: trazer aluno de curso
pra dentro da casa — a lista de alunos só existe lá.

Resultado: um campo, um lugar. `nome` e `tel` deixaram de ter dois donos.

### 8.2 `adm_despensa` × `fin_estoque` — decidido

**Decisão (sua, 30/07)**: a despensa fica no admin (`adm_despensa`). O painel de
Estoque do financeiro é a versão anterior e não é mais a verdade.

**Feito em 30/07** (`bfd8574`), e melhor do que "tirar o painel": a divisão virou
por papel. Quantidade, item, categoria e mínimo são do admin; `consumo`/mês e
`custo` unitário são do financeiro, gravados **no mesmo doc** da despensa. Isso
preservou a sugestão de compra, que seria perdida se o painel simplesmente
saísse.

Sobrou um botão "↧ Trazer do estoque antigo", que migra `consumo`/`custo` do
`fin_estoque` casando por nome sem acento, só preenchendo o que está vazio.
Depois de rodar uma vez, ele e o listener legado podem sair.

### 8.3 `fin_pagamentos` é escrito pelo financeiro e pelo Worker

Este **não é conflito** e deve ficar: os dois escrevem a mesma intenção ("este
filho pagou este mês"), um por confirmação automática e outro pela mão do Pai. É
a saída manual que decidimos preservar. Registrado aqui pra não parecer
esquecimento na próxima leitura.

## 9. As rules param de documentar e passam a impor

A tabela acima só é governança se o banco recusar o que ela proíbe. Hoje ele
aceita tudo de qualquer conta autenticada.

```js
function ehAdmin()      { return request.auth.token.admin == true; }
function ehFinanceiro() { return request.auth.token.financeiro == true || ehAdmin(); }
function ehLoja()       { return request.auth.token.loja == true || ehAdmin(); }

match /fin_gastos/{id}   { allow read: if isAuth(); allow write: if ehFinanceiro(); }
match /sales/{id}        { allow read: if isAuth(); allow write: if ehLoja(); }
match /fin_filhos/{id}   { allow write: if ehAdmin(); }   // financeiro edita mensalidade
                                                          // por tela própria, ver 8.1
```

Custa: uma custom claim por conta (são 2 hoje) e ~30 linhas de rules. Compra: o
plano de dar login pro filho deixa de ser bomba armada, e a conta da loja no
tablet não alcança a contabilidade.

**Ordem importa**: fazer isso ANTES de criar conta nova pra qualquer pessoa.

## 10. Por dentro de cada app

Ordenado por dor real, não por tamanho.

### 10.1 Admin — 8.305 linhas num arquivo

O único que dói. A boa notícia: **ele já está organizado por dentro**, só não
está separado. A sidebar tem 6 grupos e o router é um `switch` de 24 casos.

Corte que segue a estrutura que já existe, em vez de inventar uma:

```
index.html          marcação, sidebar, router
css/main.css
js/base.js          estado S, firebase, helpers, toast, modal
js/pessoas.js       filhos, funções, controle-disp, rega
js/operacao.js      kanban, calendário, escalas, despensa
js/agenda.js        atendimentos, solicitações, consulentes, serviços
js/vendas.js        produtos, pedidos
js/comunicacao.js   avisos, lembretes, perguntas, inteligência
```

Mesmo padrão que o financeiro já usa (`firebase.js` expõe no `window` e injeta o
resto), então não inventa mecanismo novo — copia um que já roda em produção.

**Quando**: no dia em que duas pessoas mexerem no admin, ou na próxima vez que
alguém precisar achar algo e não achar. Não antes: o arquivo funciona.

### 10.2 PDV — 2.357 linhas num arquivo

Não dói. Um app, uma tela, uma pessoa mexe. **Não fatiar.**

Se fatiar algum dia, o mínimo que paga: tirar o CSS pra `css/`.

### 10.3 Financeiro — já resolvido

`index.html` + `js/app.js` + `js/firebase.js` + `css/main.css`. É o modelo pros
outros. O `app.js` com 3.107 linhas é o próximo a incomodar, e o corte natural é
por painel (mensalidades, gastos, cursos, reembolsos).

### 10.4 Páginas públicas — resolvido em 30/07

**Decisão (sua)**: o **admin é a fonte**. Eu havia proposto o `site-candieiro`,
que serve o domínio, mas mover as páginas quebraria o que já está no mundo:

- QR code **impresso no terreiro** aponta pro `confirma-rega.html`, e a URL é
  gerada do `location.origin` do próprio admin
- `agendar.html`, `vendas.html` e `area-filho.html` estão cravados como link do
  domínio em vários lugares, e circulam em conversa de WhatsApp

Então o admin é dono e a cópia deixa de ser manual: **`./sync-publicas.sh`**.
Uma lista de arquivos, um comando, e `--conferir` que só diz o que está fora
sem escrever.

Não virou GitHub Action de propósito: Action entre repos precisaria de token com
escrita no outro repo, e token guardado é justamente o que já deu problema neste
sistema (dois `ghp_` em texto puro em URL de remote).

**Duas classes de página pública**, descobertas ao escrever o script — e a
distinção estava só na cabeça de quem fez:

| Classe | Onde | Quais |
|---|---|---|
| do domínio | `terreirodocandieiro.com.br` | agendar, vendas, evento, area-filho, disponibilidade, reembolso, pago, checkout.js |
| só do admin | `hunterms.github.io/terreiro-admin` | `confirma-rega.html` (QR do terreiro), `despensa.html` (gerente) |

As de baixo dão **404 no domínio**, e isso é correto, não falta de sync. Está
comentado no script pra ninguém "consertar" isso.

`checkout.js` já é o exemplo do caminho certo: um arquivo, importado por 4
páginas, com a regra de checkout num lugar só.

## 11. Ordem recomendada

1. ~~Claims + rules por dono~~ (§9) — **feito** 30/07, verificado nos 3 apps
2. ~~Uma despensa~~ (§8.2) — **feito**, com o planejamento de compra preservado
3. ~~Um cadastro de pessoa~~ (§8.1) — **feito**
4. ~~Páginas públicas com um dono~~ (§10.4) — **feito**, via `sync-publicas.sh`
5. **Fatiar o admin** (§10.1) — quando doer, não antes. Único item aberto.

Os quatro primeiros saíram num dia e nenhum tocou em dado.

### Sobrou de dívida pequena, tudo já registrado

- rede de segurança por email nas rules, que sai quando as claims estiverem
  provadas em uso
- listener de `fin_estoque` + botão de migração no financeiro, que saem depois
  de rodar uma vez
- dois tokens `ghp_` pra revogar (§11)
- `SCHEMA.md` ainda promete o Fluxo C, que não existe (§C das recomendações)
