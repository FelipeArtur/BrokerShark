-- BrokerShark v2 schema — dinheiro em CENTAVOS INTEIROS, sempre.
-- Fonte única de DDL. Drizzle entra na fase do servidor via drizzle-kit pull.

CREATE TABLE IF NOT EXISTS migration_log (
    name    TEXT PRIMARY KEY,
    ran_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id                    TEXT PRIMARY KEY,
    bank                  TEXT NOT NULL,
    type                  TEXT NOT NULL CHECK (type IN ('checking', 'credit_card')),
    name                  TEXT NOT NULL,
    initial_balance_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    flow  TEXT NOT NULL CHECK (flow IN ('expense', 'income'))
);

-- Alvo de gasto por categoria. ref_month='' é o alvo fixo (vale todo mês);
-- ref_month='YYYY-MM' sobrescreve só aquele mês. Resolução: override ?? fixo ?? nenhum.
-- '' em vez de NULL de propósito: NULLs são distintos num índice UNIQUE do SQLite,
-- então PK com NULL deixaria cadastrar dois alvos fixos pra mesma categoria.
CREATE TABLE IF NOT EXISTS category_budgets (
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    ref_month    TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    PRIMARY KEY (category_id, ref_month)
);

CREATE TABLE IF NOT EXISTS invoices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    ref_month     TEXT NOT NULL,            -- 'YYYY-MM' (mês da fatura, do nome do arquivo)
    total_cents   INTEGER NOT NULL,         -- soma assinada dos itens
    payment_tx_id INTEGER,                  -- perna de pagamento casada no extrato
    source_file   TEXT,
    UNIQUE (account_id, ref_month)
);

CREATE TABLE IF NOT EXISTS investments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,            -- display, editável
    match_key     TEXT UNIQUE,              -- ISIN (tesouro) | Código (RF) | ticker (ações/BDR)
    code          TEXT,
    type          TEXT NOT NULL,            -- tesouro|cdb|rdb|lci|acao|bdr|fundo|outro
    bank          TEXT NOT NULL,
    indexer       TEXT,                     -- selic|ipca|prefixado|cdi
    rate_text     TEXT,
    maturity_date TEXT,                     -- ISO
    group_name    TEXT,                     -- agrupador visual ("Porquinho")
    source        TEXT NOT NULL CHECK (source IN ('b3', 'ledger', 'manual')),
    opened_at     TEXT,
    closed_at     TEXT                      -- soft-close; nunca DELETE
);

CREATE TABLE IF NOT EXISTS position_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id   INTEGER NOT NULL REFERENCES investments(id),
    ref_date        TEXT NOT NULL,          -- data de referência DO RELATÓRIO
    quantity        REAL,
    unit_price_cents INTEGER,
    applied_cents   INTEGER,                -- Valor Aplicado (custo) — aba Tesouro
    gross_cents     INTEGER,
    net_cents       INTEGER NOT NULL,       -- saldo oficial da posição
    source          TEXT NOT NULL CHECK (source IN ('b3', 'derived', 'manual')),
    import_batch_id TEXT,
    UNIQUE (investment_id, ref_date, source)
);

CREATE TABLE IF NOT EXISTS transactions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    date                  TEXT NOT NULL,     -- ISO YYYY-MM-DD
    flow                  TEXT NOT NULL CHECK (flow IN ('expense', 'income')),
    method                TEXT NOT NULL CHECK (method IN
        ('pix', 'credit', 'ted', 'transfer', 'debit',
         'salary', 'freelance', 'pix_received', 'other')),
    account_id            TEXT NOT NULL REFERENCES accounts(id),
    amount_cents          INTEGER NOT NULL CHECK (amount_cents >= 0),
    description           TEXT NOT NULL,
    category_id           INTEGER REFERENCES categories(id),
    dest_account_id       TEXT REFERENCES accounts(id),
    counterpart           TEXT,              -- 'SELF' = transferência entre contas próprias
    is_revenue            INTEGER NOT NULL DEFAULT 0,
    is_settlement         INTEGER NOT NULL DEFAULT 0, -- 1 = liquidação de fatura (fora dos totais)
    is_third_party        INTEGER NOT NULL DEFAULT 0,
    external_id           TEXT,              -- UUID Nubank (dedup)
    display_name          TEXT,
    original_amount_cents INTEGER,
    import_batch_id       TEXT,
    investment_id         INTEGER REFERENCES investments(id), -- perna ligada à posição
    invoice_id            INTEGER REFERENCES invoices(id),    -- item ou pagamento de fatura
    installment_seq       INTEGER,
    installment_total     INTEGER,
    bank_category         TEXT,              -- categoria dada pelo banco (fatura Inter)
    self_pair_tx_id       INTEGER,           -- perna oposta do pareamento SELF
    source_file           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external_id
    ON transactions(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_date            ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account_date    ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_flow_date       ON transactions(flow, date);
CREATE INDEX IF NOT EXISTS idx_tx_invoice         ON transactions(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_investment      ON transactions(investment_id) WHERE investment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_snap_inv_date      ON position_snapshots(investment_id, ref_date);

CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    matcher     TEXT NOT NULL,               -- substring (lowercase) por enquanto
    match_field TEXT NOT NULL DEFAULT 'description',
    action      TEXT NOT NULL,               -- 'investment_leg'|'category'|'group'|'settlement'
    value       TEXT,                        -- alvo da ação (nome/id)
    priority    INTEGER NOT NULL DEFAULT 100,
    enabled     INTEGER NOT NULL DEFAULT 1
);
