# Terreiro do Candieiro — Admin · Sitemap & Navegação

**Última atualização**: 2026-05-25

---

## 1. Roles

| Role | Quem | Acesso |
|---|---|---|
| `admin` | Hunter + Pai Nando | Tudo |
| `filho` | Filhos da casa logados | View restrita (dashboard pessoal) |
| sem login | Visitantes | Não acessa o admin |

Sem multi-papel granular (você escolheu simples). O Pai e você veem o mesmo. Filhos veem só o que é deles.

---

## 2. Layout geral

```
┌─────────────────────────────────────────────────────────────┐
│  [logo]  Terreiro do Candieiro · Admin    [perfil]  [sair] │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Sidebar  │  Conteúdo da rota                                │
│          │                                                  │
│ - itens  │                                                  │
│ - por    │                                                  │
│ - role   │                                                  │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

**Sidebar adaptativa por role**:
- Admin vê 13 itens
- Filho vê 4 itens (dashboard, minhas escalas, disponibilidade, avisos)

---

## 3. Rotas

### View admin (`admin: true`)

| Rota | Tela | O que faz |
|---|---|---|
| `/` | Dashboard geral | KPIs + alertas + agenda do dia |
| `/filhos` | Lista de filhos | Cadastro, busca, filtros (posto, status, padrinho) |
| `/filhos/:id` | Detalhe do filho | Tudo do filho num lugar só |
| `/funcoes` | Gestão de funções | CRUD de cargos/funções da casa |
| `/calendario` | Calendário litúrgico | Visão mensal/semanal de giras + trabalhos |
| `/calendario/novo` | Criar trabalho interno | Form `adm_eventos` |
| `/calendario/:id` | Detalhe evento | Edita + ver escala gerada |
| `/escalas` | Lista de escalas publicadas | Filtra por data, função, filho |
| `/escalas/:id` | Detalhe de escala | Edição manual, notificações |
| `/escalas/gerar` | Gerador automático | Seleciona evento → gera prévia → publica |
| `/kanban` | Quadro Kanban | To Do · Doing · Blocked · Done |
| `/kanban/:id` | Detalhe card | Drawer/modal |
| `/agenda` | Agenda do Pai | Atendimentos do dia/semana/mês |
| `/agenda/novo` | Novo atendimento | Form com tipo de oráculo, valor, pagamento |
| `/agenda/:id` | Detalhe atendimento | Edita, marca pago, marca realizado |
| `/consulentes` | Lista de consulentes | Histórico de quem consulta |
| `/consulentes/:id` | Detalhe consulente | Histórico de atendimentos, observações |
| `/lojinha` | Estoque + vendas | Produtos, alertas, vendas do PDV |
| `/lojinha/novo` | Novo produto | Form |
| `/lojinha/:id` | Detalhe produto | Edita, histórico de venda |
| `/oferendas` | Receitas de oferenda | Lista de receitas (`adm_oferendas_receitas`) |
| `/oferendas/:id` | Detalhe oferenda | Edita receita, vincula a evento |
| `/peji` | Inventário do peji | Lista de assentamentos e ferramentas |
| `/peji/:id` | Detalhe item peji | Estado, manutenções |
| `/compras` | Lista de compras semanal | Auto-gerada a partir de oferendas da semana |
| `/cursos` | Lista de cursos | Lê `fin_cursos` + alunos + pagamentos |
| `/cursos/:id` | Detalhe curso | Alunos, pagamentos, conversão aluno→filho |
| `/avisos` | Gestão de avisos | CRUD do mural |
| `/avisos/novo` | Novo aviso | Form com validade, prioridade |
| `/visitantes` | Lista de visitantes | Funil leve |
| `/visitantes/:id` | Detalhe visitante | Conversão pra atendimento |
| `/financeiro` | Dashboard cruzado | KPI interno×externo, gráficos |
| `/configuracoes` | Settings | Sync Google Calendar, notificações, backup |

### View filho (`filho: true`)

| Rota | Tela | O que faz |
|---|---|---|
| `/` | Meu dashboard | Próximas escalas, avisos, meus cards |
| `/minhas-escalas` | Minhas escalas | Próximas + histórico |
| `/disponibilidade` | Minha disponibilidade | Marca dias indisponíveis e funções recusadas no mês |
| `/avisos` | Mural de avisos | Lê |
| `/perfil` | Meu perfil | Vê seus dados, troca senha, foto |

Filhos **não acessam** outras rotas. Tentativa redireciona pra `/`.

---

## 4. Detalhe de cada tela admin

### 4.1. `/` Dashboard geral (admin)

**Cards/seções**:
- **Agenda de hoje**: próximos atendimentos do Pai + giras/trabalhos do dia
- **Kanban resumido**: contagem por coluna + 3 cards mais urgentes/atrasados
- **Alertas**: estoque baixo, oferendas pendentes, pagamentos atrasados de filho, manutenção do peji vencendo
- **Próximas giras**: 3 próximas (publica + interna)
- **KPI rápido**: receita interna vs externa do mês (em %)

### 4.2. `/filhos`

**Lista** com colunas: foto · nome · postos (chips) · status · padrinho · mensalidade · pagamento OK/atrasado · ações (editar, ver)

**Filtros**:
- Status (ativo / afastado / visitante)
- Posto/função
- Tem padrinho? (sim/não)
- Mensalidade em dia? (sim/não — cruza `fin_pagamentos`)

**Busca** por nome.

**Botão "Novo filho"** → modal/page.

### 4.3. `/filhos/:id` (detalhe)

**Header**: foto, nome, status badge, "ativo desde X".

**Abas**:
1. **Dados** — nome, tel, mensalidade, prazo, obs (campos do `fin_filhos` original)
2. **Religioso** — postos (multi-select de `adm_funcoes`), padrinho (dropdown de outros filhos)
3. **Afilhados** — lista de quem tem este filho como `padrinho_id` (read-only)
4. **Pagamentos** — histórico de `fin_pagamentos` filtrado por este filho
5. **Escalas** — histórico de quando foi escalado, função, status (presença)
6. **Disponibilidade** — próximos meses declarados
7. **Cursos** — se está como `fin_curso_alunos` em algum curso

### 4.4. `/funcoes`

Lista simples + CRUD inline. Pra cada função:
- Nome, descrição, "entra em escala?" toggle
- Tarefas padrão (lista editável de strings)
- Cor (chip de cor pra UI)
- Quantos filhos têm essa função (link clicável → /filhos?funcao=X)
- Botão arquivar (não deleta — mantém histórico)

### 4.5. `/calendario`

**Visão padrão**: mês atual em grid.

**Layers** (toggleable):
- ☑ Giras abertas (do CMS do site)
- ☑ Trabalhos internos (`adm_eventos`)
- ☐ Atendimentos do Pai (overlay opcional, só admin)

**Cores por tipo**: gira aberta (verde), gira fechada (azul), trabalho (cinza), festa (dourado), etc.

**Click no dia** → lista do dia.
**Click no evento** → drawer com detalhes + ação "gerar escala" (se ainda não tem).

**Visão semanal** alternativa.

### 4.6. `/escalas/gerar`

Fluxo:
1. Seleciona evento (dropdown filtrado por data)
2. Sistema mostra prévia: pra cada função necessária, lista os 3 melhores candidatos (por rodízio, disponibilidade)
3. Admin pode swap qualquer filho
4. Botão "Publicar escala" → escreve em `adm_escalas` + dispara notificações
5. Opção "salvar como rascunho" pra revisar antes

### 4.7. `/kanban`

**Layout**: 4 colunas drag-and-drop.

**Card visual**: título, responsável (avatar), prazo (com cor se atrasado), origem (badge se auto-gerado), prioridade (borda colorida).

**Quick actions** no card: marcar done, editar, comentar.

**Bloquear** → modal pede `motivo_bloqueio` (obrigatório).

**Filtros topo**: responsável, prioridade, origem, prazo (vencidos / hoje / semana / todos).

**View "Meus cards"** pra filho — só os onde o uid dele está em `responsaveis`.

### 4.8. `/agenda` (atendimentos do Pai)

**Visão padrão**: semana atual.

**Por atendimento, mostra**:
- Hora, duração
- Nome consulente
- **Tipo de oráculo** (badge: BARALHO público / BÚZIOS privado em cinza)
- Status pagamento (badge colorido)
- Status atendimento (badge)

**Filtros**: data, tipo, status pagamento, status atendimento.

**Botão "Novo atendimento"** → form com:
- Buscar consulente existente OU criar novo (`adm_consulentes`)
- Data, hora, duração
- Tipo de oráculo
- Valor sugerido (config)
- Observação privada

**Pós-atendimento** (Pai marca "realizado"):
- Incrementa `qtd_atendimentos` em `adm_consulentes`
- Atualiza `ultima_vez`
- Pede observação opcional pra histórico

### 4.9. `/consulentes/:id`

**Header**: nome, contato, "consulente desde X", "X atendimentos".

**Histórico cronológico** de atendimentos com observações.

**Observações livres do Pai** (privado, só admin lê) — campo grande de notas.

**Ações**:
- Novo atendimento (pré-preenche este consulente)
- Mandar mensagem (WhatsApp link `wa.me/...`)
- Arquivar

### 4.10. `/lojinha`

**Aba "Estoque"**:
- Lista de `fin_estoque` com colunas: produto, categoria, preço, estoque atual, mínimo, **alerta visual** se abaixo
- Botão "Movimentar" pra entrada manual (compra)
- "Novo produto"

**Aba "Vendas"** (do PDV):
- Lista de `sales` recentes
- Filtros: método, período
- Resumo: total dia/semana/mês, ticket médio

**Aba "Encomendas"** (opcional fase 2):
- Pedidos especiais (consulente quer uma guia X)

### 4.11. `/oferendas` + `/compras`

**`/oferendas`**: cadastro de receitas reutilizáveis.
- Lista: nome, entidade, qtd de itens
- Editor: linha por item (produto vinculado a `fin_estoque` OU livre), quantidade, unidade

**`/compras`**: gerador automático.
- Pega `adm_eventos` da próxima semana
- Pra cada evento, soma as receitas de oferenda vinculadas
- Cruza com `fin_estoque` atual
- Gera lista: "falta X velas, Y cachaça, Z farofa"
- Export pra PDF / WhatsApp
- Cada item pode virar card no kanban com 1 clique

### 4.12. `/peji`

Lista do inventário com:
- Foto, nome, tipo, estado (badge)
- Última manutenção, próxima sugerida
- Click → detalhe com histórico de manutenção

### 4.13. `/cursos` (lê do `fin_*`)

**Lista de cursos** com: nome, turma, alunos, receita do mês.

**Detalhe**: alunos do curso (com flag se é filho da casa), histórico de pagamento, conversões aluno→filho.

### 4.14. `/avisos`

**Lista** de avisos publicados.

**Editor**: título, corpo (markdown simples), válido até quando, marcar importante.

### 4.15. `/visitantes`

**Lista** com: nome, contato, quantas giras veio, interesse.

**Ação chave**: "criar atendimento pra este visitante" → vira consulente automaticamente.

### 4.16. `/financeiro` (dashboard cruzado)

**Topo**: gráfico de pizza ou barra — **receita interna vs externa do mês**.

**Cards**:
- Receita interna: mensalidades pagas, cursos
- Receita externa: vendas PDV, atendimentos, doações, eventos
- Despesas: gastos fixos, variáveis, avulsos
- Saldo

**Comparativo mês×mês** (gráfico de linha).

**Lista de filhos com mensalidade atrasada** (cruza `fin_filhos.prazo` × `fin_pagamentos`).

---

## 5. Detalhe das telas do filho

### 5.1. `/` (filho) Meu dashboard

```
┌─────────────────────────────────┐
│ Olá, Maria                      │
├─────────────────────────────────┤
│ PRÓXIMA ESCALA                  │
│ Gira de Pretos-Velhos · sáb 30  │
│ Função: Cambonagem              │
│ [Confirmar] [Não poderei]       │
├─────────────────────────────────┤
│ AVISOS NOVOS (2)                │
│ - Reunião dia X                 │
│ - Mutirão sábado                │
├─────────────────────────────────┤
│ MEUS CARDS (1)                  │
│ - Comprar velas brancas         │
└─────────────────────────────────┘
```

### 5.2. `/disponibilidade`

Calendário do mês — clica nos dias que não pode.
Checkboxes de funções que recusa esse mês.
Campo "observação" opcional.
Botão "Salvar disponibilidade do mês".

### 5.3. `/minhas-escalas`

Lista cronológica: próximas em cima, passadas abaixo.
Pra cada uma: evento, função, status (escalado, confirmado, presente, faltou).
Ações: confirmar / desmarcar / pedir troca (futuro).

---

## 6. Fluxos críticos (end-to-end)

### Fluxo A — Da criação de evento à escala publicada

1. Admin abre `/calendario/novo`
2. Cria trabalho interno → escreve em `adm_eventos`
3. Define funções necessárias (ex: 2 cambonos, 1 ogã)
4. Vai em `/escalas/gerar`
5. Sistema lê disponibilidade dos filhos do mês
6. Gera prévia rodízio-justo
7. Admin ajusta manualmente se quiser
8. Publica → escreve em `adm_escalas` + cria cards de notificação no kanban
9. Filhos recebem notificação (in-app + WhatsApp/email se configurado)
10. Filhos confirmam em `/minhas-escalas`

### Fluxo B — Novo atendimento

1. Pai abre `/agenda/novo`
2. Busca consulente OU cria novo
3. Define data, hora, tipo de oráculo
4. Salva → escreve `adm_atendimentos`
5. Sync Google Calendar: client-side, dispara quando o Pai abre o admin (botão "sincronizar agora" também disponível em `/configuracoes`)
6. Dia: Pai marca "realizado" + pagamento
7. Sistema incrementa contadores em `adm_consulentes`

**Não tem lembrete automático pro consulente** (decisão: só notificação in-app, sem WhatsApp/email automatizado).

### Fluxo C — Estoque baixo vira lista de compras

1. Filho vende vela na lojinha (PDV ou admin)
2. `fin_estoque` atualiza estoque
3. Trigger detecta `estoque < minimo`
4. Cria card automático no kanban: "Repor vela branca (mínimo X)"
5. Card aparece na lista de compras semanal automaticamente
6. Admin compra, marca card como done, registra entrada no estoque

### Fluxo D — Visitante vira consulente

1. Recepção cadastra visitante na gira aberta (`adm_visitantes`)
2. Visitante demonstra interesse em baralho
3. Admin clica "criar atendimento" no perfil dele
4. Sistema cria `adm_consulentes` puxando os dados + abre form `/agenda/novo` pré-preenchido
5. Marca `adm_visitantes.contato_feito: true`

---

## 7. Componentes UI compartilhados

- **FilhoChip**: avatar + nome (clicável → /filhos/:id)
- **FuncaoChip**: badge colorido com nome da função
- **StatusBadge**: pílula colorida (ativo, afastado, pago, pendente, etc)
- **DataPicker** localizado pt-BR
- **DateRangePicker** pra filtros
- **EmptyState** padronizado (texto + ilustração + CTA)
- **ConfirmModal** pra ações destrutivas
- **Toast** pra feedback (já existe pattern no `candieiro-simples`)

---

## 8. Mobile

**Admin não é responsivo first** — Pai e você usam em desktop principalmente.

Mas as views do filho **precisam ser mobile-first** — filho vai abrir do celular pra ver escala e confirmar presença.

Sugestão: PWA pra que filhos possam "instalar" o link como app.

---

## 9. Onboarding inicial

Quando subir o admin:

1. Você + Pai logam (usuários `admin: true`)
2. Migration roda automática nos `fin_filhos` (adiciona campos com defaults)
3. Você cria as funções iniciais em `/funcoes` (sugestões listadas no SCHEMA.md)
4. Você associa postos aos filhos existentes (em massa via `/filhos`)
5. Você marca padrinhos
6. Você cria `auth_uid` pros filhos que vão logar (envia convite por email/WhatsApp)
7. Cadastra primeiros eventos (giras fixas + próximos especiais)
8. Sistema começa a funcionar

---

## 10. Decisões fechadas (após primeira rodada de alinhamento)

- ✅ **Stack frontend**: HTML vanilla + Firebase CDN (coerência com candieiro-simples e PDV). Sem framework, sem build step.
- ✅ **Hosting**: GitHub Pages (igual aos outros repos). Repo separado: `terreiro-admin`.
- ✅ **Notificações**: só in-app. Sem WhatsApp, sem email automático.
- ✅ **Firebase projects**: mantidos separados (`terreiro-pvd` + `terreiro-candieiro`). Admin inicializa os dois.
- ✅ **Eventos**: collection `eventos` no `terreiro-candieiro` é expandida pra cobrir giras públicas E internas. Filtra por `publico`.
- ✅ **PWA**: sim, pra filhos instalarem como app no celular.
- ✅ **Tema visual**: herda paleta do `candieiro-simples` (coerência de marca).
- ✅ **i18n**: só pt-BR.
- ✅ **Admin.html antigo (Downloads)** → deprecado quando admin novo entrar (toda gestão de CMS migra pra cá).

## 11. Pontos ainda abertos

1. **Sync Google Calendar** — client-side disparado pelo Pai (sem custo) vs Cloud Function (Firebase Blaze, pago, automático). Default sugerido: client.
2. **Upload de fotos** (filho, peji) — usar Firebase Storage qual project? Sugiro `terreiro-pvd` pra ficar junto com `fin_filhos`.
3. **Auth replicado nos dois projects** — fluxo exato de cadastro/login pra usuário não precisar logar duas vezes.
