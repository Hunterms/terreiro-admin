#!/usr/bin/env bash
# Sobe o Worker.
#
#     cd worker && bash publicar.sh
#
# ── Por que token em arquivo, e não o `wrangler login` ─────────────────────
# O login do wrangler é GLOBAL nesta máquina, e ela está logada em
# `huntercarmo@dilettasolutions.com` — conta do conta-bold-ds e do
# cpf-seguro-ds. O `terreiro-email` mora em OUTRA conta
# (`hunter.soares.c@gmail.com`, subdomínio `hunter-soares-c`), e o login
# global responde `This Worker does not exist on your account`. Trocar o login
# pra publicar o terreiro derrubaria o deploy dos outros dois até alguém
# lembrar de trocar de volta.
#
# O `CLOUDFLARE_API_TOKEN` tem precedência sobre o login global, e só dentro
# deste processo. Mesmo desenho do `lara-cozinha/scripts/publicar.sh`, pelo
# mesmo motivo.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env.deploy ]; then
  cat >&2 <<'AJUDA'
Falta o worker/.env.deploy.

Cria um token na conta do Cloudflare dona do `terreiro-email`
(dash.cloudflare.com -> My Profile -> API Tokens -> Create Token -> Custom):

  Workers Scripts    Account   Edit
  Account Settings   Account   Read

Em Account Resources, restringe a essa conta. Não precisa de nada de Zone.
Depois grava assim (o .gitignore já cobre .env.*):

  CLOUDFLARE_API_TOKEN=...
  CLOUDFLARE_ACCOUNT_ID=...
AJUDA
  exit 1
fi

set -a; . ./.env.deploy; set +a

echo "→ conferindo a conta"
npx --yes wrangler whoami > /dev/null

echo "→ subindo"
npx --yes wrangler deploy

echo "→ smoke do worker"
cd .. && ./smoke.sh worker
