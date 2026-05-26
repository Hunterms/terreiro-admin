# Terreiro do Candieiro — Admin · Schema do Firestore

**Projetos Firebase usados** (admin inicializa os dois):
- `terreiro-pvd` — PDV + financeiro · collections: `sales`, `fin_*`
- `terreiro-candieiro` — CMS do site · collections: `eventos`, `slides`, `galeria`, `paideanto`

O admin lê/escreve nos dois projects usando `initializeApp` com nomes distintos no client (ex: `dbPvd`, `dbCandieiro`).

**Última atualização**: 2026-05-26

---

## 1. Princípios

1. **Não duplicar**. Tudo que já está no `candieiro-simples` (financeiro) é lido de lá. Não criamos `adm_filhos` paralelo — usamos `fin_filhos` e adicionamos campos.
2. **Prefixo `adm_`** em collections novas (escrita do admin) pra deixar claro quem é dono daquele dado. `fin_*` continua sendo do financeiro. `sales` continua sendo do PDV.
3. **Timestamp em tudo**. Todo doc novo tem `criadoEm` (serverTimestamp) e `atualizadoEm`. Quando relevante, `criadoPor` (uid do usuário).
4. **Soft delete** onde fizer sentido. Em vez de apagar funções, eventos passados ou consulentes, marca `arquivado: true` pra preservar histórico.
5. **Compatibilidade retroativa**. Adicionar campos novos a `fin_filhos` não pode quebrar o financeiro. Ele já ignora campos desconhecidos — confirmado.

---

## 2. Convenções

- **IDs**: gerados pelo Firestore (`addDoc`) — strings opacas.
- **FKs**: campo termina em `_id` (singular) para 1:N, ou `_ids` (array) para N:N.
- **Datas**: `data` (string ISO `YYYY-MM-DD`) para datas sem hora; `ts` (serverTimestamp) para timestamps.
- **Booleans de visibilidade**: `publico: true|false`, `arquivado: true|false`.
- **Strings de status**: lowercase com underscore (`em_andamento`, `nao_compareceu`).

---

## 3. Auth e roles

**Firebase Auth com senha tradicional.** Custom claims:

```
roles: {
  admin: true,    // você (Hunter) + Pai Nando → tudo
  filho: true,    // todos os filhos cadastrados → view restrita
}
```

Sem claim = visitante (não loga, só acessa o site público).

Cada filho cadastrado em `fin_filhos` precisa ter um `auth_uid` opcional que liga ao Firebase Auth dele. Se vazio, ele não loga (status inicial).

---

## 4. Collection expandida: `fin_filhos`

Campos atuais (mantidos):
```
{
  nome:      string         // único, case-insensitive
  valor:     number         // mensalidade (R$)
  obs:       string
  tel:       string         // só dígitos
  prazo:     '10' | '15' | '20' | 'ultimo' | 'combinado'
  prazoObs:  string         // só se prazo === 'combinado'
}
```

**Campos novos**:
```
{
  auth_uid:        string|null      // Firebase Auth uid pra login (null = não loga)
  postos:          string[]         // FKs pra adm_funcoes — N:N
  padrinho_id:     string|null      // FK pra outro fin_filhos
  status:          'ativo' | 'afastado' | 'visitante'    // default 'ativo'
  data_entrada:    string|null      // ISO YYYY-MM-DD — quando começou a frequentar
  foto_url:        string|null      // URL Firebase Storage (opcional)
  criadoEm:        timestamp
  atualizadoEm:    timestamp
}
```

**Query útil — meus afilhados**:
```js
collection('fin_filhos').where('padrinho_id', '==', meuId)
```

**Validação a respeitar**:
- Não permitir `padrinho_id` apontar pra si mesmo
- `postos` referencia ids reais em `adm_funcoes`
- Mudar status pra `afastado` não apaga o doc

---

## 5. Collections novas

### 5.1. `adm_funcoes`

Funções/cargos da casa. CRUD restrito a `admin`.

```
{
  nome:              string         // ex: "Cambono", "Curimba", "Cozinha"
  descricao:         string         // 1-2 linhas
  entra_em_escala:   boolean        // se true, gerador considera
  tarefas_padrao:    string[]       // ex: ["Limpar terreiro", "Trocar água do altar"]
  arquivada:         boolean        // soft delete — mantém histórico
  cor:               string|null    // hex pra UI (opcional)
  criadoEm:          timestamp
  atualizadoEm:      timestamp
}
```

**Funções iniciais sugeridas** (você cria depois):
- Cambono
- Curimba (atabaque)
- Ekedi
- Médium em desenvolvimento
- Médium feito
- Filho de fé
- Cozinha
- Recepção
- Limpeza
- Altar/Peji

---

### 5.2. `eventos` (no project `terreiro-candieiro`) — EXPANDIDA

**Decisão**: fonte única. A collection `eventos` que hoje alimenta o calendário do site é estendida pra cobrir também trabalhos internos. Não criamos `adm_eventos`.

**Schema atual** (do `admin.html` no Downloads):
```
{ nome, data, hora, status, ts }
```

**Schema expandido**:
```
{
  // existentes (mantidos pra compat com site-candieiro)
  nome:             string                              // = título
  data:             string                              // ISO YYYY-MM-DD
  hora:             string                              // "HH:MM" (= hora_inicio)
  status:           string                              // legado (ex: "Confirmada") — manter
  ts:               timestamp                           // legado — manter

  // novos
  tipo:             'gira_aberta' | 'gira_fechada' | 'trabalho_interno' | 'ensaio_curimba' | 'reuniao' | 'mutirao' | 'obrigacao_coletiva' | 'festa' | 'outro'
  publico:          boolean                             // true → aparece no site público; false → só admin
  hora_fim:         string|null
  local:            string                              // "Terreiro", "Mata", etc.
  descricao:        string
  funcoes_necessarias: { funcao_id: string, quantidade: number }[]
  oferendas_ids:    string[]                            // FKs pra adm_oferendas (no project terreiro-pvd)
  recorrencia:      'unica' | 'semanal' | 'mensal' | 'anual' | null
  recorrencia_ate:  string|null
  arquivado:        boolean
  criadoEm:         timestamp
  atualizadoEm:     timestamp
  criadoPor:        string                              // uid
}
```

**Defaults pra docs antigos** (migration):
- `tipo: 'gira_aberta'` (assume que tudo que está lá hoje são giras públicas)
- `publico: true`
- `arquivado: false`
- demais campos vazios/null

**Site-candieiro precisa**: filtrar por `publico == true` ao renderizar o calendário público. Hoje provavelmente não filtra (todos são públicos). Update simples.

**Cross-project FKs**: `oferendas_ids` aponta pra `adm_oferendas_receitas` que vive no `terreiro-pvd`. É string opaca — Firestore não valida FK entre projects, código que fizer.

---

### 5.3. `adm_disponibilidade`

Filho declara o que NÃO pode fazer no mês. Vazio = totalmente disponível.

```
{
  filho_id:          string                  // FK fin_filhos
  mes:               string                  // "2026-06" (YYYY-MM)
  datas_indisponivel: string[]               // ["2026-06-14", "2026-06-21"]
  funcoes_indisponivel: string[]             // FKs adm_funcoes — "esse mês não cozinho"
  obs:               string                  // opcional, ex: "estou de luto"
  criadoEm:          timestamp
  atualizadoEm:      timestamp
}
```

**Doc ID sugerido**: `${filho_id}_${mes}` pra evitar duplicata.

---

### 5.4. `adm_escalas`

Cada doc é uma escala publicada (resultado do gerador).

```
{
  evento_id:        string              // FK eventos (project terreiro-candieiro)
  data:             string              // ISO YYYY-MM-DD (cópia pra query rápida)
  alocacoes: [
    {
      funcao_id:    string
      filho_id:     string
      status:       'escalado' | 'confirmado' | 'recusou' | 'faltou' | 'presente'
      notificado:   boolean
      notificado_em: timestamp|null
    }
  ]
  status_geral:     'rascunho' | 'publicada' | 'fechada'
  geradoPor:        'automatico' | 'manual'
  criadoEm:         timestamp
  atualizadoEm:     timestamp
}
```

**Regra do gerador**:
1. Para cada `funcao_necessaria` do evento, pega filhos com aquele posto em `fin_filhos.postos`
2. Remove os indisponíveis (`adm_disponibilidade` no mês)
3. Remove os que recusaram função X (`funcoes_indisponivel`)
4. Ordena por **menos vezes escalado nas últimas N semanas** (justiça do rodízio)
5. Aloca

**Edição manual** sempre sobrepõe. Quando admin troca um filho, o doc registra `geradoPor: 'manual'`.

---

### 5.5. `adm_kanban`

Cards de tarefas. Colunas são derivadas do campo `status`.

```
{
  titulo:           string
  descricao:        string
  status:           'todo' | 'doing' | 'blocked' | 'done'
  motivo_bloqueio:  string|null         // obrigatório quando status === 'blocked'
  responsaveis:     string[]            // FKs fin_filhos (pode ser >1)
  prazo:            string|null         // ISO YYYY-MM-DD
  prioridade:       'baixa' | 'media' | 'alta' | 'urgente'
  origem:           'manual' | 'estoque_baixo' | 'oferenda_falta' | 'encomenda' | 'consulente' | 'limpeza_pendente'
  origem_ref:       string|null         // id do doc que originou (ex: id do produto em fin_estoque)
  arquivado:        boolean             // só pra done antigos
  criadoEm:         timestamp
  atualizadoEm:     timestamp
  criadoPor:        string              // uid
  movido_done_em:   timestamp|null      // pra auditoria
}
```

**Cards auto-gerados** (Cloud Functions ou logic no client):
- `fin_estoque` item com `estoque < minimo` → cria card `origem: 'estoque_baixo'`
- `adm_eventos` da semana com oferendas faltando estoque → card `origem: 'oferenda_falta'`
- `adm_atendimentos` com `tipo_oraculo === 'baralho'` no dia → card lembrete

---

### 5.6. `adm_atendimentos`

Agenda do Pai. Substitui Google Calendar como **fonte da verdade** (sync vai pro Google, não vem).

```
{
  consulente_id:    string              // FK adm_consulentes
  consulente_nome:  string              // cópia pra view rápida (denormalizado)
  consulente_tel:   string              // cópia
  data:             string              // ISO YYYY-MM-DD
  hora:             string              // "HH:MM"
  duracao_min:      number              // default 60
  tipo_oraculo:     'baralho_cigano' | 'buzios'
  publico:          boolean             // baralho=true, búzios=false (não aparece no público)
  valor:            number
  status_pagamento: 'pendente' | 'pago_pix' | 'pago_dinheiro' | 'pago_cartao' | 'isento'
  pago_em:          timestamp|null
  status_atendimento: 'agendado' | 'confirmado' | 'realizado' | 'nao_compareceu' | 'cancelado'
  observacao:       string              // privado, só Pai vê
  google_event_id:  string|null         // id do evento no Google Calendar pós-sync
  criadoEm:         timestamp
  atualizadoEm:     timestamp
}
```

**Búzios**:
- `tipo_oraculo: 'buzios'` força `publico: false`
- Nunca aparece em view pública (decisão registrada na memória)
- Só Pai cria/edita

---

### 5.7. `adm_consulentes`

Quem consulta. Separado de filho (consulente externo é o caso comum).

```
{
  nome:             string
  tel:              string              // só dígitos
  email:            string|null
  primeira_vez:     timestamp           // quando consultou primeiro
  ultima_vez:       timestamp           // quando consultou última
  qtd_atendimentos: number              // incrementado em cada atendimento realizado
  origem:           'instagram' | 'indicacao' | 'site' | 'gira_aberta' | 'outro' | null
  observacoes:      string              // notas do Pai entre sessões
  arquivado:        boolean
  filho_id:         string|null         // se virou filho da casa depois (raro mas possível)
  criadoEm:         timestamp
  atualizadoEm:     timestamp
}
```

---

### 5.8. `adm_oferendas`

Receitas de oferenda + inventário do peji.

**Sub-collection ou duas collections?** Vou separar pra ficar mais limpo:

#### `adm_oferendas_receitas`
```
{
  nome:             string              // "Oferenda Exu Tranca-Rua"
  entidade:         string              // "Exu Tranca-Rua"
  itens: [
    { produto_id: string, nome: string, quantidade: number, unidade: string }
    // produto_id pode apontar pra fin_estoque OU ser livre (item externo)
  ]
  modo_preparo:     string              // texto livre
  observacao:       string
  criadoEm:         timestamp
}
```

#### `adm_inventario_peji`
```
{
  nome:             string              // "Assentamento de Ogum"
  tipo:             'assentamento' | 'ferramenta' | 'guia' | 'imagem' | 'outro'
  estado:           'bom' | 'manutencao' | 'precisa_troca'
  ultima_manutencao: string|null        // ISO date
  observacao:       string
  foto_url:         string|null
  criadoEm:         timestamp
  atualizadoEm:     timestamp
}
```

---

### 5.9. `adm_avisos`

Mural interno pros filhos.

```
{
  titulo:           string
  corpo:            string              // markdown ou texto puro
  publicadoEm:      timestamp
  validoAte:        timestamp|null      // some do mural depois disso
  importante:       boolean             // destaca no topo
  publicadoPor:     string              // uid
  lidoPor:          string[]            // uids de quem já viu (opcional)
  arquivado:        boolean
}
```

---

### 5.10. `adm_visitantes`

Funil leve de quem veio em gira aberta.

```
{
  nome:             string
  tel:              string|null
  email:            string|null
  data_primeira_visita: string         // ISO date
  giras_que_veio:   string[]            // ids de eventos
  interesse:        'baralho_cigano' | 'gira' | 'curso' | 'nenhum' | null
  contato_feito:    boolean
  observacao:       string
  criadoEm:         timestamp
}
```

---

## 6. Mapa completo de collections por project

### Project `terreiro-pvd` (PDV + financeiro)

| Collection | Owner original | Admin lê | Admin escreve |
|---|---|---|---|
| `fin_filhos` | candieiro-simples | sim | sim (campos novos) |
| `fin_pagamentos` | candieiro-simples | sim | não |
| `fin_estoque` | candieiro-simples | sim | sim (admin assume gestão) |
| `fin_cursos`, `fin_curso_alunos`, `fin_curso_pagamentos` | candieiro-simples | sim | sim (módulo cursos) |
| `fin_gastos*`, `fin_eventos`, `fin_dividas`, `fin_doacoes`, `fin_sonhos` | candieiro-simples | sim | não |
| `sales` | terreiro-pdv | sim | não |
| `adm_funcoes` | **admin (novo)** | sim | sim |
| `adm_disponibilidade` | **admin (novo)** | sim | sim |
| `adm_escalas` | **admin (novo)** | sim | sim |
| `adm_kanban` | **admin (novo)** | sim | sim |
| `adm_atendimentos` | **admin (novo)** | sim | sim |
| `adm_consulentes` | **admin (novo)** | sim | sim |
| `adm_oferendas_receitas` | **admin (novo)** | sim | sim |
| `adm_inventario_peji` | **admin (novo)** | sim | sim |
| `adm_avisos` | **admin (novo)** | sim | sim |
| `adm_visitantes` | **admin (novo)** | sim | sim |

### Project `terreiro-candieiro` (CMS do site)

| Collection | Owner original | Admin lê | Admin escreve |
|---|---|---|---|
| `eventos` (expandida — ver 5.2) | admin.html (Downloads) | sim | sim (assume gestão) |
| `slides` | admin.html (Downloads) | sim | sim |
| `galeria` | admin.html (Downloads) | sim | sim |
| `paideanto` | admin.html (Downloads) | sim | sim |

**Consequência**: o admin.html antigo do Downloads pode ser deprecado quando o admin novo entrar — toda a gestão do CMS migra pra cá.

**Auth nos dois projects**: o usuário precisa autenticar em ambos. Estratégias:
- (a) Mesmo email/senha replicado nos dois projects + login automático nos dois ao logar em um
- (b) Federation via Identity Platform (complexo, fora do escopo)

Recomendo (a): no boot do admin, autentica primeiro no `terreiro-pvd`, depois replica auth no `terreiro-candieiro` com mesmas credenciais. Custo: 2 cadastros por usuário.

---

## 7. Firestore Security Rules (esboço)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // helpers
    function isAuth() { return request.auth != null; }
    function isAdmin() { return request.auth.token.admin == true; }
    function isFilho() { return request.auth.token.filho == true; }
    function meuUid() { return request.auth.uid; }

    // FILHOS — financeiro escreve, admin estende
    match /fin_filhos/{filhoId} {
      allow read:   if isAdmin() || (isFilho() && resource.data.auth_uid == meuUid());
      allow write:  if isAdmin();
    }

    // FUNÇÕES — só admin
    match /adm_funcoes/{id} {
      allow read:   if isAuth();
      allow write:  if isAdmin();
    }

    // EVENTOS — vive no project `terreiro-candieiro`, não aqui
    // (regra aplicada lá: read público pra publico==true, write só admin)

    // DISPONIBILIDADE — filho escreve só a dele
    match /adm_disponibilidade/{id} {
      allow read:   if isAdmin() || (isFilho() && resource.data.filho_id == meuFilhoId());
      allow create: if isAuth() && request.resource.data.filho_id == meuFilhoId();
      allow update: if isAdmin() || (isFilho() && resource.data.filho_id == meuFilhoId());
      allow delete: if isAdmin();
    }

    // ESCALAS — admin escreve, filho lê
    match /adm_escalas/{id} {
      allow read:   if isAuth();
      allow write:  if isAdmin();
    }

    // KANBAN — admin tudo, filho lê e atualiza o status dos seus cards
    match /adm_kanban/{id} {
      allow read:   if isAuth();
      allow create: if isAdmin();
      allow update: if isAdmin() || (isFilho() && meuFilhoId() in resource.data.responsaveis);
      allow delete: if isAdmin();
    }

    // ATENDIMENTOS — só admin
    match /adm_atendimentos/{id} {
      allow read:   if isAdmin();
      allow write:  if isAdmin();
    }

    // CONSULENTES — só admin
    match /adm_consulentes/{id} {
      allow read:   if isAdmin();
      allow write:  if isAdmin();
    }

    // OFERENDAS — admin escreve, todos leem
    match /adm_oferendas_receitas/{id} {
      allow read:   if isAuth();
      allow write:  if isAdmin();
    }
    match /adm_inventario_peji/{id} {
      allow read:   if isAdmin();
      allow write:  if isAdmin();
    }

    // AVISOS — admin escreve, filho lê
    match /adm_avisos/{id} {
      allow read:   if isAuth();
      allow write:  if isAdmin();
    }

    // VISITANTES — só admin
    match /adm_visitantes/{id} {
      allow read:   if isAdmin();
      allow write:  if isAdmin();
    }

    // FINANCEIRO (collections fin_*) — admin lê tudo, filho lê só pagamento dele
    // detalhar depois com base nas rules atuais do candieiro-simples
  }
}
```

**`meuFilhoId()`** é uma função helper que precisa de um lookup. Alternativa mais simples: armazenar o `filho_id` direto no custom claim do Auth.

---

## 8. Índices compostos necessários

Firestore precisa de índices declarados pra queries com múltiplos `where`/`orderBy`:

```
Project `terreiro-candieiro`:
eventos:            (publico, data ASC)
eventos:            (tipo, data ASC)
eventos:            (arquivado, data ASC)

Project `terreiro-pvd`:
adm_escalas:        (data ASC, status_geral ==)
adm_escalas:        (evento_id ==, criadoEm DESC)
adm_disponibilidade: (filho_id ==, mes ==)        // unique
adm_kanban:         (status ==, prioridade DESC, prazo ASC)
adm_kanban:         (arquivado ==, atualizadoEm DESC)
adm_atendimentos:   (data ASC, hora ASC)
adm_atendimentos:   (status_pagamento ==, data DESC)
adm_consulentes:    (arquivado ==, ultima_vez DESC)
adm_avisos:         (arquivado ==, publicadoEm DESC)
```

---

## 9. Migrations / passos pra implantar

1. **Migration `fin_filhos`** (project `terreiro-pvd`): script que preenche `status: 'ativo'`, `postos: []`, `padrinho_id: null`, `auth_uid: null`, `data_entrada: null`, `foto_url: null` em todos os docs existentes.
2. **Migration `eventos`** (project `terreiro-candieiro`): preenche `tipo: 'gira_aberta'`, `publico: true`, `arquivado: false`, demais campos vazios em todos os docs existentes.
3. **Update site-candieiro**: filtrar por `publico == true` no fetch das giras.
4. Criar collections vazias (Firestore cria sob demanda — não precisa criar antes).
5. Criar funções iniciais em `adm_funcoes` (seed).
6. Subir security rules em ambos os projects.
7. Subir índices em ambos os projects.
8. Setup Firebase Auth nos dois projects com 2 usuários iniciais (Pai + Hunter) com claim `admin: true`.

---

## 10. Pontos abertos

1. ~~CMS do site~~ ✅ resolvido: `eventos` expandida no project `terreiro-candieiro`. Admin assume gestão; admin.html do Downloads é deprecado.
2. **Sync Google Calendar** — confirmação se vai ser via Cloud Function (precisa Firebase Blaze, pago) ou via cliente (limitação: só dispara quando o Pai abre o admin). Default sugerido: cliente, com botão "sincronizar agora" no admin.
3. ~~Notificações~~ ✅ resolvido: só in-app por enquanto. Sem WhatsApp, sem email, sem Cloud Functions.
4. **Upload de fotos** — Firebase Storage no project `terreiro-pvd`. Regras separadas: admin escreve em `filhos/`, `peji/`. Detalhar quando for implementar foto de filho/peji.
5. **Sync auth entre projects** — usuário precisa autenticar nos dois Firebase. Solução: ao logar no `terreiro-pvd`, replicar a mesma senha no `terreiro-candieiro` automaticamente (re-cadastrar o user se não existir). Custo: lógica de auth duplicada no boot.
