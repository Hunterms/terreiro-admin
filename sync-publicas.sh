#!/usr/bin/env bash
#
# Sincroniza as páginas públicas do admin (fonte) pro site-candieiro (que serve
# o domínio), commita e publica.
#
#   ./sync-publicas.sh              copia, commita e faz push
#   ./sync-publicas.sh --conferir   só diz o que está fora de sync, não escreve
#
# ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
# As páginas públicas moram em dois repos: aqui (fonte) e no site-candieiro
# (deploy do domínio). Copiar na mão já falhou duas vezes, as duas em silêncio:
# a produção do financeiro ficou 2 meses atrás, e reembolso pedido pelo filho
# ficou invisível de junho a julho porque a tela que os lê nunca subiu.
#
# Não é CI de propósito: Action entre repos precisaria de token com escrita no
# outro repo, e token guardado é o que já deu problema aqui. Isto usa o SSH que
# você já tem, num comando.
#
# ── POR QUE NÃO MOVER AS PÁGINAS EM VEZ DE COPIAR ──────────────────────────
# Porque URL já circula no mundo: tem QR code impresso no terreiro apontando pro
# confirma-rega.html, e link de agendar/vendas/área do filho em conversa de
# WhatsApp e no site. Mudar endereço quebra o que já foi entregue.

set -euo pipefail

ADMIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$HOME/Desktop/Docs/claude/site-candieiro"

# Páginas que o DOMÍNIO serve. Se nascer outra, entra aqui — é a única lista.
#
# Existem duas classes de página pública, e a diferença é de propósito:
#
#   no domínio  → quem chega de fora: consulente, aluno, visitante, filho
#   só no admin → ferramenta interna que não precisa de endereço bonito:
#                 confirma-rega.html (o QR impresso no terreiro aponta pro
#                 github.io) e despensa.html (gerente de despensa)
#
# As de "só no admin" dão 404 no domínio, e isso está certo — não são falta de
# sync. Conferido em 30/07.
#
# `push.js` e `sw.js` não são páginas, mas entram pelo mesmo motivo: a
# area-filho.html do domínio faz `import "./push.js"`, e um import que dá 404
# derruba o módulo INTEIRO — a página fica em branco, não "sem notificação".
# Foi o que quase aconteceu em 01/08.
PAGINAS=(
  agendar.html
  vendas.html
  evento.html
  area-filho.html
  disponibilidade.html
  reembolso.html
  pago.html
  checkout.js
  push.js
  sw.js
  manifest-filho.json
)

CONFERIR=false
[[ "${1:-}" == "--conferir" ]] && CONFERIR=true

[[ -d "$SITE/.git" ]] || { echo "✗ não achei o repo do site em $SITE"; exit 1; }

fora=()
for p in "${PAGINAS[@]}"; do
  if [[ ! -f "$ADMIN/$p" ]]; then
    echo "⚠  $p não existe no admin — pulando"
    continue
  fi
  if [[ ! -f "$SITE/$p" ]] || ! cmp -s "$ADMIN/$p" "$SITE/$p"; then
    fora+=("$p")
  fi
done

if [[ ${#fora[@]} -eq 0 ]]; then
  echo "✓ tudo em sync (${#PAGINAS[@]} páginas)"
  exit 0
fi

echo "Fora de sync (${#fora[@]}):"
printf '  %s\n' "${fora[@]}"

if $CONFERIR; then
  echo
  echo "Rode sem --conferir pra publicar."
  exit 1
fi

for p in "${fora[@]}"; do cp "$ADMIN/$p" "$SITE/$p"; done

cd "$SITE"
git add -- "${fora[@]}"

# Pode não haver nada pra commitar: acontece quando a cópia do site estava
# modificada localmente e o admin tem justamente a versão que já está publicada
# — o cp desfez a mudança local. Sem esta guarda o `git commit` falha e o
# set -e derruba o script parecendo erro grave.
if git diff --cached --quiet; then
  echo
  echo "✓ cópias alinhadas com o que já estava publicado — nada a commitar"
  exit 0
fi

git commit -q -m "Sync do admin: $(printf '%s ' "${fora[@]}" | sed 's/ $//')"
git push -q origin main
echo
echo "✓ publicado: $(git log -1 --format=%h)"
echo "  GitHub Pages leva ~1 min. Confere com:"
echo "  curl -s \"https://terreirodocandieiro.com.br/${fora[0]}?cb=\$(date +%s)\" | head -c 80"
