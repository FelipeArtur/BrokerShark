-- Reduz as categorias de despesa às 6 macro (fundamentadas no gasto real via agy).
-- Reatribui os lançamentos já categorizados e remove as antigas.
-- Sem BEGIN/COMMIT — o runner envelopa.
--
-- MIGRAÇÃO DE DADOS, NÃO ESTRUTURA. Ela existe pra consolidar a taxonomia de um
-- ledger que JÁ EXISTIA com dezenas de categorias soltas. Num banco novo tem que
-- ser no-op completo: desde que o repositório é público, ledger fresh nasce com
-- ZERO categorias, e quem usa cria as suas (ver seeds.ts). Criar as 6 macro aqui
-- empurraria a taxonomia pessoal do autor — "Igreja/Dízimo" inclusive — pra
-- dentro do ledger de qualquer pessoa que clonasse o projeto.
--
-- Daí o `EXISTS (SELECT 1 FROM categories WHERE flow='expense')` em cada INSERT:
-- é o que separa "estou consolidando um ledger antigo" de "estou nascendo".
-- Os UPDATE e o DELETE abaixo já são no-ops naturais numa tabela vazia.
--
-- O NOT EXISTS por nome continua necessário (não dá pra trocar por INSERT OR
-- IGNORE): não há UNIQUE em categories(name, flow), então OR IGNORE não
-- deduplicaria nada e as 6 dobrariam ao rodar sobre uma tabela que já as contém.
INSERT INTO categories (name, flow)
SELECT 'Alimentação', 'expense' WHERE EXISTS (SELECT 1 FROM categories WHERE flow='expense')
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name='Alimentação' AND flow='expense')
UNION ALL
SELECT 'Transporte', 'expense' WHERE EXISTS (SELECT 1 FROM categories WHERE flow='expense')
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name='Transporte' AND flow='expense')
UNION ALL
SELECT 'Saúde e Bem-Estar', 'expense' WHERE EXISTS (SELECT 1 FROM categories WHERE flow='expense')
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name='Saúde e Bem-Estar' AND flow='expense')
UNION ALL
SELECT 'Compras e Lazer', 'expense' WHERE EXISTS (SELECT 1 FROM categories WHERE flow='expense')
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name='Compras e Lazer' AND flow='expense')
UNION ALL
SELECT 'Compromissos e Transferências', 'expense' WHERE EXISTS (SELECT 1 FROM categories WHERE flow='expense')
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
UNION ALL
SELECT 'Igreja/Dízimo', 'expense' WHERE EXISTS (SELECT 1 FROM categories WHERE flow='expense')
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name='Igreja/Dízimo' AND flow='expense');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Transporte' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name='Carro');

-- 'Saúde' é categoria criada pelo usuário (não do seed) — mapeia explícito pro
-- macro certo, senão o catch-all abaixo a jogaria em Compromissos por engano.
UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Saúde e Bem-Estar' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Atividade física','Saúde'));

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compras e Lazer' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Jogos','Lazer','Eletrônicos','Educação'));

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Igreja/Dízimo' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Igreja','Dízimo'));

-- 'Pagamentos' é categoria criada pelo usuário — decisão do usuário: → Compromissos.
UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Eventos / Terceiros','Outro','Pagamentos'));

-- catch-all: qualquer categoria de despesa não-macro que ainda carregue lançamentos
UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
  WHERE category_id IN (
    SELECT id FROM categories WHERE flow='expense' AND name NOT IN
      ('Alimentação','Transporte','Saúde e Bem-Estar','Compras e Lazer','Compromissos e Transferências','Igreja/Dízimo'));

DELETE FROM categories WHERE flow='expense' AND name NOT IN
  ('Alimentação','Transporte','Saúde e Bem-Estar','Compras e Lazer','Compromissos e Transferências','Igreja/Dízimo');
