# Terreiro do Candieiro · Admin

Sistema de gestão do Terreiro do Candieiro — Barão Geraldo, Campinas-SP.

## Arquivos

- **`index.html`** — Admin completo (login obrigatório). Filhos, funções, kanban, calendário, escalas, contas fixas, agenda do Pai, consulentes, avisos, solicitações de agendamento, config de agendamento.
- **`agendar.html`** — Página pública pra cliente agendar consulta de Baralho Cigano. Sem login. Pedidos vão pra `adm_solicitacoes` no Firestore, admin aprova manualmente.
- **`area-filho.html`** — Área pessoal pública do filho. Painel com tarefas, escalas, reembolso, disponibilidade do mês, afilhados + coluna comunidade (avisos, próximas atividades, rega). Trust-based (últimos 4 dígitos do tel). `disponibilidade.html` permanece como redirect.
- **`SCHEMA.md`** — Schema do Firestore (2 projects: `terreiro-pvd` + `terreiro-candieiro`), security rules, índices, migrations.
- **`ARQUITETURA.md`** — Revisão de arquitetura dos 5 apps (30/07): governança, modelagem, manutenção, e o que NÃO fazer.
- **`MENSALIDADE.md`** — Desenho do pagamento recorrente (mensalidade do filho + produto recorrente): decisões, contrato de dados, regra do acréscimo, fases.
- **`SITEMAP.md`** — Sitemap do admin com rotas, fluxos E2E, componentes.
- **`PUSH.md`** — App na tela de início e notificação no celular: o que configurar, o que chega, e o que ficou de fora.
- **`sw.js` / `push.js`** — Service worker (desenha a notificação) e registro do aparelho. Um `push.js` serve o admin e a área do filho.

## Stack

- HTML vanilla + Firebase v10.12.0 (CDN, sem build step)
- Firebase Auth (admin) · Firestore (DB) · GitHub Pages (hosting)
- Firebase Cloud Messaging (push) · Cloudflare Worker (email, checkout, cron)
- Dois projetos Firebase: `terreiro-pvd` (financeiro/PDV/admin) + `terreiro-candieiro` (CMS do site)

## Duas coisas que nunca disparam sozinhas

**Lembrete de mensalidade.** O cron não manda email pra filho nenhum. Às 9h ele
avisa você de quantos vencem amanhã; você abre *Lembretes → Mensalidade*, o
Worker devolve a lista com valor e vencimento calculados na hora, vem
pré-marcado quem vence amanhã e ainda não foi avisado, **você edita a lista**, e
só então sai — um filho por vez, com a barra andando e a falha de cada um
nomeada no fim.

**Baixa de conta fixa.** O sistema avisa que a conta vence amanhã; quem diz que
pagou é você, em *Contas fixas*.

## Roles

- **admin** (Hunter + Pai Nando) → acesso total
- **filho** → tem login opcional (raramente usado — fluxo principal é a página pública)

## URLs públicas (depois do deploy)

| Página | Link |
|---|---|
| Admin | `/index.html` |
| Agendar consulta | `/agendar.html` |
| Área do filho (pessoal) | `/area-filho.html` (legado: `/disponibilidade.html` redireciona) |

As duas primeiras colunas viram app na tela de início do celular (Android e
iPhone) e recebem notificação — ver `PUSH.md`.

## Setup

1. Criar usuários no Firebase Auth dos dois projetos (mesmo email/senha)
2. Configurar Firestore Security Rules conforme `SCHEMA.md`
3. Em **Funções** clicar "Criar funções iniciais"
4. Editar função "Lojinha" pra marcar o grupo restrito
5. Cadastrar filhos
6. Começar a usar

## Status

Em desenvolvimento ativo. Feedback do Pai Nando e dos filhos da casa em andamento.
