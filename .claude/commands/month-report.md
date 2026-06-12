# /month-report

Generate a formatted financial report for any month.

## Usage

```
/month-report [YYYY-MM]
```

If no argument is given, defaults to the current month.

## Steps

Run from the **project root** (`bootstrap` loads `.env`; PYTHONPATH points at `backend/`):

```bash
PYTHONPATH=backend .venv/bin/python - [YYYY-MM] <<'EOF'
import sys
from datetime import datetime

from bootstrap import bootstrap
bootstrap()

from core import database

PT_MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
             "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

def fmt_brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

arg = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y-%m")
year, month = map(int, arg.split("-"))

summary     = database.get_monthly_summary(year, month)
categories  = database.get_expenses_by_category(year, month)
investments = database.get_all_investments()
reservas    = sum(i["current_balance"] for i in investments)

balance = summary["income"] - summary["expenses"]
sign = "+" if balance >= 0 else ""

print(f"\n{'='*40}")
print(f"  {PT_MONTHS[month]} {year}")
print(f"{'='*40}")
print(f"Receitas:  {fmt_brl(summary['income'])}")
print(f"Gastos:    {fmt_brl(summary['expenses'])}")
print(f"Saldo:     {sign}{fmt_brl(balance)}")
print(f"Reservas:  {fmt_brl(reservas)}")

if summary.get("top_category"):
    top = summary["top_category"]
    print(f"\nTop categoria: {top['name']} — {fmt_brl(top['total'])}")

if categories:
    print("\nGastos por categoria:")
    for cat in categories:
        print(f"  {cat['name']:<22} {fmt_brl(cat['total'])}")

print()
EOF
```

## Notes

- This reads directly from SQLite — the dashboard does not need to be running
  (and reading alongside the live service is safe: SQLite WAL).
- To report on Nubank only: pass `bank="nubank"` to the database calls.
