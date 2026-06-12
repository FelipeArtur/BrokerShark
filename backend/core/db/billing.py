"""Credit-card billing cycle math: closing day (``billing_day``) → fatura vencimento.

Pure date helpers shared by the read layer (``analytics`` groups/sums purchases by
fatura) and the write layer (``crud`` stamps each imported purchase with its fatura on
insert). Kept in their own module so neither side imports the other.

The bill closes on ``billing_day`` and the vencimento is a few days later. When
``due_day > billing_day`` the vencimento lands in the SAME month as the close (Inter:
closes day 18, due day 25); otherwise it falls in the following month.
"""
from __future__ import annotations

from datetime import date, timedelta


def billing_cycle_for_due(due_d: date, billing_day: int, due_day: int) -> tuple[date, date]:
    """Return the purchase cycle ``[start, end]`` (end = closing date) for a fatura due on ``due_d``.

    The cycle runs from the day after the previous close through this close. Used to bound
    a fatura's addable candidates to its real cycle.
    """
    bd = min(billing_day, 28)
    if due_day > billing_day:
        cycle_end = due_d.replace(day=bd)
    else:
        first = due_d.replace(day=1)
        cycle_end = (first - timedelta(days=1)).replace(day=bd)
    if cycle_end.month == 1:
        prev_close = cycle_end.replace(year=cycle_end.year - 1, month=12, day=bd)
    else:
        prev_close = cycle_end.replace(month=cycle_end.month - 1, day=bd)
    return prev_close + timedelta(days=1), cycle_end


def vencimento_for_date(d: date, billing_day: int, due_day: int) -> date:
    """Inverse of :func:`billing_cycle_for_due`: the vencimento of the fatura a purchase
    dated ``d`` belongs to. The bill closes on the first ``billing_day`` on/after ``d``;
    the vencimento is a few days later. Lets a multi-month fatura export split into the
    right monthly bills by date, and the Histórico bucket untagged rows into their cycle.
    """
    bd = min(billing_day, 28)
    dd = min(due_day, 28)
    if d.day <= bd:
        close = d.replace(day=bd)
    elif d.month == 12:
        close = d.replace(year=d.year + 1, month=1, day=bd)
    else:
        close = d.replace(month=d.month + 1, day=bd)
    if due_day > billing_day:
        return close.replace(day=dd)
    if close.month == 12:
        return close.replace(year=close.year + 1, month=1, day=dd)
    return close.replace(month=close.month + 1, day=dd)
