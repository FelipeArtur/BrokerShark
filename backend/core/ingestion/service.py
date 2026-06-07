"""Ingestion orchestration: preview → staging, confirm → transactions.

All DB access here goes through :mod:`core.db.crud` and :mod:`core.db.analytics`
(both patched by the test fixture), keeping this module integration-testable
without touching ``_connect`` directly.
"""
from __future__ import annotations

from typing import Iterable, Optional
from uuid import uuid4

from core.db import analytics, crud
from core.db.crud import STAGING_COLS
from core.ingestion import adapters, dedup
from core.ingestion.adapters import Record, SourceMismatch  # noqa: F401  (re-export)


def _to_staging_dict(rec: Record) -> dict:
    return {f: getattr(rec, f) for f in STAGING_COLS}


def _row_view(row) -> dict:
    """Shape a staging row for the preview table / JSON response."""
    keys = row.keys()

    def g(k):
        return row[k] if k in keys else None

    return {
        "id":              row["id"],
        "date":            row["date"],
        "description":     row["description"],
        "amount":          row["amount"],
        "flow":            row["flow"],
        "method":          row["method"],
        "dest_account_id": row["dest_account_id"],
        "is_revenue":      row["is_revenue"],
        "status":          row["status"],
        "note":            row["note"],
        "category_id":     g("category_id"),
        "display_name":    g("display_name"),
        "original_amount": g("original_amount"),
    }


def preview_import(account_id: str, data: bytes) -> dict:
    """Single-file convenience wrapper over :func:`preview_import_multi`."""
    return preview_import_multi(account_id, [data])


def preview_import_multi(account_id: str, files: list[bytes]) -> dict:
    """Parse + classify one or more uploaded files into a single staged batch.

    All files must belong to the selected account. Dedup runs across the COMBINED
    set — ``dedup.classify`` tracks external-ids and the occurrence budget within the
    batch, so a row duplicated across two files is caught. Returns the batch id,
    per-status counts, the staged rows, and ``amount_divergence`` (0 until the user
    edits a value). Raises :class:`SourceMismatch` if any file doesn't match the account.
    """
    crud.prune_staging(older_than_hours=24)  # drop abandoned previews
    all_records: list[Record] = []
    source = ""  # set per file below; server guards against an empty upload
    for data in files:
        source = adapters.detect_source(account_id, data)  # raises SourceMismatch
        all_records.extend(adapters.parse(account_id, data))

    parsed = [r for r in all_records if r.status != "skipped"]
    ext_ids = [r.external_id for r in parsed if r.external_id]
    existing = analytics.get_existing_external_ids(ext_ids)

    idless_dates = [r.date for r in parsed if not r.external_id and r.date]
    key_counts: dict = {}
    if idless_dates:
        key_counts = analytics.get_key_counts(
            account_id, min(idless_dates), max(idless_dates)
        )

    dedup.classify(all_records, existing, key_counts)

    batch_id = uuid4().hex
    crud.insert_staging_rows(batch_id, source, [_to_staging_dict(r) for r in all_records])
    return get_staging_view(batch_id, source=source, account_id=account_id)


def get_staging_view(batch_id: str, source: Optional[str] = None,
                     account_id: Optional[str] = None) -> dict:
    """Build the preview/staging response: counts, rows, and amount divergence."""
    rows = crud.get_staging_batch(batch_id)
    counts = {"new": 0, "duplicate": 0, "skipped": 0}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    counts["total"] = len(rows)
    return {
        "batch_id":          batch_id,
        "source":            source or (rows[0]["source"] if rows else None),
        "account_id":        account_id,
        "counts":            counts,
        "amount_divergence": crud.staging_divergence(batch_id),
        "rows":              [_row_view(r) for r in rows],
    }


def confirm_import(
    batch_id: str,
    exclude_ids: Optional[Iterable[int]] = None,
    import_batch_id: Optional[str] = None,
    fatura_due: Optional[str] = None,
) -> dict:
    """Promote a batch's 'new' rows to transactions and delete the batch.

    Args:
        batch_id: The token returned by :func:`preview_import`.
        exclude_ids: Staging-row ids the user unchecked in the preview; these are
            skipped even if classified 'new'.
        import_batch_id: Shared session token tagged onto inserted rows so a
            multi-account drop reverses as one unit. Generated when omitted.

    Returns:
        ``{"inserted": int, "skipped": int, "import_batch_id": str}``. ``inserted``
        may be lower than the 'new' count if an ``external_id`` collided at insert
        time (race / re-run).
    """
    # All inserts + the batch delete happen atomically in one transaction
    # (crud.confirm_staging_batch), with a single SSE notify. Imports enter with
    # category_id=NULL — categorize later in the TransactionPanel.
    return crud.confirm_staging_batch(batch_id, set(exclude_ids or ()), import_batch_id, fatura_due)
