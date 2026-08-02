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

CREATE TABLE IF NOT EXISTS category_budgets (
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    ref_month    TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    PRIMARY KEY (category_id, ref_month)
);

CREATE TABLE IF NOT EXISTS invoices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    ref_month     TEXT NOT NULL,
    total_cents   INTEGER NOT NULL,
    payment_tx_id INTEGER,
    source_file   TEXT,
    UNIQUE (account_id, ref_month)
);

CREATE TABLE IF NOT EXISTS investments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    match_key     TEXT UNIQUE,
    code          TEXT,
    type          TEXT NOT NULL,
    bank          TEXT NOT NULL,
    indexer       TEXT,
    rate_text     TEXT,
    maturity_date TEXT,
    group_name    TEXT,
    source        TEXT NOT NULL CHECK (source IN ('b3', 'ledger', 'manual')),
    opened_at     TEXT,
    closed_at     TEXT
);

CREATE TABLE IF NOT EXISTS position_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id   INTEGER NOT NULL REFERENCES investments(id),
    ref_date        TEXT NOT NULL,
    quantity        REAL,
    unit_price_cents INTEGER,
    applied_cents   INTEGER,
    gross_cents     INTEGER,
    net_cents       INTEGER NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('b3', 'derived', 'manual')),
    import_batch_id TEXT,
    UNIQUE (investment_id, ref_date, source)
);

CREATE TABLE IF NOT EXISTS transactions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    date                  TEXT NOT NULL,
    flow                  TEXT NOT NULL CHECK (flow IN ('expense', 'income')),
    method                TEXT NOT NULL CHECK (method IN
        ('pix', 'credit', 'ted', 'transfer', 'debit',
         'salary', 'freelance', 'pix_received', 'other')),
    account_id            TEXT NOT NULL REFERENCES accounts(id),
    amount_cents          INTEGER NOT NULL CHECK (amount_cents >= 0),
    description           TEXT NOT NULL,
    category_id           INTEGER REFERENCES categories(id),
    dest_account_id       TEXT REFERENCES accounts(id),
    counterpart           TEXT,
    is_revenue            INTEGER NOT NULL DEFAULT 0,
    is_settlement         INTEGER NOT NULL DEFAULT 0,
    is_third_party        INTEGER NOT NULL DEFAULT 0,
    external_id           TEXT,
    display_name          TEXT,
    original_amount_cents INTEGER,
    import_batch_id       TEXT,
    investment_id         INTEGER REFERENCES investments(id),
    invoice_id            INTEGER REFERENCES invoices(id),
    installment_seq       INTEGER,
    installment_total     INTEGER,
    bank_category         TEXT,
    self_pair_tx_id       INTEGER,
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
    matcher     TEXT NOT NULL,
    match_field TEXT NOT NULL DEFAULT 'description',
    action      TEXT NOT NULL,
    value       TEXT,
    priority    INTEGER NOT NULL DEFAULT 100,
    enabled     INTEGER NOT NULL DEFAULT 1
);

-- Recorrência DECLARADA: você aponta um lançamento e diz "isto se repete todo
-- mês". Tabela nova em vez de coluna em `transactions` porque é aditivo simples
-- (a disciplina do baseline manda preferir tabela nova) e porque a marca é
-- decisão de quem usa, não dado do extrato: separada, fica óbvio o que o
-- backfill recria e o que ele jamais poderia recriar.
--
-- Nada de valor nem de dia guardados aqui: os dois saem do lançamento apontado.
-- Copiá-los criaria uma segunda verdade que envelhece sozinha.
CREATE TABLE IF NOT EXISTS recurring_marks (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
