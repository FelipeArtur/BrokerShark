# /new-parser

Add a CSV parser for a new credit card statement format.

## Usage

```
/new-parser <bank> <account-id>
```

Example: `/new-parser bradesco bradesco-cc`

## Steps

1. **Analyse the CSV format** — ask the user to paste a few sample rows so you can identify:
   - Column names (header row)
   - Date column name and format
   - Amount column name and format (positive = expense, negative = payment/credit)
   - Description column name

2. **Create the parser file** at `backend/bot/parsers/<bank>_cc.py`.

   Follow the exact structure of `backend/bot/parsers/nubank_cc.py` or `inter_cc.py`:
   - Module-level docstring listing expected columns and amount format examples
   - `parse(content: str) -> list[dict[str, Any]]` — returns list of transaction dicts
   - `_normalize_date(raw: str) -> str | None` — converts to `"YYYY-MM-DD"`
   - Each transaction dict must have: `date`, `flow`, `method`, `account_id`, `amount`, `description`, `installments`
   - Skip rows where `amount <= 0` (payments/credits)
   - Skip rows where `description` is empty

3. **Register the parser** in `backend/bot/constants.py`:

```python
from bot.parsers import nubank_cc, inter_cc, <bank>_cc   # add import

PARSER_MAP = {
    "nu-cc":         nubank_cc,
    "inter-cc":      inter_cc,
    "<account-id>":  <bank>_cc,   # add entry
}
```

4. **Add the account seed** in `backend/core/database.py` inside `_seed_accounts()`:

```python
("<account-id>", "<bank>", "credit", "<Display Name>", None, None),
```

   Then run `init_db()` or insert manually so the account exists in the DB.

5. **Expose in the web CSV import flow** — update `backend/dashboard/server.py`:
   - In `POST /api/import-csv/preview`, add the new `account_id` to the account → parser dispatch map
   - The frontend `ImportModal` in `frontend/js/quick-entry.js` already renders all accounts from `/api/accounts`; the new account will appear automatically once seeded

6. **Write tests** for the parser with at least one valid row, one skipped negative row, and one BOM-prefixed row if applicable.
