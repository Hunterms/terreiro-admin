# Email Worker — Setup grátis com domínio próprio

Envia email do `contato@terreirodocandieiro.com.br` sem expor chaves no frontend e sem precisar de plano pago.

**Stack:** Cloudflare Workers (free) → Resend (free 3000/mês) → email entregue pelo seu domínio.

---

## 1. Resend — provedor de email (5 min)

1. Cria conta em **[resend.com](https://resend.com/)** (free, sem cartão)
2. **Domains → Add Domain** → `terreirodocandieiro.com.br`
3. Resend mostra 3-4 registros DNS (SPF, DKIM) — copia
4. Vai no painel do **registro.br** (ou onde tem o domínio) → adiciona os registros TXT/CNAME exatamente como vieram
5. Volta no Resend → clica **Verify** (geralmente leva 10-30 min após DNS propagar)
6. **API Keys → Create API Key**:
   - Nome: `terreiro-admin-prod`
   - Permission: **Sending access** (só envio, não administração)
   - Domain: o seu
   - Copia o `re_xxxxxxxxxxxxxxxxx` — vai precisar daqui a pouco

---

## 2. Cloudflare Worker — proxy seguro (5 min)

1. Cria conta em **[cloudflare.com](https://cloudflare.com/)** (free)
2. Dashboard → **Workers & Pages → Create application → Create Worker**
3. Dá um nome (ex: `terreiro-email`) → **Deploy**
4. Depois do deploy → **Edit code**:
   - Apaga o Hello World que vem
   - Cola TODO o conteúdo de `email-worker.js`
   - **Deploy**
5. Vai em **Settings → Variables and Secrets** e adiciona 3 variáveis:

   | Nome | Tipo | Valor |
   |---|---|---|
   | `RESEND_API_KEY` | **Encrypt** | `re_xxxxxxxxxxxxxxx` (do passo 1.6) |
   | `ADMIN_SECRET` | **Encrypt** | uma senha aleatória qualquer (ex: `candieiro-mil-asas-2026`) |
   | `DEFAULT_FROM` | Plaintext | `Terreiro do Candieiro <contato@terreirodocandieiro.com.br>` |

   *⚠️ Clica "Encrypt" nas duas primeiras — protege contra leitura acidental.*

6. Copia a URL do Worker: `https://terreiro-email.SEU-SUBDOMINIO.workers.dev`

---

## 3. Firestore — config do admin (2 min)

No Firebase Console → **Firestore → adm_config** (cria se não existe) → cria doc com ID `email`:

```
enabled:        true                                                          (boolean)
worker_url:     https://terreiro-email.SEU-SUBDOMINIO.workers.dev              (string)
worker_secret:  candieiro-mil-asas-2026                                        (string — MESMO valor do ADMIN_SECRET acima)
from:           Terreiro do Candieiro <contato@terreirodocandieiro.com.br>     (string)
reply_to:       contato@terreirodocandieiro.com.br                             (string)
```

Pronto. Confirme um pedido qualquer e o email sai do `contato@terreirodocandieiro.com.br` 🎉

---

## Teste rápido

No terminal:

```bash
curl -X POST https://terreiro-email.SEU-SUBDOMINIO.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Auth-Secret: candieiro-mil-asas-2026" \
  -d '{
    "to": "seuemail@gmail.com",
    "to_name": "Teste",
    "subject": "Hello do Worker",
    "html": "<h1>Funcionou!</h1><p>De: contato@terreirodocandieiro.com.br</p>"
  }'
```

Resposta esperada: JSON com `{ "id": "xxx" }` e email aparece na caixa em segundos.

---

## Limites do free tier

- **Cloudflare Workers free:** 100.000 requests/dia (você vai usar tipo 30/mês)
- **Resend free:** 100 emails/dia, 3.000/mês, 1 domínio

Pra escalar (se passar de 3000/mês) → Resend Pro é $20/mês com 50k. Mas pra um terreiro, free dá pra sempre.

---

## Segurança

- **API key do Resend** fica só no Worker (env var encrypted, server-side)
- **Shared secret (`ADMIN_SECRET`)** é a única coisa que o admin frontend conhece — bloqueia abuso direto
- **CORS:** por padrão `ALLOW_ORIGINS = '*'` no worker (qualquer origem pode chamar). Em produção, troca pela URL exata do admin pra apertar mais. Mesmo com `'*'` o `X-Auth-Secret` previne uso indevido.

Se o shared secret vazar (por engano), é só:
1. Cloudflare → muda o `ADMIN_SECRET` pra outro valor
2. Firestore → atualiza `adm_config/email.worker_secret` com o novo valor
