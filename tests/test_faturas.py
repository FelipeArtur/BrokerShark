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


def test_open_fatura_from_import_tag_beats_date_window(db):
    """[REGRESSION] open fatura = sum of the next-due tagged purchases (bank grouping).

    The killer case a date-window can't handle: two purchases on the SAME day that
    belong to DIFFERENT bills (e.g. a recurring charge billed to the next cycle).
    """
    import sqlite3
    from datetime import date, timedelta

    due = (date.today() + timedelta(days=10)).strftime("%Y-%m-%d")
    prev_due = (date.today() - timedelta(days=20)).strftime("%Y-%m-%d")
    with sqlite3.connect(db) as raw:
        for amt, fd in [(100.0, due), (313.48, prev_due), (129.0, due)]:
            raw.execute(
                """INSERT INTO transactions
                   (date, flow, method, account_id, amount, installments,
                    description, dest_account_id, is_revenue, fatura_due)
                   VALUES (?,?,?,?,?,1,?,NULL,0,?)""",
                ("2026-05-16", "expense", "credit", "inter-cc", amt, "compra", fd),
            )
    info = analytics.get_credit_card_billing_info("inter-cc")
    assert info["source"] == "import"
    assert info["total"] == 229.0       # 100 + 129 (next due) — NOT the same-date 313.48
    assert info["last_total"] == 313.48  # previous bill
    assert _d(info["due_date"]) == datetime.strptime(due, "%Y-%m-%d")


INTER_FATURA = (
    '"Data","Lançamento","Categoria","Tipo","Valor"\n'
    '"16/05/2026","COMPRA A SALVADOR","OUTROS","Compra à vista","R$ 100,00"\n'
    '"02/06/2026","COMPRA B SALVADOR","OUTROS","Compra à vista","R$ 50,00"\n'
).encode("utf-8")


def test_confirm_import_tags_fatura_due_end_to_end(db):
    """Importing a fatura with a vencimento tags its purchases → bank-grouped total."""
    from datetime import date, timedelta

    from core import ingestion

    due_iso = (date.today() + timedelta(days=15)).strftime("%Y-%m-%d")
    preview = ingestion.preview_import("inter-cc", INTER_FATURA)
    res = ingestion.confirm_import(preview["batch_id"], fatura_due=due_iso)
    assert res["inserted"] == 2

    with sqlite3.connect(db) as raw:
        tags = [r[0] for r in raw.execute(
            "SELECT fatura_due FROM transactions WHERE account_id='inter-cc'")]
        assert tags == [due_iso, due_iso]

    info = analytics.get_credit_card_billing_info("inter-cc")
    assert info["source"] == "import"
    assert info["total"] == 150.0
    assert _d(info["due_date"]) == datetime.strptime(due_iso, "%Y-%m-%d")


def test_import_autosplits_then_reimport_override_retags(db):
    """First import auto-assigns each purchase to its monthly fatura by cycle (16/05 →
    25/05, 02/06 → 25/06). Re-importing with an explicit override dedups (inserted=0) but
    still re-stamps every matching purchase onto the forced vencimento — membership
    follows the re-imported bill (the original re-tag regression, now on the auto base)."""
    from datetime import date, timedelta

    from core import ingestion

    # 1) sem override → auto-split por ciclo (fechamento 18, vence 25)
    ingestion.confirm_import(ingestion.preview_import("inter-cc", INTER_FATURA)["batch_id"])
    with sqlite3.connect(db) as raw:
        tags = sorted(r[0] for r in
                      raw.execute("SELECT fatura_due FROM transactions WHERE account_id='inter-cc'"))
        assert tags == ["2026-05-25", "2026-06-25"]

    # 2) re-import com override → dedup (nada novo) mas re-carimba todas p/ o due forçado
    due = (date.today() + timedelta(days=15)).strftime("%Y-%m-%d")
    res = ingestion.confirm_import(
        ingestion.preview_import("inter-cc", INTER_FATURA)["batch_id"], fatura_due=due)
    assert res["inserted"] == 0  # all duplicates — nothing new inserted
    with sqlite3.connect(db) as raw:
        assert [r[0] for r in
                raw.execute("SELECT fatura_due FROM transactions WHERE account_id='inter-cc'")] == [due, due]


def test_cycle_window_anchored_on_billing_day(db):
    """cycle_start is the day after a billing_day; cycle_end is a billing_day."""
    _set_billing(db, "inter-cc", 18, 25)
    info = analytics.get_credit_card_billing_info("inter-cc")
    assert _d(info["cycle_end"]).day == 18
    assert _d(info["cycle_start"]).day == 19  # day after the previous close
