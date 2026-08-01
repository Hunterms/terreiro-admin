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

**A área do filho conduz isso sozinha.** O cartão se desenha conforme o
aparelho, e instalar vem sempre antes de avisos:

| Situação | O que a pessoa vê |
|---|---|
| Android/desktop, com convite do navegador | um botão **Instalar** que abre o diálogo nativo |
| iPhone no Safari | 3 passos numerados, com o ícone de Compartilhar desenhado |
| iPhone em Chrome/Firefox | "abra no Safari" + botão que copia o endereço |
| já instalado | o botão de **Ativar** avisos |
| notificação bloqueada | como desfazer, em vez de um `alert` genérico |

No Android o push funcionaria **sem** instalar. Pedimos instalar mesmo assim: uma
história só pros dois sistemas é o que faz uma pessoa conseguir ajudar a outra
por telefone.

O botão de instalar do Android sai de `beforeinstallprompt`. O navegador dispara
esse evento uma vez e cedo, então `push.js` captura na carga do módulo e guarda;
o cartão se redesenha quando ele chega. O convite é de **uso único**: se a pessoa
recusar, o botão some até ela recarregar. Insistir com quem disse não é o
caminho pra ela não voltar.

No iPhone **não existe API de instalação**. Não é limitação nossa nem falta de
vontade: a Apple não expõe. Por isso ali é instrução, e por isso ela é numerada
e desenha o ícone que a pessoa vai procurar na barra.

E no iPhone a notificação **só existe depois de instalar**. Chrome no iOS é o
Safari por dentro, mas sem o menu de instalar — daí o estado próprio pra ele.

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
| Filho remarcou a contribuição | na hora | admin |
| Filho pediu isenção do mês | na hora | admin |
| **Consulta começa em ~1h** | 45 a 75 min antes | admin |
| Consultas de hoje | 9h | admin |
| Tarefas atrasadas | 9h | admin |
| Conta fixa vence amanhã | 9h | admin |
| Contribuições vencem amanhã | 9h | admin |
| **Aviso novo no mural** | quando você marca a caixa ao publicar | filhos |

O último **não manda email pra ninguém**: ele chama você pra abrir *Lembretes →
Mensalidade*, conferir a lista e aprovar. Ver `README.md`.

E ele conta certo: quem tem **baixa manual no financeiro** (dinheiro na gira,
PIX no telefone do Pai) não entra na conta nem na lista. Isso não era verdade
até 01/08 — o Worker só olhava `fin_mensalidade_pedidos` e ignorava o toggle
`fin_pagamentos/{ciclo}`, então quem já tinha pago aparecia como devendo. O
conserto está em `MENSALIDADE.md` §5, "O caminho de volta".

**O único disparo pra casa inteira é o aviso do mural, e ele é fila.** Você marca
"avisar no celular dos filhos" ao publicar em Avisos. O cron manda **15
aparelhos por batida** e devolve o resto pra fila, então a casa inteira leva uns
30 minutos. O modal de edição mostra quantos já saíram e quantos faltam.

Fila, e não laço, pelo motivo de sempre aqui: cada envio é uma subrequest e o
Worker tem teto **por invocação**. Um laço em 48 estouraria no meio e falharia
calado — metade recebe, metade não, e ninguém sabe qual metade.

Fora esse, o filho só recebe notificação de coisa que é dele, e o gatilho é
sempre uma ação sua.

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

## 5.1 O email saiu do jogo (01/08/2026)

Decisão do Pai: **aviso não vai mais por email**. Tudo por push, com a caixa de
avisos na área do filho como registro.

O que isso mudou:

- A área do filho **parou de pedir email**. Instalar o app e receber
  notificação não precisa de email nenhum, então coletar um dado que não se usa
  é só atrito. Quem já tem continua com ele no cadastro, e o admin continua
  podendo escrever.
- O lembrete de mensalidade passou a **empurrar push** junto do email. Antes
  não empurrava, porque dois toques pelo mesmo assunto ensinam a ignorar os
  dois — com o email fora, sobrou o push.
- A caixa de avisos deixou de ser rede e virou **o chão**. Ela é o único canal
  que alcança quem não instalou: 31 dos 56 não têm email, e o push depende de
  instalação (no iPhone, obrigatoriamente).

**Decidido no mesmo dia**: o `/lembretes` também. Toda notificação é push, sem
exceção. O lembrete de contribuição parou de mandar email e passou a empurrar
push mais o registro na caixa de avisos.

O que isso troca, dito sem maquiagem:

| | antes | agora |
|---|---|---|
| alcance imediato | 29 por email | quem instalou o app |
| alcance garantido | ninguém | os 56, ao abrir a área |
| quem ficava de fora | 27 sem email | ninguém |

O email chegava sozinho na caixa de quem tem; o push só chega em quem instalou.
Então **no curto prazo o alcance imediato cai**, e sobe conforme a casa instala.
A caixa de avisos é o que segura o piso: ela não depende de entrega nenhuma.

Por isso a tela de Lembretes do admin passou a mostrar **"sem app instalado"** em
vez de "sem email" — é essa a informação que decide se a pessoa vai ser tocada
hoje. E a resposta de cada envio traz `push`, com quantos aparelhos foram
alcançados de fato, pra tela não fingir que chegou em todo mundo.

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
