"""Tests for the file ingestion pipeline — parsers, dedup, preview/confirm."""
import pytest


# ── Sample export fixtures (real formats, trimmed) ────────────────────────────

NUBANK_EXTRATO = (
    "Data,Valor,Identificador,Descrição\n"
    "05/01/2026,4200.00,uuid-salary,Transferência Recebida - ACME\n"
    "05/01/2026,-2000.00,uuid-rdb,Aplicação RDB\n"
    "02/01/2026,139.32,uuid-nuinvest,Transferência de saldo NuInvest\n"
    "10/01/2026,-50.00,uuid-pix,Pix - Padaria do Bairro\n"
).encode("utf-8")

INTER_EXTRATO = (
    "Extrato Conta Corrente \n"
    "Conta ;12345678\n"
    "Período ;01/01/2025 a 31/05/2026\n"
    "Saldo: ;131,75\n"
    "\n"
    "Data Lançamento;Descrição;Valor;Saldo\n"
    "20/10/2025;Pix recebido: Cp Joao;182,20;182,20\n"
    "29/10/2025;Pagamento efetuado: Pagamento fatura cartao Inter;-95,47;6,64\n"
    "31/10/2025;Pix enviado: Maria;-15,00;100,00\n"
    "31/10/2025;Pix enviado: Maria;-15,00;85,00\n"
).encode("utf-8")

INTER_FATURA = (
    '"Data","Lançamento","Categoria","Tipo","Valor"\n'
    '"25/05/2026","GarfoDeOuro SALVADOR","SUPERMERCADO","Compra à vista","R$ 9,50"\n'
    '"25/05/2026","PAGAMENTO ON LINE","OUTROS","Compra à vista","R$ 1.830,62"\n'
).encode("utf-8")


# ── parse_money ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("-6.19", -6.19), ("4200.00", 4200.0), ("182,20", 182.2),
    ("R$ 1.830,62", 1830.62), ("R$ 9,50", 9.5), ("-15,00", -15.0),
    # dot-only thousands separator (no comma): must not collapse to a fraction
    ("1.000", 1000.0), ("100.000", 100000.0), ("1.234.567", 1234567.0),
    ("-2.500", -2500.0), ("1830.62", 1830.62),  # 2-digit fraction stays decimal
])
def test_parse_money(raw, expected):
    from core.ingestion.adapters import parse_money
    assert parse_money(raw) == expected


@pytest.mark.parametrize("bad", ["abc", "1E999999999", "9" * 20])
def test_parse_money_invalid(bad):
    from core.ingestion.adapters import parse_money
    with pytest.raises(ValueError):  # never InvalidOperation / never a 500
        parse_money(bad)


# ── Parsers ───────────────────────────────────────────────────────────────────

def test_nubank_investment_rows_are_transfers():
    from core.ingestion import adapters
    recs = {r.description: r for r in adapters.parse("nu-db", NUBANK_EXTRATO)}

    salary = recs["Transferência Recebida - ACME"]
    assert salary.flow == "income" and salary.is_revenue == 1

    rdb = recs["Aplicação RDB"]
    assert rdb.flow == "expense" and rdb.method == "transfer" and rdb.is_revenue == 0

    nuinvest = recs["Transferência de saldo NuInvest"]
    assert nuinvest.flow == "income" and nuinvest.method == "transfer"
    assert nuinvest.is_revenue == 0  # redemption must not inflate receitas

    pix = recs["Pix - Padaria do Bairro"]
    assert pix.flow == "expense" and pix.method == "pix" and pix.amount == 50.0


def test_self_transfer_rows_marked_not_income_expense():
    """Auto-Pix/TED entre contas do dono → counterpart='SELF', fora de receita/despesa."""
    from core.ingestion import adapters
    extrato = (
        "Data,Valor,Identificador,Descrição\n"
        "26/03/2026,-1400.00,uuid-st-out,Transferência enviada pelo Pix - Joao Da Silva Souza\n"
        "27/03/2026,1400.00,uuid-st-in,Pix recebido: Cp Joao Da Silva Souza\n"
        "28/03/2026,100.00,uuid-est,Estorno: CDB Porquinho Joao Da Silva Souza\n"
        "29/03/2026,500.00,uuid-real,Transferência Recebida - ACME\n"
    ).encode("utf-8")
    recs = {r.description: r for r in adapters.parse("nu-db", extrato)}

    out = recs["Transferência enviada pelo Pix - Joao Da Silva Souza"]
    assert out.flow == "expense" and out.method == "transfer" and out.counterpart == "SELF"

    inc = recs["Pix recebido: Cp Joao Da Silva Souza"]
    assert inc.flow == "income" and inc.is_revenue == 0 and inc.counterpart == "SELF"

    # Estorno de investimento carrega o nome do dono, mas NÃO é auto-Pix (guard cdb/estorno)
    est = recs["Estorno: CDB Porquinho Joao Da Silva Souza"]
    assert est.counterpart is None

    # Receita real de terceiro não é afetada
    real = recs["Transferência Recebida - ACME"]
    assert real.flow == "income" and real.is_revenue == 1 and real.counterpart is None


def test_inter_extrato_fatura_payment_routes_to_card():
    from core.ingestion import adapters
    recs = adapters.parse("inter-db", INTER_EXTRATO)
    fatura = [r for r in recs if "fatura" in r.description.lower()][0]
    assert fatura.method == "transfer" and fatura.dest_account_id == "inter-cc"
    pix_in = [r for r in recs if "recebido" in r.description.lower()][0]
    assert pix_in.flow == "income" and pix_in.is_revenue == 1


def test_inter_fatura_skips_payment_keeps_purchase():
    from core.ingestion import adapters
    recs = adapters.parse("inter-cc", INTER_FATURA)
    purchase = [r for r in recs if "garfodeouro" in r.description.lower()][0]
    payment  = [r for r in recs if "pagamento" in r.description.lower()][0]
    assert purchase.flow == "expense" and purchase.method == "credit"
    assert payment.status == "skipped"


def test_source_mismatch_rejected():
    from core.ingestion import adapters
    with pytest.raises(adapters.SourceMismatch):
        adapters.parse("inter-cc", NUBANK_EXTRATO)  # wrong file for the account


# ── Dedup classification (pure) ───────────────────────────────────────────────

def test_inter_legit_duplicate_preserved():
    from core.ingestion import adapters, dedup
    recs = [r for r in adapters.parse("inter-db", INTER_EXTRATO) if r.status != "skipped"]
    dedup.classify(recs, existing_external_ids=set(), key_counts={})
    rosa = [r for r in recs if "maria" in r.description.lower()]
    assert len(rosa) == 2 and all(r.status == "new" for r in rosa)


def test_inter_occurrence_dedup_against_existing():
    from core.ingestion import adapters, dedup
    recs = [r for r in adapters.parse("inter-db", INTER_EXTRATO) if r.status != "skipped"]
    # Pretend one of the two identical Maria rows already exists in the DB.
    # classify keys on (date, round(amount, 2), description) with amount positive.
    key = ("2025-10-31", 15.0, "Pix enviado: Maria")
    dedup.classify(recs, existing_external_ids=set(), key_counts={key: 1})
    rosa = [r for r in recs if "maria" in r.description.lower()]
    statuses = sorted(r.status for r in rosa)
    assert statuses == ["duplicate", "new"]


# ── preview + confirm (integration, uses db fixture) ──────────────────────────

def test_preview_confirm_and_idempotency(db):
    from core import ingestion
    from core.db import analytics

    preview = ingestion.preview_import("nu-db", NUBANK_EXTRATO)
    assert preview["counts"]["new"] == 4
    assert preview["counts"]["duplicate"] == 0

    res = ingestion.confirm_import(preview["batch_id"])
    assert res["inserted"] == 4

    # Income headline counts the salary but NOT the NuInvest redemption.
    summary = analytics.get_monthly_summary(2026, 1)
    assert summary["income"] == 4200.0
    # Despesas headline counts the Pix purchase but NOT the RDB application
    # (method='transfer' is never consumption).
    assert summary["expenses"] == 50.0

    # Account balance reflects the real cash movement (incl. investment legs).
    bal = analytics.get_account_balance("nu-db")
    assert round(bal, 2) == round(4200.0 - 2000.0 + 139.32 - 50.0, 2)

    # Re-import the same file → everything already exists, nothing new.
    again = ingestion.preview_import("nu-db", NUBANK_EXTRATO)
    assert again["counts"]["new"] == 0
    assert again["counts"]["duplicate"] == 4


def test_confirm_missing_batch(db):
    from core import ingestion
    res = ingestion.confirm_import("does-not-exist")
    assert res.get("missing") is True


def test_inter_cumulative_reupload(db):
    """Re-uploading the cumulative Inter file adds only the new tail."""
    from core import ingestion

    first = ingestion.preview_import("inter-db", INTER_EXTRATO)
    assert first["counts"]["new"] == 4  # 1 pix-in, 1 fatura, 2 maria
    ingestion.confirm_import(first["batch_id"])

    # Same file again → nothing new.
    same = ingestion.preview_import("inter-db", INTER_EXTRATO)
    assert same["counts"]["new"] == 0
    assert same["counts"]["duplicate"] == 4

    # Cumulative export with one extra transaction → only the tail is new.
    plus = INTER_EXTRATO + b"02/11/2025;Pix enviado: Mercado;-42,00;98,64\n"
    res = ingestion.preview_import("inter-db", plus)
    assert res["counts"]["new"] == 1
    assert res["counts"]["duplicate"] == 4


def test_confirm_atomic_single_notify(db, monkeypatch):
    """confirm fires events.notify exactly once and clears the batch atomically."""
    from core import ingestion
    from core.db import crud
    import core.events as events_mod

    calls = {"n": 0}
    monkeypatch.setattr(events_mod, "notify", lambda: calls.__setitem__("n", calls["n"] + 1))

    preview = ingestion.preview_import("nu-db", NUBANK_EXTRATO)
    calls["n"] = 0  # ignore anything before confirm
    res = ingestion.confirm_import(preview["batch_id"])

    assert res["inserted"] == 4
    assert calls["n"] == 1, "must notify once, not once per row"
    assert crud.get_staging_batch(preview["batch_id"]) == []  # batch cleared


def test_cashflow_excludes_transfer(db):
    """Money-story expense_total excludes the RDB application (method=transfer)."""
    from core import ingestion
    from core.db import analytics

    ingestion.confirm_import(ingestion.preview_import("nu-db", NUBANK_EXTRATO)["batch_id"])
    cf = analytics.get_cashflow_statement(1, 2026)
    assert cf["expense_total"] == 50.0  # only the Pix purchase, not the -2000 RDB
