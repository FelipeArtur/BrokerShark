-- Reduz as categorias de despesa às 6 macro (fundamentadas no gasto real via agy).
-- Reatribui os lançamentos já categorizados e remove as antigas. No-op num DB fresh
-- (o seed já cria as 6). Sem BEGIN/COMMIT — o runner envelopa.

-- guardado por NOT EXISTS (não INSERT OR IGNORE): nem o schema de teste nem o
-- schema.sql real têm UNIQUE em categories(name, flow), então OR IGNORE não
-- dedupllica nada — duplicaria as 6 macro toda vez que rodasse sobre uma tabela
-- que já as contém (ex.: seed roda antes OU depois desta migration, a depender
-- do caller — ver backfill.ts vs. os testes de rota).
INSERT INTO categories (name, flow)
SELECT 'Alimentação', 'expense' WHERE NOT EXISTS
  (SELECT 1 FROM categories WHERE name='Alimentação' AND flow='expense')
UNION ALL
SELECT 'Transporte', 'expense' WHERE NOT EXISTS
  (SELECT 1 FROM categories WHERE name='Transporte' AND flow='expense')
UNION ALL
SELECT 'Saúde e Bem-Estar', 'expense' WHERE NOT EXISTS
  (SELECT 1 FROM categories WHERE name='Saúde e Bem-Estar' AND flow='expense')
UNION ALL
SELECT 'Compras e Lazer', 'expense' WHERE NOT EXISTS
  (SELECT 1 FROM categories WHERE name='Compras e Lazer' AND flow='expense')
UNION ALL
SELECT 'Compromissos e Transferências', 'expense' WHERE NOT EXISTS
  (SELECT 1 FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
UNION ALL
SELECT 'Igreja/Dízimo', 'expense' WHERE NOT EXISTS
  (SELECT 1 FROM categories WHERE name='Igreja/Dízimo' AND flow='expense');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Transporte' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name='Carro');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Saúde e Bem-Estar' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name='Atividade física');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compras e Lazer' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Jogos','Lazer','Eletrônicos','Educação'));

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Igreja/Dízimo' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Igreja','Dízimo'));

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Eventos / Terceiros','Outro'));

-- catch-all: qualquer categoria de despesa não-macro que ainda carregue lançamentos
UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
  WHERE category_id IN (
    SELECT id FROM categories WHERE flow='expense' AND name NOT IN
      ('Alimentação','Transporte','Saúde e Bem-Estar','Compras e Lazer','Compromissos e Transferências','Igreja/Dízimo'));

DELETE FROM categories WHERE flow='expense' AND name NOT IN
  ('Alimentação','Transporte','Saúde e Bem-Estar','Compras e Lazer','Compromissos e Transferências','Igreja/Dízimo');
