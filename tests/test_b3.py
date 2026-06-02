"""Tests for the B3 .xlsx investment-position parser and loader."""
import io

import pytest


def _make_b3_xlsx() -> bytes:
    """Build a minimal B3-shaped workbook (Renda Fixa + Tesouro) in memory."""
    import openpyxl
    wb = openpyxl.Workbook()
    rf = wb.active
    rf.title = "Posição - Renda Fixa"
    rf.append(["Produto", "Instituição", "Emissor", "Código", "Indexador",
               "Tipo de regime", "Data de Emissão", "Vencimento", "Quantidade",
               "Quantidade Disponível", "Quantidade Indisponível", "Motivo",
               "Contraparte", "Preço Atualizado MTM", "Valor Atualizado MTM",
               "Preço Atualizado CURVA", "Valor Atualizado CURVA"])
    rf.append(["CDB - BANCO INTER S/A", "BANCO INTER S/A", "BANCO INTER S/A",
               "CDB4266TIEN", "-", "REGISTRADO", "13/04/2026", "03/04/2028",
               11978, 11978, "-", "-", "-", "-", "-", 0.01006531, 120.56])
    rf.append([""] * 14 + ["Total", "", "Total"])  # total row → skipped
    rf.append([""] * 14 + ["-", "", 120.56])

    td = wb.create_sheet("Posição - Tesouro Direto")
    td.append(["Produto", "Instituição", "Código ISIN", "Indexador", "Vencimento",
               "Quantidade", "Quantidade Disponível", "Quantidade Indisponível",
               "Motivo", "Valor Aplicado", "Valor bruto", "Valor líquido",
               "Valor Atualizado"])
    td.append(["Tesouro IPCA+ 2029", "NU INVESTIMENTOS S.A. - CTVM", "BRSTNCNTB6A3",
               "IPCA", "15/05/2029", 0.05, 0.05, 0, "-", 140.56, 186.68, 178.74, 186.68])
    td.append([""] * 12 + ["Total"])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_b3_positions():
    from core.ingestion import b3
    positions = b3.parse_b3(_make_b3_xlsx())
    by_name = {p.name: p for p in positions}

    # One investment per position, total rows skipped
    assert len(positions) == 2

    cdb = by_name["CDB - BANCO INTER S/A (CDB4266TIEN)"]
    assert cdb.bank == "inter"
    assert cdb.type == "cdb"
    assert cdb.balance == 120.56  # CURVA value (MTM is "-")
    assert cdb.code == "CDB4266TIEN"

    td = by_name["Tesouro IPCA+ 2029"]
    assert td.bank == "nubank"
    assert td.type == "treasury"
    assert td.balance == 178.74  # Valor líquido (not gross 186.68)


def test_parse_b3_rejects_non_xlsx():
    from core.ingestion import b3
    with pytest.raises(b3.B3ParseError):
        b3.parse_b3(b"this is not a zip/xlsx file")


def test_parse_b3_rejects_empty():
    from core.ingestion import b3
    with pytest.raises(b3.B3ParseError):
        b3.parse_b3(b"")


def test_load_b3_positions_upserts(db):
    from core.ingestion import b3
    from core.db import analytics

    res = b3.load_b3_positions(_make_b3_xlsx())
    assert res["created"] == 2 and res["updated"] == 0

    invs = {i["name"]: i for i in analytics.get_all_investments()}
    assert invs["Tesouro IPCA+ 2029"]["current_balance"] == 178.74
    assert invs["CDB - BANCO INTER S/A (CDB4266TIEN)"]["current_balance"] == 120.56


def test_load_b3_positions_idempotent(db):
    from core.ingestion import b3
    from core.db import analytics

    b3.load_b3_positions(_make_b3_xlsx())
    res2 = b3.load_b3_positions(_make_b3_xlsx())  # re-run same report
    # No duplicates: second run updates in place.
    assert res2["created"] == 0 and res2["updated"] == 2
    assert len(analytics.get_all_investments()) == 2
