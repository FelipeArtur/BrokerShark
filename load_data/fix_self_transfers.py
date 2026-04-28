"""One-time migration: reclassify self-transfers between own accounts.

Run from project root:
    .venv/bin/python load_data/fix_self_transfers.py

What this does:
  1. nu-db → inter-db outgoing expenses: sets dest_account_id='inter-db'
     (identified by 'BANCO INTER' + 'FELIPE ARTUR' in description)
  2. inter-db → nu-db outgoing expenses: sets dest_account_id='nu-db'
     (identified by 'FELIPE ARTUR' in description on inter-db)
  3. Deletes inter-db income entries that are nu-db→inter-db transfers
     (inb.total mechanism takes over for inter-db balance after step 1)
  4. Marks nu-db income from external self-transfers with counterpart='SELF'
     (from Bradesco, BB, PicPay, Easynvest — stays as income for balance,
     excluded from income summaries via counterpart filter)
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import config

with sqlite3.connect(config.DB_PATH) as conn:
    conn.execute("PRAGMA foreign_keys=ON")

    # 1. nu-db → inter-db: mark outgoing expenses as internal transfers
    r1 = conn.execute("""
        UPDATE transactions
        SET dest_account_id = 'inter-db'
        WHERE account_id = 'nu-db'
          AND flow = 'expense'
          AND dest_account_id IS NULL
          AND description LIKE '%BANCO INTER%'
          AND description LIKE '%FELIPE ARTUR%'
    """)
    print(f"[1] nu-db outgoing → inter-db: {r1.rowcount} rows updated")

    # 2. inter-db → nu-db: mark outgoing expenses as internal transfers
    r2 = conn.execute("""
        UPDATE transactions
        SET dest_account_id = 'nu-db'
        WHERE account_id = 'inter-db'
          AND flow = 'expense'
          AND dest_account_id IS NULL
          AND description LIKE '%FELIPE ARTUR%'
    """)
    print(f"[2] inter-db outgoing → nu-db: {r2.rowcount} rows updated")

    # 3. Delete inter-db income entries that are now covered by inb.total
    r3 = conn.execute("""
        DELETE FROM transactions
        WHERE account_id = 'inter-db'
          AND flow = 'income'
          AND description LIKE '%FELIPE ARTUR%'
    """)
    print(f"[3] inter-db income deleted: {r3.rowcount} rows")

    # 4. Mark nu-db income from external self-transfers (Bradesco, BB, etc.)
    r4 = conn.execute("""
        UPDATE transactions
        SET counterpart = 'SELF'
        WHERE account_id = 'nu-db'
          AND flow = 'income'
          AND description LIKE '%FELIPE ARTUR%'
    """)
    print(f"[4] nu-db income marked as self-transfer: {r4.rowcount} rows")

    conn.commit()

print("\nVerification:")
with sqlite3.connect(config.DB_PATH) as conn:
    remaining_income_self = conn.execute(
        "SELECT COUNT(*) FROM transactions WHERE flow='income' AND description LIKE '%FELIPE ARTUR%' AND counterpart IS NULL"
    ).fetchone()[0]
    print(f"  income entries with FELIPE ARTUR and counterpart IS NULL: {remaining_income_self}  (expected: 0)")

    unlinked_outgoing = conn.execute(
        "SELECT COUNT(*) FROM transactions WHERE flow='expense' AND description LIKE '%FELIPE ARTUR%' AND dest_account_id IS NULL"
    ).fetchone()[0]
    print(f"  outgoing self-transfers without dest_account_id: {unlinked_outgoing}  (expected: 0)")

    income_total = conn.execute(
        "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE flow='income' AND (counterpart IS NULL OR counterpart != 'SELF') AND dest_account_id IS NULL"
    ).fetchone()[0]
    print(f"  effective income total (excl. self-transfers): R${income_total:,.2f}")

print("\nDone.")
