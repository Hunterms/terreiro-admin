# App no celular e notificação — como ligar

**Data**: 2026-08-01 · o site vira app na tela de início e avisa no celular.

Duas coisas diferentes, e a ordem importa: **instalar** é o que faz o site virar
app; **notificar** só funciona depois disso no iPhone.

---

## 1. O que precisa ser feito uma vez (você, no console)

Sem estes três passos o botão de notificação aparece e diz o que falta, mas não
liga.

### 1.1. Gerar a chave VAPID

Firebase Console → projeto **terreiro-pvd** → engrenagem → *Configurações do
projeto* → aba **Cloud Messaging** → *Certificados push da Web* → **Gerar par de
chaves**.

Copie a **chave pública** e cole em `push.js` — **entre as aspas**:

```js
const VAPID = 'BEha272c…';   // ← 87 caracteres, começa com B
```

⚠️ **Sem as aspas a linha continua sendo JavaScript válido** (o `-` da chave
vira subtração entre variáveis). `node --check` passa, o deploy passa, e a
página quebra só no navegador, com `ReferenceError`. Aconteceu em 01/08. Por
isso o `smoke.sh` confere o **formato**, não a presença.

É a única coisa do push que fica no código, e pode ficar: é a chave **pública** —
é ela que o navegador manda no registro. O par privado nunca sai do Firebase.

### 1.2. Habilitar a API de envio

Google Cloud Console → projeto `terreiro-pvd` → *APIs e serviços* → *Ativar
APIs* → **Firebase Cloud Messaging API**. É a de descrição *"FCM send API that
provides a cross-platform messaging solution…"* — a que o Worker chama.

As parecidas **não** são essa:

| API | O que é | Precisa? |
|---|---|---|
| Firebase Cloud Messaging API | envio (HTTP v1) | **sim** |
| Firebase In-App Messaging API | banner dentro de app nativo | não |
| Firebase Cloud Messaging Data API | métrica de entrega | não |
| FCM Registration API | o navegador pegar o token | em geral já vem ligada |

Se o botão de ativar falhar no navegador com erro citando `fcmregistrations`,
ligue também a última.

A service account que o Worker já usa (`GCP_SA_EMAIL` / `GCP_SA_KEY`) envia com
o escopo `firebase.messaging`. **Não há chave nova pra guardar** — é a mesma que
já escreve no Firestore.

### 1.3. Trocar os crons do Worker

Cloudflare → o Worker → *Settings* → *Triggers* → **Cron Triggers**.

| antes | agora |
|---|---|
| `0 9 1 * *` · `0 12 * * *` | **`*/15 * * * *`** e mais nenhum |

Apague os dois antigos. O de 15 em 15 minutos faz os três trabalhos e decide
pelo relógio de Brasília: novidade a cada batida, digest às 9h, lote no dia 1.
Um cron só porque o teto de subrequests do Worker é *por invocação* — gatilho
separado por assunto multiplica chamada sem multiplicar teto.

E publique as rules novas (`firestore.rules.pvd`), senão o registro do aparelho
é recusado.

---

## 2. Instalar no celular

**Android (Chrome)** — abre o site, menu ⋮ → *Adicionar à tela inicial*. O
Chrome costuma oferecer sozinho depois da segunda visita.

**iPhone (Safari)** — botão *Compartilhar* → *Adicionar à Tela de Início*.
**Tem que ser o Safari**: Chrome no iOS não instala.

No iPhone a notificação **só existe depois de instalar**. Não é escolha nossa, é
da Apple. A tela sabe disso: no Safari solto ela mostra a instrução em vez de um
botão que não ia funcionar.

---

## 3. Ligar as notificações

**Admin** (`index.html`) — botão **Notificações** no rodapé do menu lateral.

**Filho** (`area-filho.html`) — cartão logo abaixo do nome, depois de entrar com
os 4 dígitos. Antes de entrar não aparece: o registro grava o `filho_id`, e sem
a prova do telefone alguém registraria o próprio celular como sendo de outra
pessoa.

É **por aparelho**, não por conta. Mesmo login em dois celulares = dois
registros, e desligar num não desliga no outro.

---

## 4. O que chega, e quando

| Aviso | Quando | Pra quem |
|---|---|---|
| Novo pedido de consulta | até 15 min depois | admin |
| Nova venda de produto | até 15 min depois | admin |
| Pedido de reembolso | até 15 min depois | admin |
| Pagamento confirmado | na hora (o webhook avisa) | admin |
| Tarefas atrasadas | 9h | admin |
| Conta fixa vence amanhã | 9h | admin |
| Contribuições vencem amanhã | 9h | admin |

O último **não manda email pra ninguém**: ele chama você pra abrir *Lembretes →
Mensalidade*, conferir a lista e aprovar. Ver `README.md`.

E ele conta certo: quem tem **baixa manual no financeiro** (dinheiro na gira,
PIX no telefone do Pai) não entra na conta nem na lista. Isso não era verdade
até 01/08 — o Worker só olhava `fin_mensalidade_pedidos` e ignorava o toggle
`fin_pagamentos/{ciclo}`, então quem já tinha pago aparecia como devendo. O
conserto está em `MENSALIDADE.md` §5, "O caminho de volta".

**Não existe disparo em massa pros filhos.** O filho recebe notificação de coisa
que é dele, e o gatilho é sempre uma ação sua — não um cron varrendo 48 pessoas.
Motivo técnico honesto: cada envio é uma subrequest, e o Worker tem teto por
invocação. Fan-out pra 48 estouraria e falharia calado.

---

## 5. Quando não chega

| Sintoma | Causa provável |
|---|---|
| Botão diz "falta a chave VAPID" | passo 1.1 |
| Botão some no iPhone | não instalou na tela de início (passo 2) |
| "Você bloqueou notificações" | ajustes do navegador → permissões do site |
| Ligou e nada chega | cron não trocado (1.3), ou API não habilitada (1.2) |
| Parou de chegar depois de semanas | token expirou — abrir o app renova sozinho |

Token morto é apagado no primeiro envio que falha, então a collection não
acumula lixo. `adm_config/push_estado` guarda o que o cron já fez: apagar esse
doc faz o próximo tick tratar tudo como novo.

**Diagnóstico rápido** — Cloudflare → o Worker → *Logs*. Cada tick imprime uma
linha com o que rodou.

---

## 6. O que ficou de fora, de propósito

- **Cache offline.** O service worker não guarda nada. Admin mostrando saldo e
  escala de ontem é pior que admin dizendo "sem internet": dado errado com cara
  de certo. Se um dia precisar, o lugar é `sw.js`, e aí é escolher item a item o
  que pode ficar velho.
- **Notificação de escala publicada pro filho.** Precisa de gatilho no salvar da
  escala, e a escala tem várias formas de ser editada. Fica pra quando o fluxo
  de publicação estiver fechado.
- **WhatsApp.** 48 filhos têm telefone, 27 têm email. O bot que já existe no
  financeiro alcançaria todos — não foi ligado aqui.
