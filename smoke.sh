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
  checa https://terreirodocandieiro.com.br/sw.js "sw.js no domínio" "notificationclick"
fi

if [[ "$alvo" == "tudo" || "$alvo" == "financeiro" ]]; then
  echo "FINANCEIRO"
  checa https://financeiro.terreirodocandieiro.com.br/ "carrega" "login-screen"
  # o bug de 30/07: app.js declarava Firebase como se fosse global
  checa https://financeiro.terreirodocandieiro.com.br/js/app.js "app.js" "ouvirMensPedidos"
  checa https://financeiro.terreirodocandieiro.com.br/js/firebase.js "auth de verdade" "signInWithEmailAndPassword"
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
  r=$(curl -s -X POST "$W/zerar-pin" -H 'Content-Type: application/json' -d '{}')
  echo "$r" | grep -q 'X-Auth-Secret' && ok "zerar-pin (protegida)" || erro "zerar-pin: $r"
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
             "area-filho.html:avisarFalha" "filhos.js:avisarFalha"; do
    arq="${par%%:*}"; marca="${par##*:}"
    if grep -q "$marca" "$(dirname "$0")/$arq" 2>/dev/null; then
      ok "$arq protege leitura que falha"
    else
      erro "$arq PERDEU o tratamento de erro de leitura — 47 falhas caladas de volta"
    fi
  done
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
  for c in vendas_produtos adm_servicos adm_despensa adm_perguntas \
           adm_avisos adm_kanban adm_escalas adm_funcoes adm_disponibilidade adm_rega_diaria; do
    [[ "$(http "$B/$c?pageSize=1&key=$K")" == "200" ]] && ok "$c público (as páginas precisam)" || erro "$c fechou — página pública quebra"
  done
  # E estas NÃO podem abrir. fin_reembolsos e adm_respostas carregam dado de
  # pessoa (chave PIX, telefone, acerto/erro com nome) — list público aqui é
  # vazamento, não conveniência.
  #
  # fin_filhos entrou nesta lista em 01/08. Era pública e levava telefone, valor
  # da mensalidade, nascimento, email e observação dos 60 numa resposta só. E o
  # telefone É a credencial da área do filho: quem lia a collection entrava como
  # qualquer pessoa da casa. O elenco agora vem do Worker, sem esses campos.
  for c in fin_pagamentos sales fin_mensalidade_pedidos fin_reembolsos adm_respostas fin_filhos \
           adm_notificacoes adm_avisos_lidos adm_tentativas; do
    [[ "$(http "$B/$c?pageSize=1&key=$K")" == "403" ]] && ok "$c fechado" || erro "$c FICOU PÚBLICO"
  done
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
