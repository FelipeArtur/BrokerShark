# BrokerShark — Guia para o Claude

## Visão Geral do Projeto

Assistente financeiro pessoal acessível via **Telegram**, rodando **100% local** no Linux.
O registro é feito por botões — sem digitar comandos, sem linguagem natural.
Todo gasto registrado é persistido no SQLite local e imediatamente espelhado no **Google Sheets**,
que funciona como backup permanente: apenas adições, nunca deleções.

**Usuário:** homem, 24 anos, contas no Nubank e Inter (corrente + crédito), caixinha/cofrinho e Tesouro Direto.

---

## Arquitetura

```
brokershark/
├── backend/
│   ├── main.py            # Ponto de entrada — inicia bot (polling) + scheduler
│   ├── bot.py             # Lógica do bot — ConversationHandler, InlineKeyboard, comandos
│   ├── database.py        # Camada de dados — SQLite, criação de tabelas, queries
│   ├── sheets.py          # Google Sheets — append-only após cada INSERT no banco
│   ├── backup.py          # Backup local do SQLite (cópia diária)
│   ├── scheduler.py       # APScheduler — backup diário + relatório semanal
│   └── parsers/
│       ├── nubank_cc.py   # Parser CSV Nubank crédito
│       ├── nubank_db.py   # Parser CSV Nubank débito
│       ├── inter_cc.py    # Parser CSV Inter crédito
│       └── inter_db.py    # Parser CSV Inter débito
├── data/                  # Banco de dados SQLite (não versionado)
├── logs/                  # Logs de execução (não versionados)
├── backups/               # Backups locais automáticos (não versionados)
├── credentials/
│   └── service_account.json  # Credenciais Google API (não versionado)
├── requirements.txt
├── .env                   # Credenciais (não versionado — ver .env.example)
└── .env.example
```

### Fluxo principal — registro de gasto

```
Usuário toca /novo no Telegram
      ↓
ConversationHandler (bot.py) — conduz o fluxo passo a passo via botões
      ↓
Ao confirmar: database.py — INSERT na tabela transacoes (SQLite)
      ↓
sheets.py — append_transacao() em thread separada (não bloqueia o bot)
      ↓
bot.py — envia confirmação formatada ao usuário
```

---

## Stack

- **Linguagem:** Python 3.12
- **Bot:** python-telegram-bot v21
- **Banco de dados:** SQLite (WAL mode) — fonte de verdade
- **Google Sheets:** gspread + google-auth (Service Account) — backup append-only
- **Agendamento:** APScheduler
- **HTTP:** httpx

> Ollama (Phi-3.5 Mini / ROCm) reservado para consultas em linguagem natural — **não** é usado no fluxo de registro.

---

## Como rodar

```bash
cp .env.example .env
# edite .env com suas credenciais
pip install -r requirements.txt
python backend/main.py
```

---

## Menu Principal

Toda interação começa com `/novo` ou o bot exibe este menu:

```
O que você quer registrar?

[ Gasto ]           [ Recebimento ]
[ Investimento ]
```

Cada opção entra num `ConversationHandler` próprio.

---

## Fluxo 1 — Registro de Gasto

### Estados da conversa

```
TIPO_PAGAMENTO → BANCO → VALOR → PARCELADO → NUM_PARCELAS → DESCRICAO → CATEGORIA → CONFIRMACAO
```

`NUM_PARCELAS` só é visitado se o usuário responder "Sim" em `PARCELADO`.

### Passo a passo

**1. Tipo de pagamento**
Gatilho: `/novo` ou botão "Novo gasto" no menu principal.
```
Como foi o pagamento?
[ PIX ]  [ Crédito ]
[ Débito ]  [ TED ]
```

**2. Banco**
```
Qual banco?
[ Nubank ]  [ Inter ]
```
Isso determina o `conta_id` final:
- PIX/Débito/TED + Nubank → `nu-db`
- PIX/Débito/TED + Inter  → `inter-db`
- Crédito + Nubank         → `nu-cc`
- Crédito + Inter          → `inter-cc`

**3. Valor**
```
Qual o valor? (ex: 45,90)
```
Aceitar tanto vírgula quanto ponto como separador decimal.

**4. Parcelado?** (só para Crédito)
```
Foi parcelado?
[ Sim ]  [ Não ]
```
Para PIX, Débito e TED este passo é pulado (parcelas = 1).

**5. Número de parcelas** (só se Sim)
```
Em quantas vezes?
```
Usuário digita um número inteiro.

**6. Descrição do gasto**
```
Como você quer chamar esse gasto?
```
Usuário digita livremente (ex: "iFood", "Ingresso show", "PS Store").

**7. Categoria**
```
Qual a categoria?
[ Alimentação ]        [ Carro ]
[ Jogos ]              [ Lazer ]
[ Atividade física ]   [ Eletrônicos ]
[ Educação ]           [ Igreja ]
[ Dízimo ]             [ Outro ]
```

**8. Resumo + Confirmação**
```
Confirma o registro?

Tipo:      Crédito — Nubank
Valor:     R$ 89,90 (3x de R$ 29,97)
Gasto:     PS Store
Categoria: Jogos

[ Confirmar ]  [ Cancelar ]
```

**9. Após confirmação**
```
Gasto registrado!

PS Store — R$ 89,90
Nubank Crédito · Jogos
17/04/2026
```

### Cancelamento a qualquer momento

Qualquer mensagem `/cancelar` ou botão "Cancelar" aborta o `ConversationHandler` e limpa o estado.

---

## Fluxo 2 — Registro de Recebimento

### Estados da conversa

```
TIPO_RECEBIMENTO → BANCO → VALOR → DESCRICAO → CONFIRMACAO
```

### Passo a passo

**1. Tipo de recebimento**
```
O que você recebeu?

[ Salário ]          [ Freela ]
[ PIX recebido ]     [ Transferência ]
[ Outro ]
```

**2. Banco**
```
Em qual conta caiu?
[ Nubank ]  [ Inter ]
```
Determina `conta_id`: Nubank → `nu-db`, Inter → `inter-db`.
Recebimentos sempre entram na conta corrente.

**3. Valor**
```
Qual o valor recebido? (ex: 3500,00)
```

**4. Descrição**
```
De onde veio? (ex: "Empresa X", "João", "Projeto site")
```

**5. Resumo + Confirmação**
```
Confirma o registro?

Tipo:    Salário
Valor:   R$ 3.500,00
De:      Empresa X
Conta:   Nubank Débito

[ Confirmar ]  [ Cancelar ]
```

**6. Após confirmação**
```
Recebimento registrado!

Salário — R$ 3.500,00
Empresa X · Nubank Débito
17/04/2026
```

---

## Fluxo 3 — Investimento (Caixinha / Tesouro Direto)

### Estados da conversa

```
OPERACAO_INVEST → RESERVA → VALOR → DESCRICAO → CONFIRMACAO
```

### Passo a passo

**1. Operação**
```
O que você quer fazer?

[ Investir (aporte) ]  [ Resgatar ]
```

**2. Onde**
```
Em qual investimento?

[ Caixinha Nubank ]  [ Tesouro Direto ]
```

**3. Valor**
```
Qual o valor? (ex: 500,00)
```

**4. Descrição** *(opcional)*
```
Alguma observação? (ex: "reserva emergência", "férias")
Ou envie /pular para continuar sem.
```

**5. Resumo + Confirmação**
```
Confirma o investimento?

Operação:   Aporte
Onde:       Caixinha Nubank
Valor:      R$ 500,00
Obs:        reserva emergência

[ Confirmar ]  [ Cancelar ]
```

**6. Após confirmação**
```
Investimento registrado!

Aporte — R$ 500,00
Caixinha Nubank
17/04/2026
```

---

## Google Sheets — Backup Append-Only

### Princípio

O Sheets é um **espelho imutável** do banco local. Cada INSERT no SQLite gera um append no Sheets.
Nenhuma linha é jamais editada ou deletada na planilha.
Se o banco local for apagado, o Sheets contém o histórico completo para restauração manual.

### Abas da planilha

| Aba | Colunas | Preenchida quando |
|-----|---------|-------------------|
| Gastos | id, data, meio, banco, conta_id, valor, parcelas, descricao, categoria, data_registro | A cada despesa confirmada |
| Recebimentos | id, data, meio, banco, conta_id, valor, descricao, data_registro | A cada receita confirmada |
| Investimentos | id, data, reserva, operacao, valor, descricao, data_registro | A cada aporte/resgate confirmado |

> Não há abas de resumo automáticas — isso fica para fórmulas nativas no próprio Google Sheets.

### `sheets.py` — contrato de funções

```python
def append_despesa(transacao: dict) -> None: ...
def append_receita(transacao: dict) -> None: ...
def append_investimento(mov: dict) -> None: ...
```

- Autenticar via `gspread.service_account(filename=CREDENTIALS_PATH)`
- Append: `worksheet.append_row(row, value_input_option="USER_ENTERED")`
- Executar em `asyncio.get_event_loop().run_in_executor(None, ...)` para não bloquear o bot
- Falhas logadas em `logs/sheets_errors.log` — **nunca** propagadas para o usuário

### Setup (feito uma vez)

```
1. Google Cloud Console → criar projeto → ativar Google Sheets API + Google Drive API
2. Criar Service Account → baixar JSON → salvar em credentials/service_account.json
3. Criar planilha no Google Sheets → copiar o ID da URL
4. Compartilhar a planilha com o e-mail da Service Account (permissão: Editor)
5. Preencher SHEETS_ID no .env
```

---

## Notas para o Claude

### Comportamentos esperados

- Sempre use **type hints** em todas as funções
- Prefira **funções pequenas e com responsabilidade única**
- Todo acesso ao banco passa por `database.py` — nunca SQL inline em outros módulos
- O bot **nunca salva direto no banco** — dados coletados no ConversationHandler são validados antes do INSERT
- Use `python-dotenv` para carregar variáveis de ambiente
- Toda mensagem recebida pelo bot deve ter o `chat_id` verificado antes de qualquer processamento
- `PRAGMA journal_mode=WAL` e `PRAGMA foreign_keys=ON` obrigatórios na criação do banco
- **Nunca** usar SQL inline fora de `database.py`
- Erros no Google Sheets **nunca** devem interromper o fluxo principal

### Padrões técnicos

**python-telegram-bot v21:**
- `Application.builder()` para configuração
- `ConversationHandler` para o fluxo de registro (estados listados acima)
- `InlineKeyboardMarkup` + `CallbackQueryHandler` para todos os botões
- `CommandHandler` para `/novo`, `/saldo`, `/resumo`, `/reservas`, `/ajuda`
- `MessageHandler(filters.Document.ALL)` para arquivos CSV

**SQLite:**
- Context manager: `with sqlite3.connect(DB_PATH) as conn`
- `PRAGMA journal_mode=WAL` — executar na criação
- `PRAGMA foreign_keys=ON` — executar na criação

**Google Sheets / gspread:**
- Autenticar via Service Account: `gspread.service_account(filename=CREDENTIALS_PATH)`
- Append: `worksheet.append_row(valores, value_input_option="USER_ENTERED")`
- Executar em thread separada para não bloquear o event loop do bot

### Variáveis de ambiente (.env.example)

```env
# Telegram
TELEGRAM_TOKEN=SEU_TOKEN_AQUI
TELEGRAM_CHAT_ID=SEU_CHAT_ID_AQUI

# Banco
DB_PATH=/home/SEU_USUARIO/brokershark/data/brokershark.db
BACKUP_DIR=/home/SEU_USUARIO/brokershark/backups

# Google Sheets
SHEETS_ID=ID_DA_SUA_PLANILHA_AQUI
SHEETS_CREDENTIALS=/home/SEU_USUARIO/brokershark/credentials/service_account.json
```

### Modelo de dados

```sql
CREATE TABLE contas (
  id TEXT PRIMARY KEY,       -- nu-cc | nu-db | inter-cc | inter-db
  banco TEXT NOT NULL,       -- nubank | inter
  tipo TEXT NOT NULL,        -- corrente | credito
  nome TEXT NOT NULL,
  dia_corte INTEGER,
  dia_vencimento INTEGER,
  saldo_inicial REAL DEFAULT 0
);

CREATE TABLE categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL         -- despesa | receita
);

CREATE TABLE transacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  fluxo TEXT NOT NULL,           -- despesa | receita
  meio TEXT NOT NULL,            -- despesa: pix|credito|debito|ted  receita: salario|freela|pix_recebido|transferencia|outro
  conta_id TEXT NOT NULL,
  valor REAL NOT NULL,
  parcelas INTEGER DEFAULT 1,    -- sempre 1 para receitas
  descricao TEXT NOT NULL,
  categoria_id INTEGER,          -- obrigatório para despesas, null para receitas
  conta_dest TEXT,               -- só em transferências internas
  contraparte TEXT,              -- quem enviou/recebeu (PIX externo)
  FOREIGN KEY (conta_id) REFERENCES contas(id),
  FOREIGN KEY (conta_dest) REFERENCES contas(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

CREATE TABLE reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,        -- caixinha | cofrinho | tesouro
  banco TEXT NOT NULL,
  saldo_atual REAL DEFAULT 0
);

CREATE TABLE movimentacoes_reserva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  reserva_id INTEGER NOT NULL,
  operacao TEXT NOT NULL,    -- aporte | resgate
  valor REAL NOT NULL,
  descricao TEXT,
  FOREIGN KEY (reserva_id) REFERENCES reservas(id)
);

CREATE TABLE log_nao_reconhecidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  mensagem TEXT NOT NULL
);
```

**Seed obrigatório das contas:**

```python
contas = [
    ("nu-cc",    "nubank", "credito",  "Nubank Crédito"),
    ("nu-db",    "nubank", "corrente", "Nubank Débito"),
    ("inter-cc", "inter",  "credito",  "Inter Crédito"),
    ("inter-db", "inter",  "corrente", "Inter Débito"),
]
```

**Seed das categorias de despesa:**

```python
categorias_despesa = [
    "Alimentação",      # mercado, restaurante, lanche
    "Carro",            # combustível, manutenção, seguro
    "Jogos",            # PS Store, Steam, assinaturas gaming
    "Lazer",            # cinema, passeios, hobbies
    "Atividade física", # academia, suplementos, equipamentos
    "Eletrônicos",      # gadgets, acessórios, reparos
    "Educação",         # faculdade, cursos, livros
    "Igreja",           # eventos, viagens, contribuições da Igreja
    "Dízimo",           # dízimo mensal
    "Outro",
]
```

**Seed das categorias de receita** (usadas no fluxo de Recebimento):

```python
categorias_receita = [
    "Salário",
    "Freela",
    "PIX recebido",
    "Transferência",
    "Outro",
]
```

### Importação de CSV

Fluxo ao receber arquivo `.csv` no bot:

1. Bot detecta arquivo CSV recebido
2. Exibe InlineKeyboard: qual conta? (nu-cc / nu-db / inter-cc / inter-db)
3. Chama o parser correspondente
4. Exibe prévia: quantidade de transações, período, total
5. Aguarda [Confirmar] ou [Cancelar]
6. Salva e informa quantas duplicatas foram ignoradas
7. Appenda as novas transações no Sheets em background

Detectar duplicatas por: `(data, valor, nome, conta_id)`.

### Segurança

```python
# Primeiro handler em toda mensagem recebida
if update.effective_chat.id != int(os.getenv("TELEGRAM_CHAT_ID")):
    return
```

### Backup local

- Cópia diária de `brokershark.db` → `backups/brokershark_YYYY-MM-DD.db`
- Manter apenas os últimos 30 arquivos
- Executado às 03:00 via APScheduler

### Relatório semanal automático

Toda segunda-feira às 08:00, enviar no Telegram:

```
Resumo da semana passada

Gastos: R$ X
Receitas: R$ X
Top categoria: X — R$ X
Fatura Nubank: R$ X (vence em N dias)
Fatura Inter: R$ X (vence em N dias)
Reservas: R$ X
```

---

### Decisões de design

| Decisão | Motivo |
|---|---|
| Registro 100% por botões | Elimina erros de digitação e torna o registro instantâneo no celular |
| Três fluxos separados (gasto/recebimento/investimento) | Cada fluxo tem campos específicos — unificar criaria lógica condicional complexa |
| Receita sempre cai na conta corrente | Salário, freela e PIX recebido não entram no crédito — simplifica a escolha de conta |
| Investimentos apenas Caixinha e Tesouro | São os únicos ativos usados atualmente — evitar complexidade prematura |
| Sheets append-only com 3 abas separadas | Cada tipo de transação tem colunas diferentes; separar facilita filtros no Sheets |
| Sheets nunca é fonte de verdade | SQLite é o único estado consistente — Sheets é output imutável |
| Falha no Sheets não bloqueia o bot | Registrar localmente é sempre mais importante que espelhar |
| SQLite WAL em vez de PostgreSQL | Uso pessoal, zero config, arquivo único, fácil de backupear |
| Ollama fora do fluxo de registro | Botões eliminam a necessidade de parsing de linguagem natural para o MVP |
| Categorias baseadas nos gastos reais do usuário | Categorias genéricas não refletem o padrão de consumo específico do usuário |
| Autenticação por chat_id | Bot pessoal — simples e suficiente |

---

### Tarefas em aberto

**Fase 1 — Fundação** ← atual
- [ ] `database.py` — criar tabelas, PRAGMAs, seed de contas/categorias, queries
- [ ] `sheets.py` — append_despesa, append_receita, append_investimento (thread separada)
- [ ] `bot.py` — menu principal + 3 ConversationHandlers (gasto / recebimento / investimento)
- [ ] `main.py` — iniciar bot (polling) + scheduler
- [ ] `backup.py` + `scheduler.py` — backup diário local + relatório semanal

**Fase 2 — Importação histórica**
- [ ] Saldo inicial de cada conta como âncora antes de importar
- [ ] `parsers/nubank_cc.py` e `parsers/nubank_db.py`
- [ ] `parsers/inter_cc.py` e `parsers/inter_db.py`
- [ ] Detecção de duplicatas por `(data, valor, nome, conta_id)`
- [ ] Prévia antes de confirmar importação
- [ ] Append das novas transações no Sheets após importação

**Fase 3 — Consultas rápidas**
- [ ] `/saldo` — saldo por conta
- [ ] `/resumo` — resumo do mês atual por categoria
- [ ] `/fatura` — fatura atual dos cartões (Nubank e Inter)
- [ ] `/reservas` — saldo das reservas

**Fase 4 — Reservas**
- [ ] Caixinha Nubank, Cofrinho Inter, Tesouro Direto
- [ ] Fluxo de aporte e resgate via botões

**Fase 5 — Consultas inteligentes (Ollama)**
- [ ] Perguntas em linguagem natural: "quanto gastei em delivery esse mês?"
- [ ] Patrimônio consolidado (contas + reservas)
- [ ] Metas de gastos com alerta ao atingir 80%

**Fase 6 — Automações**
- [ ] Relatório semanal automático via APScheduler

**Fase 7 — Dashboard local**
- [ ] Página HTML + Chart.js com visão por conta, reservas e patrimônio

**Fase 8 — Investimentos (futuro)**
- [ ] Ações, FIIs, Cripto
- [ ] Cotações via yfinance + CoinGecko
