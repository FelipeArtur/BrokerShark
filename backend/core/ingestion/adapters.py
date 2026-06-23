"""Per-source parsers that turn raw export bytes into normalized records.

Pure module — no database access. Each parser returns a list of :class:`Record`.
Rows that cannot be parsed, or that must not become transactions (credit-card
bill payments, refunds), are returned with ``status="skipped"`` and a ``note``
so the preview can show "Z linhas ignoradas" instead of silently dropping them.

Money is parsed with :class:`~decimal.Decimal` and rounded to 2 places before
being cast to float, so the comma/`R$`/thousands formats never introduce a new
floating-point rounding error during import.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from core.domain import classification

# account_id → adapter key.
ACCOUNT_SOURCE = {
    "nu-db":    "nubank_extrato",
    "inter-db": "inter_extrato",
}
# adapter key → account_id (reverse of ACCOUNT_SOURCE) for content-based detection.
SOURCE_ACCOUNT = {source: account for account, source in ACCOUNT_SOURCE.items()}

@dataclass
class Record:
    """One normalized transaction candidate produced by a parser."""
    date: str                               # ISO "YYYY-MM-DD"
    amount: float                           # always positive
    description: str
    account_id: str
    flow: str = "expense"                   # "expense" | "income"
    method: str = "ted"                     # constrained to the schema CHECK set
    dest_account_id: Optional[str] = None
    external_id: Optional[str] = None
    is_revenue: int = 0
    counterpart: Optional[str] = None       # "SELF" = auto-transfer entre contas do dono
    status: Optional[str] = None            # "skipped" set by parser; else dedup decides
    note: Optional[str] = None


class SourceMismatch(ValueError):
    """Raised when the uploaded file does not match the selected account."""


def parse_money(raw: str) -> float:
    """Parse a BRL amount in any of the export formats into a rounded float.

    Handles point-decimal (Nubank ``-6.19``), comma-decimal (Inter ``182,20``)
    and prefixed/thousands form (``"R$ 1.830,62"``). Raises ``ValueError`` on
    anything unparseable.
    """
    s = (raw or "").strip().replace("R$", "").replace(" ", "").replace(" ", "")
    if not s:
        raise ValueError("empty amount")
    neg = s.startswith("-")
    s = s.lstrip("+-")
    if "," in s:  # Brazilian convention: dot = thousands, comma = decimal
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1:  # dot-only with groups: "1.234.567" → thousands
        s = s.replace(".", "")
    elif "." in s and len(s.rsplit(".", 1)[1]) == 3:
        # Single dot, exactly 3 trailing digits: a thousands separator, not a
        # decimal point ("1.000" → 1000). Bank exports always use 2 decimals,
        # so a 3-digit "fraction" can only be a thousands group.
        s = s.replace(".", "")
    try:
        val = Decimal(s)
        if neg:
            val = -val
        val = val.quantize(Decimal("0.01"))  # may raise InvalidOperation for huge exponents
    except InvalidOperation as exc:
        raise ValueError(f"invalid amount: {raw!r}") from exc
    if abs(val) > Decimal("1e12"):  # reject absurd magnitudes (crafted/garbage rows)
        raise ValueError(f"amount out of range: {raw!r}")
    return float(val)


def parse_date_br(raw: str) -> str:
    """Convert ``DD/MM/YYYY`` to ISO ``YYYY-MM-DD``. Raises ``ValueError`` if invalid."""
    return datetime.strptime(raw.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")


def _norm_desc(raw: str) -> str:
    """Collapse internal whitespace so the dedup content key is stable."""
    return " ".join((raw or "").split())


def _decode(data: bytes) -> str:
    """Decode bytes as UTF-8 (BOM-tolerant), falling back to Latin-1."""
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def _match_source(data: bytes) -> Optional[str]:
    """Return the adapter key whose header signature matches ``data``, or None.

    Single source of truth for the per-source content signatures, shared by
    :func:`detect_source` (verify a chosen account) and :func:`detect_account`
    (guess the account from content). Reads only the first 4 KB.
    """
    head = _decode(data[:4096]).lower()
    if "identificador" in head and "valor" in head:
        return "nubank_extrato"
    if "extrato conta corrente" in head or "data lançamento" in head:
        return "inter_extrato"
    return None


def detect_source(account_id: str, data: bytes) -> str:
    """Return the adapter key for ``account_id`` after verifying the file header.

    Raises:
        SourceMismatch: if the account is unsupported or the header does not look
            like the expected source for that account.
    """
    expected = ACCOUNT_SOURCE.get(account_id)
    if expected is None:
        raise SourceMismatch(f"Conta '{account_id}' não suporta importação ainda.")
    if _match_source(data) != expected:
        raise SourceMismatch(
            f"O arquivo não parece ser um {expected.replace('_', ' ')} de {account_id}."
        )
    return expected


def detect_account(data: bytes) -> Optional[str]:
    """Guess the owning account_id from a CSV's header content, or None.

    Content-based (never filename): lets the import modal pre-fill the account
    per dropped file so a multi-file drop needs no manual assignment. Returns
    None when the header matches no known source — caller falls back to manual.
    """
    source = _match_source(data)
    return SOURCE_ACCOUNT.get(source) if source is not None else None


def parse(account_id: str, data: bytes) -> list[Record]:
    """Detect the source for ``account_id`` and parse ``data`` into records."""
    source = detect_source(account_id, data)
    text = _decode(data)
    if source == "nubank_extrato":
        return _parse_nubank_extrato(text)
    if source == "inter_extrato":
        return _parse_inter_extrato(text)
    raise SourceMismatch(f"Sem parser para a fonte '{source}'.")  # pragma: no cover


def _parse_nubank_extrato(text: str) -> list[Record]:
    """Parse ``Data,Valor,Identificador,Descrição`` (comma, point decimal, UUID)."""
    out: list[Record] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        desc = _norm_desc(row.get("Descrição") or row.get("Descricao") or "")
        ext  = (row.get("Identificador") or "").strip() or None
        try:
            iso = parse_date_br(row["Data"])
            value = parse_money(row["Valor"])
        except (ValueError, KeyError, TypeError):
            out.append(Record(date="", amount=0.0, description=desc,
                               account_id="nu-db", status="skipped",
                               note="linha não reconhecida", external_id=ext))
            continue
        rec = Record(
            date=iso, amount=abs(value), description=desc,
            account_id="nu-db", external_id=ext,
        )
        if classification.is_investment(desc):
            rec.method = "transfer"
            rec.is_revenue = 0
            rec.flow = "income" if value >= 0 else "expense"
            rec.note = "movimento de investimento"
        elif classification.is_self_transfer(desc):
            rec.counterpart = "SELF"
            rec.is_revenue = 0
            rec.note = "transferência entre contas próprias"
            if value >= 0:
                rec.flow = "income"
                rec.method = "pix" if "pix" in desc.lower() else "ted"
            else:
                rec.flow, rec.method = "expense", "transfer"
        elif value >= 0:
            rec.flow = "income"
            rec.is_revenue = 1
            rec.method = "pix" if "pix" in desc.lower() else "ted"
        else:
            rec.flow = "expense"
            rec.is_revenue = 0
            rec.method = classification.checking_expense_method(desc)
        out.append(rec)
    return out


def _parse_inter_extrato(text: str) -> list[Record]:
    """Parse Inter checking export: semicolon, 5 preamble lines, comma decimal."""
    out: list[Record] = []
    lines = text.splitlines()
    start = _find_header(lines, "data lançamento")
    if start is None:
        return out
    reader = csv.reader(io.StringIO("\n".join(lines[start + 1:])), delimiter=";")
    for cols in reader:
        if len(cols) < 3 or not (cols[0].strip()):
            continue
        raw_date, raw_desc, raw_val = cols[0], cols[1], cols[2]
        desc = _norm_desc(raw_desc)
        try:
            iso = parse_date_br(raw_date)
            value = parse_money(raw_val)
        except ValueError:
            out.append(Record(date="", amount=0.0, description=desc,
                               account_id="inter-db", status="skipped",
                               note="linha não reconhecida"))
            continue
        rec = Record(date=iso, amount=abs(value), description=desc, account_id="inter-db")
        if classification.is_investment(desc):
            # Porquinho Inter (aplicação/resgate/estorno): fluxo de investimento,
            # não consumo nem receita. Mantém o saldo, fica fora dos totais.
            rec.method = "transfer"
            rec.is_revenue = 0
            rec.flow = "income" if value >= 0 else "expense"
            rec.note = "movimento de investimento"
        elif classification.is_self_transfer(desc):
            rec.counterpart = "SELF"
            rec.is_revenue = 0
            rec.note = "transferência entre contas próprias"
            if value >= 0:
                rec.flow = "income"
                rec.method = "pix" if "pix" in desc.lower() else "ted"
            else:
                rec.flow, rec.method = "expense", "transfer"
        elif value >= 0:
            rec.flow, rec.is_revenue = "income", 1
            rec.method = "pix" if "pix" in desc.lower() else "ted"
        else:
            rec.flow = "expense"
            rec.method = classification.checking_expense_method(desc)
        out.append(rec)
    return out


def _find_header(lines: list[str], needle: str) -> Optional[int]:
    """Return the index of the first line containing ``needle`` (case-insensitive)."""
    for i, line in enumerate(lines):
        if needle in line.lower():
            return i
    return None
