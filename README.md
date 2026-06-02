# Terreiro do Candieiro · Admin

Sistema de gestão do Terreiro do Candieiro — Barão Geraldo, Campinas-SP.

## Arquivos

- **`index.html`** — Admin completo (login obrigatório). Filhos, funções, kanban, calendário, escalas, agenda do Pai, consulentes, avisos, solicitações de agendamento, config de agendamento.
- **`agendar.html`** — Página pública pra cliente agendar consulta de Baralho Cigano. Sem login. Pedidos vão pra `adm_solicitacoes` no Firestore, admin aprova manualmente.
- **`area-filho.html`** — Área pessoal pública do filho. Painel com tarefas, escalas, reembolso, disponibilidade do mês, afilhados + coluna comunidade (avisos, próximas atividades, rega). Trust-based (últimos 4 dígitos do tel). `disponibilidade.html` permanece como redirect.
- **`SCHEMA.md`** — Schema do Firestore (2 projects: `terreiro-pvd` + `terreiro-candieiro`), security rules, índices, migrations.
- **`SITEMAP.md`** — Sitemap do admin com rotas, fluxos E2E, componentes.

## Stack

- HTML vanilla + Firebase v10.12.0 (CDN, sem build step)
- Firebase Auth (admin) · Firestore (DB) · GitHub Pages (hosting)
- Dois projetos Firebase: `terreiro-pvd` (financeiro/PDV/admin) + `terreiro-candieiro` (CMS do site)

## Roles

- **admin** (Hunter + Pai Nando) → acesso total
- **filho** → tem login opcional (raramente usado — fluxo principal é a página pública)

## URLs públicas (depois do deploy)

| Página | Link |
|---|---|
| Admin | `/index.html` |
| Agendar consulta | `/agendar.html` |
| Área do filho (pessoal) | `/area-filho.html` (legado: `/disponibilidade.html` redireciona) |

## Setup

1. Criar usuários no Firebase Auth dos dois projetos (mesmo email/senha)
2. Configurar Firestore Security Rules conforme `SCHEMA.md`
3. Em **Funções** clicar "Criar funções iniciais"
4. Editar função "Lojinha" pra marcar o grupo restrito
5. Cadastrar filhos
6. Começar a usar

## Status

Em desenvolvimento ativo. Feedback do Pai Nando e dos filhos da casa em andamento.
