# /month-report

Generate a formatted financial report for any month.

## Usage

```
/month-report [YYYY-MM]
```

If no argument is given, defaults to the current month.

## Steps

Run from `backend/` with the project virtualenv active:

```python
import sys, sqlite3, config
from datetime import datetime
from core import database
from bot.utils import _fmt_brl, _PT_MONTHS

arg = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y-%m")
year, month = map(int, arg.split("-"))

summary    = database.get_monthly_summary(year, month)
categories = database.get_expenses_by_category(year, month)
investments = database.get_all_investments()
reservas   = sum(i["current_balance"] for i in investments)

balance = summary["income"] - summary["expenses"]
sign = "+" if balance >= 0 else ""

print(f"\n{'='*40}")
print(f"  {_PT_MONTHS[month]} {year}")
print(f"{'='*40}")
print(f"Receitas:  {_fmt_brl(summary['income'])}")
print(f"Gastos:    {_fmt_brl(summary['expenses'])}")
print(f"Saldo:     {sign}{_fmt_brl(balance)}")
print(f"Reservas:  {_fmt_brl(reservas)}")

if summary.get("top_category"):
    top = summary["top_category"]
    print(f"\nTop categoria: {top['name']} — {_fmt_brl(top['total'])}")

if categories:
    print("\nGastos por categoria:")
    for cat in categories:
        print(f"  {cat['name']:<22} {_fmt_brl(cat['total'])}")

print()
```

## Notes

- This reads directly from SQLite — no bot or dashboard needs to be running.
- To report on Nubank only: pass `bank="nubank"` to the database calls.
