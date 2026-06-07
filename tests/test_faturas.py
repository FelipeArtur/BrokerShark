"""Regression tests for credit-card fatura cycle / due-date logic.

The due date is the first occurrence of ``due_day`` AFTER the cycle closes
(``billing_day``). Bug fixed: when ``due_day > billing_day`` (Inter: closes 18,
due 25) the due date must land in the SAME month as the close, not month+1.
"""
import sqlite3
from datetime import datetime

from core.db import analytics


def _set_billing(db, account_id, billing_day, due_day):
    with sqlite3.connect(db) as raw:
        cur = raw.execute(
            "UPDATE accounts SET billing_day=?, due_day=? WHERE id=?",
            (billing_day, due_day, account_id),
        )
        assert cur.rowcount == 1, f"account {account_id} not seeded"


def _d(s):  # "dd/mm/yyyy" -> datetime
    return datetime.strptime(s, "%d/%m/%Y")


def test_due_date_same_month_when_due_after_close(db):
    """[REGRESSION] closes day 18, due day 25 → due is SAME month as close."""
    _set_billing(db, "inter-cc", 18, 25)
    info = analytics.get_credit_card_billing_info("inter-cc")
    close, due = _d(info["cycle_end"]), _d(info["due_date"])
    assert due.day == 25
    assert (due.year, due.month) == (close.year, close.month)  # NOT month+1 (the bug)
    assert due > close


def test_due_date_next_month_when_due_before_close(db):
    """Legacy regime: closes day 24, due day 1 → due is the FOLLOWING month."""
    _set_billing(db, "inter-cc", 24, 1)
    info = analytics.get_credit_card_billing_info("inter-cc")
    close, due = _d(info["cycle_end"]), _d(info["due_date"])
    assert due.day == 1
    assert due > close
    assert due.month == close.month % 12 + 1  # month after close (Dec→Jan wraps)


def test_cycle_window_anchored_on_billing_day(db):
    """cycle_start is the day after a billing_day; cycle_end is a billing_day."""
    _set_billing(db, "inter-cc", 18, 25)
    info = analytics.get_credit_card_billing_info("inter-cc")
    assert _d(info["cycle_end"]).day == 18
    assert _d(info["cycle_start"]).day == 19  # day after the previous close
