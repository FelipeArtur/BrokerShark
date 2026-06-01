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
    }


def preview_import(account_id: str, data: bytes) -> dict:
    """Parse + classify an uploaded file and stage it for review.

    Returns a summary dict with the batch id, per-status counts, and the staged
    rows (with ids) for the preview table. Raises :class:`SourceMismatch` when
    the file does not match the selected account.
    """
    crud.prune_staging(older_than_hours=24)  # drop abandoned previews
    source = adapters.detect_source(account_id, data)
    records = adapters.parse(account_id, data)

    parsed = [r for r in records if r.status != "skipped"]
    ext_ids = [r.external_id for r in parsed if r.external_id]
    existing = analytics.get_existing_external_ids(ext_ids)

    idless_dates = [r.date for r in parsed if not r.external_id and r.date]
    key_counts: dict = {}
    if idless_dates:
        key_counts = analytics.get_key_counts(
            account_id, min(idless_dates), max(idless_dates)
        )

    dedup.classify(records, existing, key_counts)

    batch_id = uuid4().hex
    crud.insert_staging_rows(batch_id, source, [_to_staging_dict(r) for r in records])

    rows = crud.get_staging_batch(batch_id)
    counts = {"new": 0, "duplicate": 0, "skipped": 0}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    counts["total"] = len(rows)

    return {
        "batch_id":   batch_id,
        "source":     source,
        "account_id": account_id,
        "counts":     counts,
        "rows":       [_row_view(r) for r in rows],
    }


def confirm_import(batch_id: str, exclude_ids: Optional[Iterable[int]] = None) -> dict:
    """Promote a batch's 'new' rows to transactions and delete the batch.

    Args:
        batch_id: The token returned by :func:`preview_import`.
        exclude_ids: Staging-row ids the user unchecked in the preview; these are
            skipped even if classified 'new'.

    Returns:
        ``{"inserted": int, "skipped": int}``. ``inserted`` may be lower than the
        'new' count if an ``external_id`` collided at insert time (race / re-run).
    """
    # All inserts + the batch delete happen atomically in one transaction
    # (crud.confirm_staging_batch), with a single SSE notify. Imports enter with
    # category_id=NULL — categorize later in the TransactionPanel.
    return crud.confirm_staging_batch(batch_id, set(exclude_ids or ()))
