"""Ports & Adapters — bank statement import interface.

Adding a new bank:
  1. Create ``backend/adapters/<bank>_<type>.py``
  2. Implement ``BankAdapter``
  3. Put CSV files in ``load_data/<folder>/``
  4. Set ``can_handle`` to detect that folder name

No other changes needed — ``load_data/import.py`` discovers adapters automatically.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ParsedRow:
    """Normalised representation of a single bank statement row.

    Produced by a ``BankAdapter`` and consumed by the import orchestrator.
    """

    row_type: str
    """One of: "expense" | "income" | "transfer" | "investment" | "skip"."""

    date: str
    """ISO date string ``YYYY-MM-DD``."""

    description: str
    amount: float
    """Always positive."""

    account_id: str
    """FK to ``accounts.id`` — e.g. ``"nu-db"``."""

    # ── transfer / investment fields ──────────────────────────────────────────
    dest_account_id: str | None = None
    """Destination account for internal transfers."""

    investment_name: str | None = None
    """Human-readable investment name (e.g. "Caixinha Nubank")."""

    operation: str | None = None
    """``"deposit"`` or ``"withdrawal"`` for investment rows."""

    # ── transaction metadata ──────────────────────────────────────────────────
    is_revenue: int = 0
    """1 for real external income; 0 for transfers or internal entries."""

    counterpart: str | None = None
    """``"SELF"`` for self-transfers from untracked accounts (excluded from income totals)."""

    dedup_key: str | None = None
    """Optional external UUID (Nubank extrato ``Identificador``).
    When provided, the orchestrator checks this key before the normal
    ``(date, amount, description, account_id)`` tuple."""

    method: str = "pix"
    """Payment method: ``"pix"``, ``"credit"``, ``"ted"``, ``"transfer"``, etc."""

    installments: int = 1

    category_id: int | None = None


class BankAdapter(ABC):
    """Abstract base for all bank statement parsers.

    Each concrete adapter handles exactly one CSV format from one bank source.
    """

    name: str
    """Short identifier used in log output, e.g. ``"nubank_extrato"``."""

    account_id: str
    """Primary account this adapter writes to, e.g. ``"nu-db"``."""

    @abstractmethod
    def can_handle(self, path: Path) -> bool:
        """Return True if this adapter should process *path*."""

    @abstractmethod
    def parse(self, content: str) -> list[ParsedRow]:
        """Parse *content* (raw file text) and return classified rows.

        Rows classified as ``row_type="skip"`` are counted but not inserted.
        """
