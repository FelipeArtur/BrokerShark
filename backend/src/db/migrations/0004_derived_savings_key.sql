-- Renomeia a chave da posição de poupança derivada.
--
-- Ela era `ledger:caixinha-nubank` — o nome do produto de UM banco, gravado
-- dentro do ledger. Quando banco e produto viraram configuração, a chave passou
-- a ser `ledger:derived-savings`: é a POSIÇÃO que é derivada, não o produto.
--
-- Isto não é cosmético. `rederiveSavings` procura a posição por esta chave a
-- cada import da UI. Num ledger que já existia, sem esta migration ele não
-- acharia nada e criaria uma SEGUNDA posição derivada: as mesmas aplicações
-- contariam duas vezes no patrimônio, e o número que o produto inteiro existe
-- pra responder passaria a mentir pra cima.
--
-- Num banco novo não existe linha nenhuma pra renomear, e o UPDATE é no-op.
-- Sem BEGIN/COMMIT — o runner envelopa.

UPDATE investments
SET match_key = 'ledger:derived-savings'
WHERE match_key = 'ledger:caixinha-nubank';
