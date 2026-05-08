# /load-data

Importa os dados históricos de extratos e faturas para o banco de dados do BrokerShark.

## O que faz

Processa os arquivos CSV da pasta `load_data/` em 4 etapas:

1. **Nubank extrato** — `Extrato completo Nubank/*.csv` (conta corrente nu-db)
2. **Nubank CC faturas** — `Fatura Nubank/*.csv` (cartão de crédito nu-cc)
3. **Inter CC faturas** — `Fatura banco Inter/*.csv` (cartão de crédito inter-cc)
4. **Inter extrato** — `Extrato completo Inter/*.csv` (conta corrente inter-db)

Duplicatas são detectadas por `(date, amount, description, account_id)` e ignoradas automaticamente.

## Uso

```
/load-data
```

Se quiser simular sem gravar no banco:
```
/load-data --dry-run
```

## Executar

```bash
.venv/bin/python load_data/import_history.py $ARGUMENTS
```

Onde `$ARGUMENTS` pode ser `--dry-run` ou vazio.

## Pastas de dados

```
load_data/
├── Extrato completo Nubank/   ← extrato Nubank conta corrente (nu-db)
├── Fatura Nubank/             ← faturas Nubank CC mensais (nu-cc) ← adicionar aqui
├── Fatura banco Inter/        ← faturas Inter CC mensais (inter-cc)
└── Extrato completo Inter/    ← extrato Inter conta corrente (inter-db)
```

## Regra anti-duplicação: Nubank CC

**Não remova os "Pagamento da fatura" do extrato Nubank (nu-db).**

O sistema usa dois níveis de dado para o cartão Nubank:

| Dado | Onde fica | Para que serve |
|---|---|---|
| Pagamento da fatura (total mensal) | nu-db, `dest_account_id='nu-cc'` | Reduz o saldo da conta corrente no cálculo de patrimônio |
| Compras individuais | nu-cc (faturas importadas) | Aparece nas despesas mensais com a data real da compra |

Esses dois nunca entram em conflito porque:
- O resumo mensal de despesas usa `dest_account_id IS NULL` → exclui o pagamento de fatura do nu-db automaticamente
- O patrimônio usa `dest_account_id IN ('nu-cc','inter-cc')` → inclui o pagamento de fatura como saída de caixa real
- O parser `nubank_cc.py` já pula linhas com `amount <= 0` (pagamentos/estornos) → o "Pagamento da fatura" que aparece no export do CC nunca é importado

## Erros

Erros de formato são logados em `logs/import_errors.log` e não interrompem o import.
Arquivos ausentes ou pastas vazias são ignorados com aviso.
