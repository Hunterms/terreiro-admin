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
checa() {
  local url="$1" desc="$2" marcador="$3"
  local code; code=$(http "$url")
  if [[ "$code" != "200" ]]; then erro "$desc — HTTP $code"; return; fi
  if [[ -n "$marcador" ]] && ! pega "$url" | grep -q "$marcador"; then
    erro "$desc — abriu, mas não achei '$marcador' (versão velha no ar?)"
    return
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
fi

if [[ "$alvo" == "tudo" || "$alvo" == "financeiro" ]]; then
  echo "FINANCEIRO"
  checa https://financeiro.terreirodocandieiro.com.br/ "carrega" "login-screen"
  # o bug de 30/07: app.js declarava Firebase como se fosse global
  checa https://financeiro.terreirodocandieiro.com.br/js/app.js "app.js" "ouvirMensPedidos"
  checa https://financeiro.terreirodocandieiro.com.br/js/firebase.js "auth de verdade" "signInWithEmailAndPassword"
  if pega https://financeiro.terreirodocandieiro.com.br/js/app.js | grep -qE '^const app = initializeApp'; then
    erro "app.js voltou a chamar initializeApp como global — quebra na carga"
  else
    ok "sem initializeApp solto no app.js"
  fi
fi

if [[ "$alvo" == "tudo" || "$alvo" == "pdv" ]]; then
  echo "PDV"
  checa https://vendas.terreirodocandieiro.com.br/ "carrega com auth" "signInWithEmailAndPassword"
  if pega https://vendas.terreirodocandieiro.com.br/ | grep -q "CREDENTIALS"; then
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
fi

if [[ "$alvo" == "tudo" || "$alvo" == "rules" ]]; then
  echo "RULES"
  K=AIzaSyCVGBtxNCj4iE3OsBY4KD_eYlYXL3SGgs4
  B="https://firestore.googleapis.com/v1/projects/terreiro-pvd/databases/(default)/documents"
  for c in fin_filhos vendas_produtos adm_servicos; do
    [[ "$(http "$B/$c?pageSize=1&key=$K")" == "200" ]] && ok "$c público (as páginas precisam)" || erro "$c fechou — página pública quebra"
  done
  for c in fin_pagamentos sales fin_mensalidade_pedidos; do
    [[ "$(http "$B/$c?pageSize=1&key=$K")" == "403" ]] && ok "$c fechado" || erro "$c FICOU PÚBLICO"
  done
fi

echo
if [[ $falhas -eq 0 ]]; then
  printf '\033[32mtudo no ar e coerente\033[0m\n'
else
  printf '\033[31m%s falha(s)\033[0m\n' "$falhas"
  exit 1
fi
