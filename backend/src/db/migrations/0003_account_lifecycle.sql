-- Conta encerrada é soft-close, nunca DELETE — a mesma forma que investments
-- usa pra posição que sumiu do relatório. `closed_at` afeta o que se tem AGORA
-- (available, patrimônio, destino de import); nunca afeta histórico, porque o
-- dinheiro se moveu de verdade na época.
ALTER TABLE accounts ADD COLUMN opened_at TEXT;
ALTER TABLE accounts ADD COLUMN closed_at TEXT;
