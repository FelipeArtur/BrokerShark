---
name: data-ingestion
description: "Data ingestion, validation, and transformation for bank statements. Use when Gemini CLI needs to import or validate Nubank or Inter CSV files."
---

# Data Ingestion Skill

This skill provides the standard operating procedure for validating and ingesting new CSV bank statements (Nubank and Inter) into the BrokerShark database.

## Workflow

When the user asks you to import new statements or check data integrity:

1.  **Validate Data:** Run the validation script bundled in this skill against the `load_data` directory to ensure all files conform to the expected schemas.
    ```bash
    .venv/bin/python load_data/import_history.py --dry-run
    # AND
    .venv/bin/python scripts/validate_data.py
    ```
    *(Note: If the workspace lacks `scripts/validate_data.py`, you can run the fallback validator bundled in this skill: `.venv/bin/python data-ingestion/data-ingestion/scripts/validate_csv.py`)*

2.  **Review Errors:** If the validation script reports missing columns, invalid dates, or formatting errors, stop and report these to the user. Do not proceed with the import.

3.  **Execute Import:** If validation passes, execute the main import script:
    ```bash
    .venv/bin/python load_data/import_history.py
    ```

## Reference Material

-   **Schemas:** For detailed information on the exact columns and data types required for each bank's CSV export, consult [references/schemas.md](references/schemas.md).
