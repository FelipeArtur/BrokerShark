"""Pure dedup classification — assigns 'new' | 'duplicate' to parsed records.

No database access: callers pass in the existing-state lookups (the set of
external_ids already stored, and the per-content-key occurrence counts). This
keeps the logic trivially unit-testable and lets the DB layer stay patchable.

Two strategies:
  • external_id present (Nubank) → duplicate iff the id is already stored, or
    already seen earlier in this same batch.
  • no external_id (Inter) → occurrence counting on (date, amount, description):
    the first N rows that match N already-stored rows are duplicates; anything
    beyond that is new. This makes a re-uploaded cumulative file add only its
    new tail, while preserving a genuine same-day/same-amount duplicate.
"""
from __future__ import annotations

from core.ingestion.adapters import Record


def _content_key(rec: Record) -> tuple:
    return (rec.date, round(rec.amount, 2), rec.description)


def classify(
    records: list[Record],
    existing_external_ids: set[str],
    key_counts: dict[tuple, int],
) -> list[Record]:
    """Set ``status`` to 'new' or 'duplicate' on every non-skipped record.

    Mutates and returns the same list. Skipped records (set by the parser) are
    left untouched. ``key_counts`` is treated as a consumable budget of
    already-stored rows per content key.
    """
    seen_ext: set[str] = set()
    remaining = dict(key_counts)  # consumed as duplicates are matched

    for rec in records:
        if rec.status == "skipped":
            continue
        if rec.external_id:
            if rec.external_id in existing_external_ids or rec.external_id in seen_ext:
                rec.status = "duplicate"
            else:
                rec.status = "new"
                seen_ext.add(rec.external_id)
            continue
        key = _content_key(rec)
        if remaining.get(key, 0) > 0:
            rec.status = "duplicate"
            remaining[key] -= 1
        else:
            rec.status = "new"
    return records
