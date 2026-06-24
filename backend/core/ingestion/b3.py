"""B3 consolidated-report parser — investment positions from ``.xlsx``.

The B3 "relatório consolidado" (monthly/annual) is an ``.xlsx`` with two sheets:
``Posição - Renda Fixa`` (CDB/LCI/…) and ``Posição - Tesouro Direto``. Each row is a
position **snapshot** carrying its current value. We read the most recent report and
upsert each position into the ``investments`` table — one investment per position,
keyed by name (idempotent via :func:`crud.set_investment_balance_by_name`).

Value column chosen per sheet:
- Renda Fixa → ``Valor Atualizado CURVA`` (these CDBs expose no MTM value), gross.
- Tesouro Direto → ``Valor líquido`` (after-tax redemption value).

Security:
- The file is parsed fully in memory (``io.BytesIO``); nothing is extracted to disk,
  so zip-slip (path traversal on extraction) is not a vector.
- openpyxl 3.x parses the inner XML without resolving external entities or fetching
  network resources, so XXE is not exposed. Input size is additionally capped.
- A non-xlsx / corrupt upload raises :class:`B3ParseError`, never an unhandled 500.
"""
from __future__ import annotations

import io
import math
import zipfile
from dataclasses import dataclass
from typing import Optional

from core.db import crud

# Bank/broker exports are a few KB; cap well above that to bound memory and reject
# crafted bombs before openpyxl touches the bytes.
_MAX_BYTES = 16 * 1024 * 1024
# An .xlsx is a zip; a tiny file can declare gigabytes of inner XML (decompression
# bomb). Reject when the uncompressed total is implausibly large before openpyxl
# inflates it. Real B3 reports are well under this.
_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024


class B3ParseError(ValueError):
    """Raised when the upload is not a readable B3 ``.xlsx`` report."""


@dataclass
class B3Position:
    """One investment position read from a B3 report sheet."""
    name: str
    type: str
    bank: str
    balance: float
    code: Optional[str] = None
    maturity: Optional[str] = None
    sheet: str = ""


def _norm(s: object) -> str:
    """Lowercase + collapse whitespace for tolerant header matching."""
    return " ".join(str(s or "").strip().lower().split())


def _bank_from(institution: object) -> str:
    """Map a B3 institution/issuer label to the app's bank key."""
    s = _norm(institution)
    if "inter" in s:
        return "inter"
    if "nu" in s:  # NU INVESTIMENTOS / NUBANK
        return "nubank"
    return "outro"


def _num(value: object) -> Optional[float]:
    """Coerce a B3 cell to a positive float, or ``None`` for ``-``/blank/invalid.

    B3 marks unavailable values with ``"-"``. openpyxl returns numbers as floats
    already; strings (rare) are parsed defensively (BR ``1.234,56`` form tolerated).
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
    else:
        s = str(value).strip().replace("R$", "").replace(" ", "")
        if not s or s == "-":
            return None
        if "," in s:
            s = s.replace(".", "").replace(",", ".")
        try:
            v = float(s)
        except ValueError:
            return None
    if not math.isfinite(v) or v <= 0 or v > 1e12:
        return None
    return round(v, 2)


def _header_map(row: tuple) -> dict[str, int]:
    """Map normalized header text → column index for a sheet's first row."""
    return {_norm(c): i for i, c in enumerate(row) if c is not None and str(c).strip()}


def _col(headers: dict[str, int], *candidates: str) -> Optional[int]:
    """Return the index of the first matching header among ``candidates``."""
    for cand in candidates:
        idx = headers.get(_norm(cand))
        if idx is not None:
            return idx
    return None


def _cell(row: tuple, idx: Optional[int]) -> object:
    """Cell value at ``idx``, or None when the column is absent or the row is short."""
    return row[idx] if idx is not None and idx < len(row) else None


def parse_b3(data: bytes) -> list[B3Position]:
    """Parse B3 report bytes into a list of :class:`B3Position`.

    Raises:
        B3ParseError: if the bytes are not a readable ``.xlsx`` or exceed the size cap.
    """
    if not data:
        raise B3ParseError("arquivo vazio")
    if len(data) > _MAX_BYTES:
        raise B3ParseError("arquivo grande demais")

    # Decompression-bomb guard: sum the zip's declared uncompressed sizes before
    # openpyxl inflates them. zipfile enforces the declared size on read, so a tiny
    # file claiming gigabytes is rejected here instead of OOMing the worker.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if sum(zi.file_size for zi in zf.infolist()) > _MAX_UNCOMPRESSED_BYTES:
                raise B3ParseError("relatório B3 grande demais (descomprimido)")
    except zipfile.BadZipFile as exc:
        raise B3ParseError(f"não é um relatório B3 válido (.xlsx): {exc}") from exc

    # Imported lazily so the rest of core.ingestion stays importable without openpyxl.
    import openpyxl  # noqa: PLC0415
    from openpyxl.utils.exceptions import InvalidFileException  # noqa: PLC0415

    try:
        # read_only is avoided: these reports carry a malformed <dimension> that
        # truncates the read_only cursor to a single cell. Normal mode scans fully.
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=False, data_only=True)
    except (InvalidFileException, zipfile.BadZipFile, OSError, KeyError, ValueError) as exc:
        raise B3ParseError(f"não é um relatório B3 válido (.xlsx): {exc}") from exc

    positions: list[B3Position] = []
    try:
        for ws in wb.worksheets:
            title = _norm(ws.title)
            rows = [r for r in ws.iter_rows(values_only=True)]
            if not rows:
                continue
            headers = _header_map(rows[0])
            if "tesouro" in title:
                positions += _parse_tesouro(rows[1:], headers, ws.title)
            elif "renda fixa" in title:
                positions += _parse_renda_fixa(rows[1:], headers, ws.title)
    finally:
        wb.close()
    return positions


def _parse_renda_fixa(rows: list[tuple], h: dict[str, int], sheet: str) -> list[B3Position]:
    """Parse a "Renda Fixa" sheet — position value = CURVA, falling back to MTM."""
    i_prod = _col(h, "Produto")
    i_inst = _col(h, "Instituição", "Emissor")
    i_code = _col(h, "Código")
    i_venc = _col(h, "Vencimento")
    i_curva = _col(h, "Valor Atualizado CURVA")
    i_mtm = _col(h, "Valor Atualizado MTM")
    out: list[B3Position] = []
    for r in rows:
        product = (str(_cell(r, i_prod)).strip() if _cell(r, i_prod) else "")
        if not product:  # Total / blank rows
            continue
        value = _num(_cell(r, i_curva))
        if value is None:
            value = _num(_cell(r, i_mtm))
        if value is None:
            continue
        code = (str(_cell(r, i_code)).strip() or None) if _cell(r, i_code) else None
        # type = first token of the product ("CDB - BANCO INTER S/A" → "cdb")
        first = _norm(product).split(" ")[0].replace("-", "")
        type_ = first if first.isalpha() else "renda_fixa"
        name = f"{product} ({code})" if code else product
        out.append(B3Position(
            name=name, type=type_, bank=_bank_from(_cell(r, i_inst)),
            balance=value, code=code,
            maturity=(str(_cell(r, i_venc)).strip() or None) if _cell(r, i_venc) else None,
            sheet=sheet,
        ))
    return out


def _parse_tesouro(rows: list[tuple], h: dict[str, int], sheet: str) -> list[B3Position]:
    """Parse a "Tesouro Direto" sheet — position value = Valor líquido, else gross."""
    i_prod = _col(h, "Produto")
    i_inst = _col(h, "Instituição")
    i_venc = _col(h, "Vencimento")
    i_liq = _col(h, "Valor líquido", "Valor liquido")
    i_atual = _col(h, "Valor Atualizado")
    out: list[B3Position] = []
    for r in rows:
        product = (str(_cell(r, i_prod)).strip() if _cell(r, i_prod) else "")
        if not product:
            continue
        value = _num(_cell(r, i_liq))
        if value is None:  # fall back to gross if a líquido cell is blank
            value = _num(_cell(r, i_atual))
        if value is None:
            continue
        out.append(B3Position(
            name=product, type="treasury", bank=_bank_from(_cell(r, i_inst)),
            balance=value,
            maturity=(str(_cell(r, i_venc)).strip() or None) if _cell(r, i_venc) else None,
            sheet=sheet,
        ))
    return out


def load_b3_positions(data: bytes) -> dict:
    """Parse a B3 report and full-sync ``investments`` to match it.

    The report is the source of truth for brokerage positions. Each position is
    upserted keyed by name (idempotent: re-importing updates balances in place),
    then any position absent from the report is pruned (matured/redeemed). Ledger-
    derived pockets (Caixinha/Porquinho) never reach this table, so they survive.
    Returns a summary dict (``created``/``updated``/``removed``/``total``).
    """
    positions = parse_b3(data)
    created = updated = 0
    for p in positions:
        _, was_created = crud.set_investment_balance_by_name(p.name, p.type, p.bank, p.balance)
        created += int(was_created)
        updated += int(not was_created)
    removed = crud.prune_investments_except([p.name for p in positions])
    return {
        "created": created,
        "updated": updated,
        "removed": removed,
        "total": len(positions),
        "positions": [
            {"name": p.name, "type": p.type, "bank": p.bank, "balance": p.balance}
            for p in positions
        ],
    }
