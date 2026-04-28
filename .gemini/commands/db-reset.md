# /db-reset

Wipe all transaction and investment data from the BrokerShark database, keeping seeds intact.

## What it does

1. Deletes all rows from: `transactions`, `investment_movements`, `investments`
2. Resets the SQLite auto-increment sequences for those tables
3. Leaves `accounts` and `categories` untouched (seeds are preserved)

## Steps

Run the following SQL against the database at the path in `backend/config.py` (`DB_PATH`):

```sql
DELETE FROM investment_movements;
DELETE FROM investments;
DELETE FROM transactions;
DELETE FROM sqlite_sequence WHERE name IN ('transactions', 'investment_movements', 'investments');
```

Execute via Python from the `backend/` directory:

```python
import sqlite3, config

with sqlite3.connect(config.DB_PATH) as conn:
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("DELETE FROM investment_movements")
    conn.execute("DELETE FROM investments")
    conn.execute("DELETE FROM transactions")
    conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('transactions','investment_movements','investments')")
    conn.commit()

print("Database wiped. Seeds intact.")
```

## Safety

- Always confirm with the user before running this command.
- Suggest creating a manual backup first: `cp <DB_PATH> <DB_PATH>.bak`
- This operation is irreversible unless a backup exists.
