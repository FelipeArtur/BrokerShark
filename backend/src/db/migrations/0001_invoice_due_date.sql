-- Adiciona due_date (vencimento) às faturas.
-- Preenchida no import da fatura ABERTA pela UI; histórico já pago fica NULL.
-- UI-only: morre no backfill --force (backfill não tem fonte de vencimento).
-- Baseline (schema.sql) fica CONGELADO — não adicionar due_date lá (M6), senão
-- DB novo daria "duplicate column" no boot. Sem BEGIN/COMMIT (o runner envelopa).
ALTER TABLE invoices ADD COLUMN due_date TEXT;
