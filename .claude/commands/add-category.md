# /add-category

Add a new expense or income category to the BrokerShark database.

## Usage

```
/add-category <name> <flow>
```

- `name`: Display name (e.g. `"Saúde"`, `"Assinaturas"`)
- `flow`: `expense` or `income`

## Steps

1. Read `backend/core/database.py` to confirm the `categories` table schema.
2. Insert the new category:

```python
import sqlite3, config

name = "<name>"   # replace
flow = "<flow>"   # "expense" or "income"

with sqlite3.connect(config.DB_PATH) as conn:
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("INSERT INTO categories (name, flow) VALUES (?, ?)", (name, flow))
    conn.commit()

print(f"Category '{name}' ({flow}) added.")
```

3. Update `CLAUDE.md` **and** `GEMINI.md` if this is a permanent category being added to the standard seed (`core/db/schema._seed_categories`).

## Notes

- Category names must be unique per flow.
- The dashboard reads categories from the DB at runtime — no restart required
  (the web UI can also do this via Configurações → Categorias, which calls
  `POST /api/categories`).
