# /check-health

Run a quick health check on the BrokerShark system.

## What it checks

1. **Database** — file exists, WAL mode active, all tables present, row counts
2. **Accounts** — all 4 seed accounts present (`nu-cc`, `nu-db`, `inter-cc`, `inter-db`)
3. **Categories** — at least the 10 expense and 5 income seeds present
4. **Investments** — list current balances
5. **Dashboard** — HTTP GET to `http://127.0.0.1:8080/api/summary` (if running)
6. **Config** — confirm required env vars are set (no values printed)

## Script

Run from `backend/` with the project virtualenv active:

```python
import sqlite3, os, config
from pathlib import Path

db = Path(config.DB_PATH)
print(f"DB exists: {db.exists()} ({db.stat().st_size // 1024} KB)" if db.exists() else "DB MISSING")

with sqlite3.connect(config.DB_PATH) as conn:
    conn.row_factory = sqlite3.Row
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    print(f"WAL mode: {mode == 'wal'}")

    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    expected = {"accounts","categories","transactions","investments","investment_movements","budgets","unrecognized_log"}
    print(f"Tables OK: {expected.issubset(set(tables))}")

    for t in ["accounts","categories","transactions","investments","investment_movements","budgets"]:
        n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n} rows")

    is_rev_ok = conn.execute("SELECT COUNT(*) FROM transactions WHERE flow='income' AND is_revenue IS NULL").fetchone()[0]
    print(f"  is_revenue NULLs (should be 0): {is_rev_ok}")

for var in ["TELEGRAM_TOKEN","TELEGRAM_CHAT_ID","DB_PATH","LOCAL_BACKUP_DIR","GOOGLE_CREDENTIALS","OLLAMA_URL"]:
    print(f"  {var}: {'set' if os.getenv(var) else 'MISSING'}")

try:
    import urllib.request
    r = urllib.request.urlopen("http://127.0.0.1:8080/api/summary", timeout=2)
    print(f"Dashboard: OK ({r.status})")
except Exception as e:
    print(f"Dashboard: not reachable ({e})")
```

## Expected output (healthy system)

```
DB exists: True (X KB)
WAL mode: True
Tables OK: True
  accounts: 4 rows
  categories: 15 rows
  transactions: N rows
  investments: 3 rows
  investment_movements: N rows
  budgets: N rows
  is_revenue NULLs (should be 0): 0
  TELEGRAM_TOKEN: set
  LOCAL_BACKUP_DIR: set
  GOOGLE_CREDENTIALS: set
  OLLAMA_URL: set
  ...
Dashboard: OK (200)
```
