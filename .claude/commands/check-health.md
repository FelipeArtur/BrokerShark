# /check-health

Run a quick health check on the BrokerShark system.

## What it checks

1. **Database** — file exists, WAL mode active, all tables present, row counts
2. **Accounts** — all 4 seed accounts present (`nu-cc`, `nu-db`, `inter-cc`, `inter-db`)
3. **Integrity** — no `is_revenue` NULLs on income rows
4. **Config** — env vars set (no values printed) + backup HDD mounted
5. **Service** — dashboard service active + HTTP GET to `/api/summary`
6. **Backup** — latest snapshots on the HDD

## Script

Run from the **project root** (`bootstrap` loads `.env`):

```bash
PYTHONPATH=backend .venv/bin/python - <<'EOF'
import os, sqlite3, urllib.request
from pathlib import Path
from bootstrap import bootstrap  # noqa: F401 — load_dotenv at import time
import config

db = Path(config.DB_PATH)
print(f"DB exists: {db.exists()} ({db.stat().st_size // 1024} KB)" if db.exists() else "DB MISSING")

with sqlite3.connect(config.DB_PATH) as conn:
    conn.row_factory = sqlite3.Row
    print(f"WAL mode: {conn.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'}")
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    expected = {"accounts","categories","transactions","investments",
                "investment_movements","budgets","import_staging"}
    print(f"Tables OK: {expected.issubset(tables)}")
    for t in sorted(expected):
        print(f"  {t}: {conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]} rows")
    accs = {r[0] for r in conn.execute("SELECT id FROM accounts")}
    print(f"Seed accounts OK: {accs >= {'nu-cc','nu-db','inter-cc','inter-db'}}")
    q = "SELECT COUNT(*) FROM transactions WHERE flow='income' AND is_revenue IS NULL"
    print(f"is_revenue NULLs (should be 0): {conn.execute(q).fetchone()[0]}")

for var in ["DB_PATH", "DASHBOARD_PORT", "OWNER_SELF_KEYWORDS"]:
    print(f"  {var}: {'set' if os.getenv(var) else 'default/MISSING'}")
print(f"  LOCAL_BACKUP_DIR mounted: {Path(config.LOCAL_BACKUP_DIR).is_dir()}")

try:
    r = urllib.request.urlopen(f"http://127.0.0.1:{config.DASHBOARD_PORT}/api/summary", timeout=2)
    print(f"Dashboard: OK ({r.status})")
except Exception as e:
    print(f"Dashboard: not reachable ({e})")
EOF
```

Then check the always-on runtime and the backup freshness:

```bash
systemctl --user is-active brokershark-dashboard.service   # active
systemctl --user list-timers 'brokershark-*'               # backup timer scheduled
systemctl --user --failed                                  # empty = no failed backup
ls -t /mnt/HDD_Arquivos/Backups/brokershark/ | head -3     # today's daily snapshot
```

## Expected output (healthy system)

```
DB exists: True (X KB)
WAL mode: True
Tables OK: True
  accounts: 4 rows
  budgets: N rows
  categories: 15 rows
  import_staging: N rows   (transient — nonzero only with an unconfirmed preview)
  investment_movements: N rows
  investments: N rows
  transactions: N rows
Seed accounts OK: True
is_revenue NULLs (should be 0): 0
  DB_PATH: set
  ...
  LOCAL_BACKUP_DIR mounted: True
Dashboard: OK (200)
```

## Notes

- Reading the DB alongside the live service is safe (SQLite WAL).
- `unrecognized_log` may exist in older DBs — it is inert (creation removed in
  `5c9733c`); its presence or absence is not a health signal.
- Dashboard not reachable → `journalctl --user -u brokershark-dashboard -n 30`.
