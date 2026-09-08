#!/usr/bin/env bash
#
# Confere que o que está NO AR carrega e é a versão nova. Roda depois de
# qualquer deploy.
#
#   ./smoke.sh          confere tudo
#   ./smoke.sh admin    confere só um
#
# ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
# Em 30/07 duas coisas quebraram em produção e nenhuma deu sinal:
#
#   financeiro  ReferenceError na carga (initializeApp como global num script
#               clássico) — página em branco, descoberto por acaso
#   PDV         login decorativo sem Firebase Auth — não gravava venda, e o
#               erro só aparecia no console de quem estivesse olhando
#
# Os dois teriam morrido aqui. O teste não é de comportamento: é "o arquivo que
# está no ar é o que eu acabei de subir, e ele referencia o que deveria".
# Barato, e pega a classe de erro que mais custou.

set -uo pipefail

falhas=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
erro() { printf '  \033[31m✗\033[0m %s\n' "$1"; falhas=$((falhas+1)); }

# busca com cache-bust: o Varnish do GitHub Pages serve versão velha por minutos
pega() { curl -s "$1?cb=$(date +%s)"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1?cb=$(date +%s)"; }

# checa(url, "descrição", marcador-que-precisa-existir)
#
# O corpo é guardado numa variável antes do grep, e não canalizado. Motivo achado
# na primeira execução: `curl | grep -q` faz o grep sair no primeiro match, o
# curl morre com SIGPIPE, e com `pipefail` isso conta como falha do pipeline.
# Só os arquivos grandes falhavam (o admin tem 456KB) — os pequenos terminavam
# antes do grep sair. Falso negativo dos bons: parecia deploy velho.
#
# E o grep leva `--` porque marcador pode começar com hífen (ex: `--bg` no CSS).
checa() {
  local url="$1" desc="$2" marcador="$3"
  local code; code=$(http "$url")
  if [[ "$code" != "200" ]]; then erro "$desc — HTTP $code"; return; fi
  if [[ -n "$marcador" ]]; then
    local corpo; corpo=$(pega "$url")
    if ! grep -q -- "$marcador" <<< "$corpo"; then
      erro "$desc — abriu, mas não achei '$marcador' (versão velha no ar?)"
      return
    fi
  fi
  ok "$desc"
}

alvo="${1:-tudo}"

if [[ "$alvo" == "tudo" || "$alvo" == "admin" ]]; then
  echo "ADMIN"
  checa https://hunterms.github.io/terreiro-admin/index.html "carrega" "renderRoute"
  checa https://hunterms.github.io/terreiro-admin/css/main.css "css separado" "--bg"
  # O admin passou a importar email-textos.js. Import que dá 404 não deixa a
  # página "sem email": derruba o módulo inteiro e ela abre em branco.
  checa https://hunterms.github.io/terreiro-admin/email-textos.js "textos de email" "_buildEmailConfirmacaoHTML"
  # A página de Links é a única lista de endereços do sistema. Se um link
  # apodrecer, ninguém descobre até precisar dele.
  checa https://hunterms.github.io/terreiro-admin/index.html "página de links" "renderLinks"
  # Adesão: quem instalou o app e quem viu o aviso. As duas contas leem
  # collections novas pro admin (adm_push_tokens, adm_avisos_lidos) — se a
  # versão no ar for velha, os cartões simplesmente não existem e ninguém nota.
  checa https://hunterms.github.io/terreiro-admin/index.html "adesão ao app" "cartaoAdesao"
  checa https://hunterms.github.io/terreiro-admin/index.html "leitura dos avisos" "quemViuOAviso"
  checa https://hunterms.github.io/terreiro-admin/confirma-rega.html "QR da rega" ""
  checa https://hunterms.github.io/terreiro-admin/despensa.html "despensa" ""
  # PWA: sem service worker no ar não há instalação nem notificação, e a página
  # continua abrindo normalmente — falha que não dá sinal nenhum.
  checa https://hunterms.github.io/terreiro-admin/sw.js "service worker" "notificationclick"
  checa https://hunterms.github.io/terreiro-admin/push.js "registro de push" "adm_push_tokens"
  checa https://hunterms.github.io/terreiro-admin/manifest.json "manifest do admin" "standalone"
  checa https://hunterms.github.io/terreiro-admin/manifest-filho.json "manifest do filho" "standalone"
  # A VAPID tem que estar lá E entre aspas. Sem aspas a linha continua sendo
  # JavaScript válido (vira subtração de variáveis), então `node --check` passa,
  # o deploy passa, e a página só quebra no navegador com ReferenceError.
  # Aconteceu em 01/08 — daí a checagem ser do FORMATO, não da presença.
  corpo=$(pega https://hunterms.github.io/terreiro-admin/push.js)
  if grep -qE "^const VAPID = '[A-Za-z0-9_-]{80,100}';" <<< "$corpo"; then
    ok "chave VAPID no formato certo"
  elif grep -q 'COLE_AQUI_A_CHAVE_PUBLICA_VAPID' <<< "$corpo"; then
    erro "push.js sem a chave VAPID — notificação não liga (ver PUSH.md §1.1)"
  else
    erro "VAPID em push.js fora do formato — faltou aspas? a página quebra na carga"
  fi
fi

if [[ "$alvo" == "tudo" || "$alvo" == "site" ]]; then
  echo "SITE E PÁGINAS PÚBLICAS"
  checa https://terreirodocandieiro.com.br/ "site" ""
  checa https://terreirodocandieiro.com.br/agendar.html "agendar" "checkout.js"
  checa https://terreirodocandieiro.com.br/vendas.html "vendas" "checkout.js"
  checa https://terreirodocandieiro.com.br/evento.html "evento" "checkout.js"
  checa https://terreirodocandieiro.com.br/area-filho.html "área do filho" "dash-sec-mensalidade"
  checa https://terreirodocandieiro.com.br/pago.html "retorno do pagamento" "telaPago"
  checa https://terreirodocandieiro.com.br/checkout.js "checkout.js" "Resumo do pedido"
  # A área do filho faz `import "./push.js"`. Import que dá 404 não deixa a
  # página "sem notificação" — derruba o módulo inteiro e ela abre em branco.
  checa https://terreirodocandieiro.com.br/push.js "push.js no domínio" "adm_push_tokens"
  # Mesmo motivo: a área do filho importa `filhos.js`, e é ele que manda o `pwa`
  # que alimenta a contagem de quem instalou.
  checa https://terreirodocandieiro.com.br/filhos.js "filhos.js no domínio" "pwa"
  checa https://terreirodocandieiro.com.br/sw.js "sw.js no domínio" "notificationclick"
fi

if [[ "$alvo" == "tudo" || "$alvo" == "financeiro" ]]; then
  echo "FINANCEIRO"
  checa https://financeiro.terreirodocandieiro.com.br/ "carrega" "login-screen"
  # o bug de 30/07: app.js declarava Firebase como se fosse global
  checa https://financeiro.terreirodocandieiro.com.br/js/app.js "app.js" "ouvirMensPedidos"
  checa https://financeiro.terreirodocandieiro.com.br/js/firebase.js "auth de verdade" "signInWithEmailAndPassword"
  # Eram 22 onSnapshot sem tratamento: leitura que falha deixava o total em
  # R$ 0,00 e parecia mês sem gasto. O embrulho mora no firebase.js, então
  # nenhuma das 22 chamadas precisa saber — e é por isso que ele pode sumir
  # sem ninguém notar.
  checa https://financeiro.terreirodocandieiro.com.br/js/firebase.js "leitura que falha avisa" "_falhaDeLeitura"
  # E autenticado não é autorizado: a tela abria pra qualquer conta do
  # terreiro-pvd, e as rules deixam quem tem login LER tudo.
  checa https://financeiro.terreirodocandieiro.com.br/js/firebase.js "conta sem papel não abre" "podeVerOFinanceiro"
  corpo=$(pega https://financeiro.terreirodocandieiro.com.br/js/app.js)
  if grep -qE '^const app = initializeApp' <<< "$corpo"; then
    erro "app.js voltou a chamar initializeApp como global — quebra na carga"
  else
    ok "sem initializeApp solto no app.js"
  fi
fi

if [[ "$alvo" == "tudo" || "$alvo" == "pdv" ]]; then
  echo "PDV"
  checa https://vendas.terreirodocandieiro.com.br/ "carrega com auth" "signInWithEmailAndPassword"
  # Procura a DECLARAÇÃO e as senhas, não a palavra: o arquivo tem um comentário
  # explicando que o array CREDENTIALS saiu, e buscar só o nome dava falso
  # positivo contra a própria documentação.
  corpo=$(pega https://vendas.terreirodocandieiro.com.br/)
  if grep -qE 'const CREDENTIALS *=|candieiro2025|pdv2025' <<< "$corpo"; then
    erro "PDV voltou a ter senha no JS — não grava venda com as rules atuais"
  else
    ok "sem senha no JS"
  fi
fi

if [[ "$alvo" == "tudo" || "$alvo" == "worker" ]]; then
  echo "WORKER"
  W=https://terreiro-email.hunter-soares-c.workers.dev
  # pedido inexistente: 404 prova que a rota existe, o handle está setado e a
  # service account falou com o Firestore
  r=$(curl -s -X POST "$W/checkout" -H 'Content-Type: application/json' -d '{"tipo":"ped","doc_id":"smokeTest000"}')
  echo "$r" | grep -q 'não encontrado' && ok "checkout + Firestore + handle" || erro "checkout: $r"
  r=$(curl -s -X POST "$W/status" -H 'Content-Type: application/json' -d '{"tipo":"ped","doc_id":"smokeTest000"}')
  echo "$r" | grep -q 'não encontrado' && ok "status" || erro "status: $r"
  r=$(curl -s -X POST "$W/mensalidade" -H 'Content-Type: application/json' -d '{"filho_id":"@@@"}')
  echo "$r" | grep -q 'inválido' && ok "mensalidade" || erro "mensalidade: $r"
  r=$(curl -s -X POST "$W/papel" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'X-Auth-Secret' && ok "papel (protegida)" || erro "papel: $r"
  # As duas rotas novas: existem e estão protegidas. Sem segredo elas não podem
  # responder outra coisa — /lembretes manda email e /push manda notificação.
  r=$(curl -s -X POST "$W/lembretes" -H 'Content-Type: application/json' -d '{"dry":true}')
  echo "$r" | grep -q 'X-Auth-Secret' && ok "lembretes (protegida)" || erro "lembretes: $r"
  r=$(curl -s -X POST "$W/push" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'X-Auth-Secret' && ok "push (protegida)" || erro "push: $r"

  # O elenco é público de propósito (é o seletor de nomes), mas NÃO pode levar
  # os campos privados junto. Esta é a checagem que segura a correção de 01/08
  # de pé: se alguém tirar um campo da lista negra do Worker, o telefone volta a
  # sair pra internet inteira, e nada mais reclamaria.
  r=$(curl -s -X POST "$W/filhos" -H 'Content-Type: application/json' -d '{}')
  if ! grep -q '"filhos"' <<< "$r"; then
    erro "filhos: $(head -c 120 <<< "$r")"
  elif grep -qE '"(tel|pin|auth_email|obs|valor)"' <<< "$r"; then
    erro "VAZAMENTO: /filhos devolveu campo privado — ver CAMPOS_PRIVADOS no worker.js"
  else
    ok "elenco público sem telefone, valor, email nem obs"
  fi

  # E a prova tem que ser conferida do lado de lá. 403 num palpite errado prova
  # que a rota existe e que ela nega — antes isto era um `if` no navegador.
  r=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$W/entrar" \
        -H 'Content-Type: application/json' -d '{"filho_id":"smokeTest000","tel4":"0000"}')
  [[ "$r" == "404" || "$r" == "403" ]] && ok "entrar confere no servidor" || erro "entrar: HTTP $r"

  # Sessão forjada não pode passar. Se um dia a assinatura deixar de ser
  # conferida, TODA rota do filho vira porta aberta — e nada mais avisaria.
  r=$(curl -s -X POST "$W/mensalidade" -H 'Content-Type: application/json' \
        -d '{"sessao":"eyJmIjoiZmFsc28iLCJlIjo5OTk5OTk5OTk5fQ.assinaturaInventada"}')
  echo "$r" | grep -qE 'inválido|não confere|não encontrado' \
    && ok "sessão forjada é recusada" || erro "SESSÃO FORJADA ACEITA: $(head -c 120 <<< "$r")"

  # Zerar PIN é do admin, e só. Sem segredo não pode nem tentar.
  # ⚠️ Rota que NÃO EXISTE cai no /email, que pede o mesmo header — então este
  # teste sozinho dá verde num Worker velho. A checagem de existência é a de
  # baixo: /criar-pin sem PIN responde uma mensagem que só ela sabe dizer.
  # A agenda pública não pode devolver o que é de dentro. Se um tipo interno
  # escapar daqui, ele vai parar na home do site.
  r=$(curl -s -X POST "$W/agenda" -H 'Content-Type: application/json' -d '{}')
  if ! grep -q '"eventos"' <<< "$r"; then
    erro "agenda: $(head -c 120 <<< "$r")"
  elif grep -q '"eventos":\[\]' <<< "$r"; then
    erro "agenda VAZIA — o site perdeu o calendário. Service account alcança o terreiro-candieiro?"
  elif grep -qE '"tipo":"(desenvolvimento|gira_fechada|trabalho_interno|obrigacao_coletiva|reuniao|mutirao|ensaio_curimba)"' <<< "$r"; then
    erro "VAZAMENTO: a agenda pública devolveu atividade interna"
  elif grep -q '"nome_publico"' <<< "$r"; then
    erro "VAZAMENTO: a agenda pública devolveu o nome INTERNO junto do público"
  else
    ok "agenda pública sem os trabalhos de dentro"
  fi
  # O pedido de reembolso passou a exigir sessão. Sem ela, filho_id inválido.
  r=$(curl -s -X POST "$W/reembolso" -H 'Content-Type: application/json' -d '{"descricao":"x","valor":10}')
  echo "$r" | grep -q 'inválido' && ok "reembolso exige sessão" || erro "reembolso: $(head -c 90 <<< "$r")"
  # Liberar dia de rega passou a ser ato do Worker. Antes o delete ia direto pro
  # Firestore, com a regra aberta: o PIN era conferido e não autorizava nada.
  # Se esta rota sumir, a área do filho volta a não conseguir liberar — e a
  # regra fechada faz a falha aparecer, que é o que se quer.
  # A tela do evento pergunta "esta pessoa já está inscrita?" por aqui. A rota
  # só pode devolver id, filho_id e status — nome, telefone e valor ficam de
  # dentro. Se um deles voltar, a inscrição vira lista pública de novo.
  r=$(curl -s -X POST "$W/inscricoes-do-evento" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'evento_id inválido' && ok "inscricoes-do-evento no ar" || erro "inscricoes-do-evento: Worker velho? $(head -c 100 <<< "$r")"
  r=$(curl -s -X POST "$W/inscricoes-do-evento" -H 'Content-Type: application/json' -d '{"evento_id":"smokeTest000"}')
  if ! grep -q '"inscricoes"' <<< "$r"; then
    erro "inscricoes-do-evento: $(head -c 120 <<< "$r")"
  elif grep -qE '"(nome|tel|email|valor)"' <<< "$r"; then
    erro "VAZAMENTO: /inscricoes-do-evento devolveu campo de pessoa"
  else
    ok "inscricoes-do-evento sem nome nem telefone"
  fi
  r=$(curl -s -X POST "$W/liberar-rega" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'data inválida' && ok "liberar-rega no ar" || erro "liberar-rega: Worker velho? $(head -c 100 <<< "$r")"
  # E ela não pode apagar sem prova de quem é o dia.
  r=$(curl -s -X POST "$W/liberar-rega" -H 'Content-Type: application/json' -d '{"data":"2099-12-31"}')
  echo "$r" | grep -q 'inválido' && ok "liberar-rega exige sessão" || erro "liberar-rega SEM PROVA: $(head -c 120 <<< "$r")"
  r=$(curl -s -X POST "$W/avisar-filho" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'X-Auth-Secret' && ok "avisar-filho (protegida)" || erro "avisar-filho: $r"
  r=$(curl -s -X POST "$W/zerar-pin" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'X-Auth-Secret' && ok "zerar-pin (protegida)" || erro "zerar-pin: $r"
  # O caixa da lojinha passou a abrir e fechar pelo cron. Não dá pra testar o
  # cron por fora, mas dá pra provar que o Worker no ar CONHECE a regra: a
  # constante da hora de fechar aparece na resposta de erro? Não. Então o que
  # se testa é a rota que compartilha o mesmo deploy.
  # Consentimento: sem versão, a rota tem que recusar antes de tocar em nada.
  # Se ela passar a aceitar vazio, o aceite vira registro sem o que foi aceito
  # — que é o mesmo que não ter aceite, mas com aparência de ter.
  r=$(curl -s -X POST "$W/aceitar-termo" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'versao do termo inválida' && ok "aceitar-termo no ar" || erro "aceitar-termo: Worker velho? $(head -c 100 <<< "$r")"
  r=$(curl -s -X POST "$W/aceitar-termo" -H 'Content-Type: application/json' -d '{"versao":"v1","filho_id":"naoexiste"}')
  echo "$r" | grep -qE 'não encontrado|inválido' && ok "aceitar-termo exige prova" || erro "aceitar-termo SEM PROVA: $(head -c 120 <<< "$r")"

  r=$(curl -s -X POST "$W/criar-pin" -H 'Content-Type: application/json' -d '{"filho_id":"smokeTest000","pin":"12"}')
  echo "$r" | grep -q 'PIN tem 4' && ok "criar-pin no ar" || erro "criar-pin: Worker velho? $(head -c 100 <<< "$r")"
fi

if [[ "$alvo" == "tudo" || "$alvo" == "calado" ]]; then
  echo "FALHA CALADA"
  # A classe de bug que mais custou aqui: erro que a tela desenha como VAZIO.
  # Em 01/08 eram 48 onSnapshot e UM com tratamento. O conserto foi embrulhar o
  # onSnapshot em cada superfície — esta checagem é o que impede alguém desfazer
  # o embrulho sem perceber que está reabrindo os 47.
  for par in "index.html:_onSnapshotOriginal" "despensa.html:_onSnapshotOriginal" \
             "area-filho.html:avisarFalha" "filhos.js:avisarFalha" \
             "area-filho.html:pintarAcesso"; do
    arq="${par%%:*}"; marca="${par##*:}"
    if grep -q "$marca" "$(dirname "$0")/$arq" 2>/dev/null; then
      ok "$arq protege leitura que falha"
    else
      erro "$arq PERDEU o tratamento de erro de leitura — 47 falhas caladas de volta"
    fi
  done
fi

if [[ "$alvo" == "tudo" || "$alvo" == "fora" ]]; then
  echo "TEXTO DE FORA"
  # As páginas trust-based existem porque estas collections aceitam escrita SEM
  # login: adm_disponibilidade, adm_rega_diaria e fin_reembolsos. É de propósito
  # — é o que faz a área do filho funcionar sem conta. O preço é que o texto que
  # sai delas foi escrito por qualquer um com a chave pública do projeto, que
  # está no JS de todo mundo.
  #
  # E ele é desenhado em TELA LOGADA: o admin e o financeiro. Um `obs` de
  # disponibilidade com `<img onerror=...>` rodava no navegador de quem tem
  # sessão de admin. Achado em 07/09; o conserto foi escapar no ponto de
  # desenho, e estas linhas são o que impede alguém desfazer sem perceber.
  for par in "area-filho.html:escapaHtml(disp.obs" \
             "area-filho.html:escapaHtml(reserva.filho_nome" \
             "index.html:escapaHtml(disp.obs" \
             "index.html:escapaHtml(reserva.filho_nome" \
             "index.html:escapaHtml(reservaHoje.filho_nome" \
             "index.html:escapaHtml(s.observacao" \
             "index.html:escapaHtml(p.observacao" \
             "index.html:escapaHtml(insc.nome" \
             "index.html:escapaHtml(p.obs" \
             "index.html:escapaJs(" \
             "index.html:escapaHtml(p.turma_nome" \
             "index.html:escapaHtml(d.genero_outro" \
             "index.html:urlSegura(d.pagamento_recibo_url" \
             "index.html:urlSegura(d.instagram" \
             "despensa.html:escapaHtml(p.nome" \
             "despensa.html:escapaHtml(p.obs" \
             "despensa.html:escapaJs(p.id" \
             "confirma-rega.html:escapaHtml(APP.regaHoje.filho_nome" \
             "evento.html:inscricoesDoEvento"; do
    arq="${par%%:*}"; marca="${par#*:}"
    if grep -qF -- "$marca" "$(dirname "$0")/$arq" 2>/dev/null; then
      ok "$arq escapa o que veio de fora"
    else
      erro "$arq PAROU de escapar '$marca' — texto de estranho volta a rodar em tela logada"
    fi
  done

  # `_highlight` fabrica HTML: parte o nome em três e enfia <mark> no meio.
  # Existe uma cópia em cada página com seletor de nome, e o retorno vai
  # inteiro pra innerHTML. Quem escapar o CHAMADOR e não o helper escapa o
  # <mark> junto e a marca some da tela — por isso o escape mora aqui dentro,
  # e por isso as quatro cópias precisam continuar iguais.
  for arq in index.html despensa.html vendas.html evento.html area-filho.html; do
    [[ -f "$(dirname "$0")/$arq" ]] || continue
    grep -q '_highlight' "$(dirname "$0")/$arq" || continue
    if grep -q 'escapaHtml(nome.slice' "$(dirname "$0")/$arq"; then
      ok "$arq: _highlight escapa as três fatias do nome"
    else
      erro "$arq: _highlight devolve nome CRU pra innerHTML"
    fi
  done

  # urlSegura não é enfeite do escapaHtml: `javascript:alert(1)` passa inteiro
  # pelo escape de entidade e roda no clique. O @ do Instagram e o link do
  # recibo vêm de doc que qualquer um cria.
  {
    grep -m1 '^const urlSegura' "$(dirname "$0")/index.html"
    cat <<'EOF'
let mau = 0;
for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '  javascript:x']) {
  if (urlSegura(u) !== '') mau++;
}
for (const u of ['https://instagram.com/fulano', 'http://x.com/y']) {
  if (urlSegura(u) !== u) mau++;
}
process.exit(mau ? 1 : 0);
EOF
  } > /tmp/smoke-url.$$.mjs
  if node /tmp/smoke-url.$$.mjs 2>/dev/null; then
    ok "urlSegura barra javascript: e deixa http(s) passar (7 casos)"
  else
    erro "urlSegura deixa passar esquema perigoso — href de doc público vira clique que roda JS"
  fi
  rm -f /tmp/smoke-url.$$.mjs

  # O financeiro mora em outro repo. Se ele não estiver ao lado, isto avisa em
  # vez de calar — a checagem que não roda é indistinguível da que passou.
  FIN="$HOME/Desktop/Docs/candieiro-financeiro/js/app.js"
  if [[ ! -f "$FIN" ]]; then
    erro "não achei $FIN — a aba de Reembolsos não foi conferida"
  else
    for marca in 'esc(r.descricao' 'esc(g.nome)' 'esc(d.obs)' 'escJs(g.nome)'; do
      grep -qF -- "$marca" "$FIN" \
        && ok "financeiro escapa $marca" \
        || erro "financeiro PAROU de escapar '$marca'"
    done
    # O reembolso do filho vira gasto avulso com a descrição dele dentro
    # (aprovarReembolso). Se o gasto avulso deixar de escapar, o texto volta
    # pela porta de trás.
    grep -qF -- "askDel('fin_gastos_avulso','\${g.id}','\${escJs(g.nome)}')" "$FIN" \
      && ok "gasto avulso vindo de reembolso escapado" \
      || erro "gasto avulso PAROU de escapar — a descrição do filho volta crua"

    # escJs não é o esc: dentro de onclick="..." o navegador desfaz a entidade
    # ANTES de rodar o JS, então `&#39;` voltaria a ser aspa e fecharia a
    # string. A ordem certa é escapar pro JS primeiro e só depois a aspa dupla.
    # Ordem errada passa no olho e falha aqui.
    {
      sed -n '/^const esc = /,/^));$/p' "$FIN"
      grep -m1 '^const escJs' "$FIN"
      grep -m1 '^const escapaJs' "$(dirname "$0")/index.html" | sed 's/^const escapaJs/const escJs2/'
      cat <<'EOF'
const decode = s => s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'");
let mau = 0;
for (const c of ['Fulano', "O'Brien", 'a"b', 'x<img src=q onerror=alert(1)>', 'c\\d', "\\'", '"><script>alert(1)</script>']) {
  const attr = "askDel('" + escJs(c) + "')";
  if (attr.includes('"')) { mau++; continue; }
  let visto = null;
  try { (new Function('askDel', decode(attr)))(v => visto = v); } catch { mau++; continue; }
  if (visto !== c) mau++;
}
if (/[<>"']/.test(esc('<img onerror="x">'))) mau++;
// o admin tem o par dele, e ele tem que se comportar igual
for (const c of ["O'Brien", 'a"b', 'c\\d']) {
  const attr = "f('" + escJs2(c) + "')";
  if (attr.includes('"')) { mau++; continue; }
  let visto = null;
  try { (new Function('f', decode(attr)))(v => visto = v); } catch { mau++; continue; }
  if (visto !== c) mau++;
}
process.exit(mau ? 1 : 0);
EOF
    } > /tmp/smoke-escape.$$.mjs
    if node /tmp/smoke-escape.$$.mjs 2>/dev/null; then
      ok "escJs sobrevive ao decode do atributo (7 casos)"
    else
      erro "escJs deixa passar — nome ou id de reembolso fecha o onclick"
    fi
    rm -f /tmp/smoke-escape.$$.mjs
  fi
fi

if [[ "$alvo" == "tudo" || "$alvo" == "dados" ]]; then
  echo "DADOS (export)"
  # O CSV existe em DUAS cópias — index.html e o app.js do financeiro — porque
  # são repos separados e nenhum importa do outro. Cópia que diverge é o modo
  # normal de morrer: alguém conserta uma e a outra segue exportando torto por
  # meses, sem erro nenhum na tela.
  #
  # Este teste não confere "passa nos casos": confere que as duas dão a MESMA
  # saída pros mesmos casos. Se divergirem, ele diz qual caso.
  FIN="$HOME/Desktop/Docs/candieiro-financeiro/js/app.js"
  if [[ ! -f "$FIN" ]]; then
    erro "não achei $FIN — as duas cópias do CSV não foram comparadas"
  else
    {
      # admin: _celulaCSV / _paraCSV
      awk '/^const _SEP = /{d=1} /^function _baixarArquivo/{d=0} d' "$(dirname "$0")/index.html"
      echo 'const A = { celula: _celulaCSV, csv: _paraCSV };'
      # financeiro: _celula / _paraCSV (mesmos nomes de arquivo, escopo novo)
      echo 'const F = (() => {'
      awk '/^const SEP = /{d=1} /^function _baixar\(/{d=0} d' "$FIN"
      echo 'return { celula: _celula, csv: _paraCSV }; })();'
      cat <<'EOF'
const casos = [null, undefined, 0, false, '', 'Vela', 'a;b', 'diz "oi"', 'quebra\nlinha',
               { a: 1 }, new Date('2026-09-08T13:00:00Z'), { toDate: () => new Date('2026-01-02T03:04:05Z') }];
let mau = [];
for (const c of casos) {
  const a = A.celula(c), f = F.celula(c);
  if (a !== f) mau.push(`celula(${JSON.stringify(c)}): admin=${a} financeiro=${f}`);
}
const linhas = [{ nome:'Vela', valor:10 }, { nome:'Erva', valor:4, obs:'no; centro' }, { valor:7 }];
if (A.csv(linhas) !== F.csv(linhas)) mau.push('paraCSV: as duas cópias montam arquivos diferentes');
// e o arquivo tem que estar certo, não só igual dos dois lados
const l = A.csv(linhas).split('\r\n');
if (!l[0].startsWith('\ufeff')) mau.push('sem BOM — Excel pt-BR quebra o acento');
if (l[0] !== '\ufeffnome;valor;obs') mau.push('cabeçalho não é a união das chaves: ' + l[0]);
if (l[3] !== ';7;') mau.push('linha sem a 1ª chave desalinha: ' + l[3]);
if (mau.length) { console.error(mau.join('\n')); process.exit(1); }
EOF
    } > /tmp/smoke-csv.$$.mjs
    if node /tmp/smoke-csv.$$.mjs 2>/tmp/smoke-csv.$$.err; then
      ok "CSV: admin e financeiro dão a mesma saída (12 casos + o arquivo)"
    else
      erro "CSV divergiu: $(head -2 /tmp/smoke-csv.$$.err | tr '\n' ' ')"
    fi
    rm -f /tmp/smoke-csv.$$.mjs /tmp/smoke-csv.$$.err
  fi

  # A contagem de rastro aparece imediatamente antes de um botão que apaga.
  # Contar de menos faz a tela prometer 3 e sumir com 9 — e o dossiê que baixa
  # junto sai incompleto, que é o que sobra depois.
  (cd "$(dirname "$0")" && node test-expurgo.mjs >/dev/null 2>&1) \
    && ok "test-expurgo.mjs passa (contagem antes de apagar)" \
    || erro "test-expurgo.mjs FALHOU — a prévia do expurgo não confere"

  # O texto da tela diz "os oito lugares onde o filho_id mora". Se alguém
  # acrescentar uma nona collection e esquecer da frase, a tela mente sobre o
  # que apagou. O teste trava o número; esta linha trava a frase.
  grep -qF 'os oito lugares onde o' "$(dirname "$0")/index.html" \
    && ok "a tela e o mapa de rastros contam a mesma história" \
    || erro "o texto da retenção mudou — confere se ainda são 8 collections"

  # O PDV: a conta da gaveta e a devolução de estoque no estorno.
  PDV="$HOME/Desktop/Docs/terreiro-pdv"
  if [[ -f "$PDV/test-caixa.mjs" ]]; then
    (cd "$PDV" && node test-caixa.mjs >/dev/null 2>&1) \
      && ok "test-caixa.mjs do PDV passa (gaveta + devolução)" \
      || erro "test-caixa.mjs do PDV FALHOU"
  else
    erro "não achei o test-caixa.mjs do PDV"
  fi

  # Venda estornada tem que sair das somas nos DOIS apps, e sair no ponto de
  # carga — não em cada `reduce`. São 5 leitores no PDV e 8 no financeiro; o
  # dia em que alguém filtrar caso a caso, o décimo quarto leitor vai somar
  # venda cancelada e ninguém vai ver.
  for par in "PDV|$PDV/index.html" \
             "financeiro|$HOME/Desktop/Docs/candieiro-financeiro/js/app.js"; do
    quem="${par%%|*}"; arq="${par#*|}"
    if grep -qF -- 'S.sales = todas.filter(v => !v.cancelada)' "$arq" 2>/dev/null; then
      ok "$quem: estorno filtrado na carga"
    else
      erro "$quem: venda estornada VOLTOU pro faturamento"
    fi
  done

  # O teste do financeiro roda no repo dele; aqui só se confere que ele existe
  # e passa, senão "não rodei" vira indistinguível de "passou".
  T="$HOME/Desktop/Docs/candieiro-financeiro/test-export.mjs"
  if [[ -f "$T" ]]; then
    (cd "$(dirname "$T")" && node test-export.mjs >/dev/null 2>&1) \
      && ok "test-export.mjs do financeiro passa" || erro "test-export.mjs do financeiro FALHOU"
  else
    erro "não achei o test-export.mjs do financeiro"
  fi
fi

if [[ "$alvo" == "tudo" || "$alvo" == "rules" ]]; then
  echo "RULES"
  K=AIzaSyCVGBtxNCj4iE3OsBY4KD_eYlYXL3SGgs4
  B="https://firestore.googleapis.com/v1/projects/terreiro-pvd/databases/(default)/documents"
  # As páginas trust-based (4 dígitos, sem Firebase Auth) LEEM estas. Se uma
  # fechar, a página não dá erro: mostra VAZIO, e parece dado em vez de defeito.
  #
  # A lista nasceu em 01/08, depois de publicar rules sem a leitura de
  # adm_despensa. O filho relatou "a despensa está vazia" e nada no sistema
  # tinha reclamado. Toda collection que uma página sem login lê entra aqui.
  # pdv_caixa_mov nasceu em 08/09 e é do PDV, que tem login. Não pode abrir pra
  # fora: sangria e conferência dizem quanto dinheiro tem na gaveta e a que
  # horas ele sai de lá.
  cod=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/pdv_caixa_mov?key=$K" -H 'Content-Type: application/json' -d '{"fields":{"tipo":{"stringValue":"sangria"}}}')
  [[ "$cod" == "403" ]] && ok "pdv_caixa_mov sem escrita pública" || erro "pdv_caixa_mov aceita escrita de fora (HTTP $cod) — publique firestore.rules.pvd"

  for c in vendas_produtos adm_servicos adm_despensa adm_perguntas \
           adm_kanban adm_escalas adm_funcoes adm_disponibilidade adm_rega_diaria; do
    [[ "$(http "$B/$c?pageSize=1&key=$K")" == "200" ]] && ok "$c público (as páginas precisam)" || erro "$c fechou — página pública quebra"
  done
  # evento_inscricoes fechou em 07/09. Levava nome, telefone, valor e filho_id
  # numa list pública — e filho_id + telefone é a credencial da área do filho
  # pra quem não tem PIN. É a repetição exata do que fin_filhos fez em 01/08.
  # E estas NÃO podem abrir. fin_reembolsos e adm_respostas carregam dado de
  # pessoa (chave PIX, telefone, acerto/erro com nome) — list público aqui é
  # vazamento, não conveniência.
  #
  # fin_filhos entrou nesta lista em 01/08. Era pública e levava telefone, valor
  # da mensalidade, nascimento, email e observação dos 60 numa resposta só. E o
  # telefone É a credencial da área do filho: quem lia a collection entrava como
  # qualquer pessoa da casa. O elenco agora vem do Worker, sem esses campos.
  for c in fin_pagamentos sales fin_mensalidade_pedidos fin_reembolsos adm_respostas fin_filhos \
           adm_notificacoes adm_avisos_lidos adm_tentativas adm_avisos adm_grupos evento_inscricoes; do
    [[ "$(http "$B/$c?pageSize=1&key=$K")" == "403" ]] && ok "$c fechado" || erro "$c FICOU PÚBLICO"
  done
  # O delete de adm_rega_diaria era público. Apagar um dia que não existe é
  # inofensivo, e é o único jeito de perguntar "a regra ainda nega?" de fora.
  # Se isto voltar a 200, qualquer pessoa apaga a reserva de qualquer filho.
  cod=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$B/adm_rega_diaria/9999-12-31?key=$K")
  [[ "$cod" == "403" ]] && ok "adm_rega_diaria sem delete público" || erro "adm_rega_diaria DELETE aberto (HTTP $cod) — publique firestore.rules.pvd"
  # adm_config: o doc 'agendamento' abre por get, a collection não abre por list
  [[ "$(http "$B/adm_config/agendamento?key=$K")" == "200" ]] && ok "adm_config/agendamento por get" || erro "adm_config/agendamento fechou — checkout quebra"
  [[ "$(http "$B/adm_config?pageSize=1&key=$K")" == "403" ]] && ok "adm_config sem list" || erro "adm_config FICOU LISTÁVEL"
fi

echo
if [[ $falhas -eq 0 ]]; then
  printf '\033[32mtudo no ar e coerente\033[0m\n'
else
  printf '\033[31m%s falha(s)\033[0m\n' "$falhas"
  exit 1
fi
