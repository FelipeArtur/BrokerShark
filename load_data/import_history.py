"""Standalone script to import historical financial data into BrokerShark's SQLite DB.

Processes:
  - Nubank extrato (conta corrente) — Extrato completo Nubank/*.csv
  - Inter CC faturas (cartão de crédito) — Fatura banco Inter/*.csv
  - Inter extrato (conta corrente) — Extrato completo Inter/*.csv

Run from the project root:
    .venv/bin/python load_data/import_history.py
    .venv/bin/python load_data/import_history.py --dry-run   # preview only, no DB writes
"""
import argparse
import csv
import io
import logging
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Allow importing backend modules without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import config
from core import database
from bot.parsers import inter_cc, nubank_cc

BASE_DIR = Path(__file__).parent
DB_PATH = config.DB_PATH

Path("logs").mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("logs/import_errors.log"),
    ],
)
_logger = logging.getLogger(__name__)

DRY_RUN: bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_br_value(text: str) -> float:
    """Convert a Brazilian-formatted number to float.

    Handles formats such as "1.400,20", "-80,09", "R$ 230,80".
    """
    cleaned = (
        text.strip()
        .replace("R$", "")
        .replace("\xa0", "")
        .strip()
        .replace(".", "")
        .replace(",", ".")
    )
    return float(cleaned)


def _normalize_date(raw: str) -> Optional[str]:
    """Convert DD/MM/YYYY or YYYY-MM-DD to ISO YYYY-MM-DD."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _get_category_id(name: str, flow: str) -> Optional[int]:
    """Return the category_id for a given name and flow, or None if not found."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id FROM categories WHERE name = ? AND flow = ?", (name, flow)
        ).fetchone()
        return row["id"] if row else None


def _investment_movement_exists(
    date: str, investment_id: int, operation: str, amount: float
) -> bool:
    """Return True if an identical investment movement already exists."""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """SELECT 1 FROM investment_movements
               WHERE date=? AND investment_id=? AND operation=? AND amount=?""",
            (date, investment_id, operation, amount),
        ).fetchone()
        return row is not None


# ── Nubank extrato ────────────────────────────────────────────────────────────

def _classify_nubank_extrato(description: str, valor: float) -> dict | None:
    """Classify a single Nubank extrato row.

    Returns a dict for insert_transaction, a dict with key "investment" for
    investment movements, or None to skip.
    """
    desc_lower = description.lower()

    # Credit card payments — transfer from nu-db to nu-cc (not a spending expense)
    if "pagamento de fatura" in desc_lower or "pagamento da fatura" in desc_lower:
        return {
            "flow": "expense",
            "method": "transfer",
            "account_id": "nu-db",
            "amount": abs(valor),
            "dest_account_id": "nu-cc",
            "category_name": None,
            "category_flow": None,
        }

    # Investment movements
    if description == "Aplicação RDB":
        return {"investment": True, "operation": "deposit", "amount": abs(valor)}
    if description == "Resgate RDB":
        return {"investment": True, "operation": "withdrawal", "amount": abs(valor)}
    if "dinheiro guardado" in desc_lower:
        return {"investment": True, "operation": "deposit", "amount": abs(valor)}

    if valor > 0:
        # Self-transfer received from own Inter account — skip (inb.total handles balance)
        if "felipe artur macedo" in desc_lower and "banco inter" in desc_lower:
            return None
        # Self-transfer from any own account — keep as income for balance, mark counterpart
        if "felipe artur macedo" in desc_lower:
            if desc_lower.startswith("transferência recebida"):
                method = "pix_received"
            else:
                method = "other"
            return {
                "flow": "income",
                "method": method,
                "account_id": "nu-db",
                "amount": valor,
                "category_name": "PIX recebido",
                "category_flow": "income",
                "counterpart": "SELF",
            }
        if desc_lower.startswith("transferência recebida"):
            method = "pix_received"
            category = "PIX recebido"
        else:
            method = "other"
            category = "Outro"
        return {
            "flow": "income",
            "method": method,
            "account_id": "nu-db",
            "amount": valor,
            "category_name": category,
            "category_flow": "income",
        }

    if valor < 0:
        # Self-transfer sent to own Inter account
        if "felipe artur macedo" in desc_lower and "banco inter" in desc_lower:
            return {
                "flow": "expense",
                "method": "transfer",
                "account_id": "nu-db",
                "amount": abs(valor),
                "dest_account_id": "inter-db",
                "category_name": None,
                "category_flow": None,
            }
        if desc_lower.startswith("transferência enviada pelo pix"):
            method = "pix"
        elif desc_lower.startswith("transferência enviada"):
            method = "ted"
        elif "nupay" in desc_lower or "débito via nupay" in desc_lower:
            method = "pix"
        else:
            method = "pix"
        return {
            "flow": "expense",
            "method": method,
            "account_id": "nu-db",
            "amount": abs(valor),
            "category_name": "Outro",
            "category_flow": "expense",
        }

    return None  # valor == 0


def import_nubank_extrato(data_dir: Path) -> tuple[int, int, int, int]:
    """Import all Nubank extrato CSVs. Returns (imported, skipped_dup, investments, errors)."""
    folder = data_dir / "Extrato completo Nubank"
    files = sorted(folder.glob("*.csv"))

    cat_cache: dict[tuple[str, str], Optional[int]] = {}
    existing = database.get_investment_by_name("Caixinha Nubank")
    caixinha_id = existing["id"] if existing else database.upsert_investment("Caixinha Nubank", "savings", "nubank")

    imported = skipped = inv_imported = errors = 0

    for filepath in files:
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"  [WARN] Não foi possível ler {filepath.name}: {e}")
            continue

        reader = csv.DictReader(io.StringIO(content))
        for row in reader:
            try:
                date = _normalize_date(row.get("Data", ""))
                if not date:
                    continue

                raw_valor = row.get("Valor", "").strip()
                if not raw_valor:
                    continue
                valor = float(raw_valor)

                description = row.get("Descrição", "").strip()
                if not description:
                    continue

                result = _classify_nubank_extrato(description, valor)
                if result is None:
                    skipped += 1
                    continue

                if result.get("investment"):
                    operation = result["operation"]
                    amount = result["amount"]
                    if not _investment_movement_exists(date, caixinha_id, operation, amount):
                        if not DRY_RUN:
                            database.insert_investment_movement(
                                date, caixinha_id, operation, amount
                            )
                        inv_imported += 1
                    else:
                        skipped += 1
                    continue

                flow          = result["flow"]
                method        = result["method"]
                account_id    = result["account_id"]
                amount        = result["amount"]
                dest_account  = result.get("dest_account_id")
                counterpart   = result.get("counterpart")
                cat_key       = (result["category_name"], result["category_flow"])
                category_id   = None
                if cat_key != (None, None):
                    if cat_key not in cat_cache:
                        cat_cache[cat_key] = _get_category_id(*cat_key)
                    category_id = cat_cache[cat_key]

                if database.transaction_exists(date, amount, description, account_id):
                    skipped += 1
                    continue

                if not DRY_RUN:
                    database.insert_transaction(
                        date=date,
                        flow=flow,
                        method=method,
                        account_id=account_id,
                        amount=amount,
                        description=description,
                        installments=1,
                        category_id=category_id,
                        dest_account_id=dest_account,
                        counterpart=counterpart,
                        is_revenue=1 if flow == "income" and dest_account is None and counterpart != "SELF" else 0,
                    )
                imported += 1

            except Exception as exc:
                _logger.warning("Nubank extrato — erro em %s linha %r: %s", filepath.name, row, exc)
                errors += 1
                continue

    return imported, skipped, inv_imported, errors


# ── Inter CC faturas ──────────────────────────────────────────────────────────

def import_inter_cc_faturas(data_dir: Path) -> tuple[int, int, int]:
    """Import all Inter CC fatura CSVs. Returns (imported, skipped_dup, errors)."""
    folder = data_dir / "Fatura banco Inter"
    files = sorted(folder.glob("*.csv"))

    if not files:
        _logger.info("Fatura banco Inter/ — nenhum arquivo encontrado.")
        return 0, 0, 0

    category_id = _get_category_id("Outro", "expense")
    imported = skipped = errors = 0

    for filepath in files:
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            _logger.warning("Não foi possível ler %s: %s", filepath.name, e)
            errors += 1
            continue

        # adjust_installment_dates=False: each monthly fatura already has each
        # installment in its correct billing month — no forward date shift needed.
        try:
            transactions = inter_cc.parse(content, adjust_installment_dates=False)
        except Exception as e:
            _logger.warning("Erro ao parsear %s: %s", filepath.name, e)
            errors += 1
            continue

        for tx in transactions:
            if database.transaction_exists(
                tx["date"], tx["amount"], tx["description"], tx["account_id"]
            ):
                skipped += 1
                continue

            if not DRY_RUN:
                database.insert_transaction(
                    date=tx["date"],
                    flow=tx["flow"],
                    method=tx["method"],
                    account_id=tx["account_id"],
                    amount=tx["amount"],
                    description=tx["description"],
                    installments=tx.get("installments", 1),
                    category_id=category_id,
                    is_revenue=1 if tx["flow"] == "income" else 0,
                )
            imported += 1

    return imported, skipped, errors


# ── Nubank CC faturas ─────────────────────────────────────────────────────────

def import_nubank_cc_faturas(data_dir: Path) -> tuple[int, int, int]:
    """Import all Nubank CC fatura CSVs. Returns (imported, skipped_dup, errors).

    Anti-duplication guarantee
    --------------------------
    The Nubank extrato (nu-db) already contains one "Pagamento da fatura" entry
    per billing cycle stored as ``flow='expense', dest_account_id='nu-cc'``.
    That entry covers the *total* amount paid and is used by the patrimônio
    calculation to reduce the checking-account balance.

    The individual purchases imported here go into ``account_id='nu-cc'`` with
    ``dest_account_id=None``.  Monthly expense summaries only count
    ``dest_account_id IS NULL``, so the fatura-payment row in nu-db is
    automatically excluded — no double-counting occurs.

    Do NOT remove "Pagamento da fatura" rows from nu-db; they are needed for
    the patrimônio calculation.  The nubank_cc parser already skips negative /
    zero-amount rows (payments/refunds), so the fatura payment that appears in
    the CC export is never imported.
    """
    folder = data_dir / "Fatura Nubank"
    files = sorted(folder.glob("*.csv"))

    if not files:
        _logger.info("Fatura Nubank/ — nenhum arquivo encontrado.")
        return 0, 0, 0

    category_id = _get_category_id("Outro", "expense")
    imported = skipped = errors = 0

    for filepath in files:
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            _logger.warning("Não foi possível ler %s: %s", filepath.name, e)
            errors += 1
            continue

        try:
            transactions = nubank_cc.parse(content)
        except Exception as e:
            _logger.warning("Erro ao parsear %s: %s", filepath.name, e)
            errors += 1
            continue

        for tx in transactions:
            if database.transaction_exists(
                tx["date"], tx["amount"], tx["description"], tx["account_id"]
            ):
                skipped += 1
                continue

            if not DRY_RUN:
                database.insert_transaction(
                    date=tx["date"],
                    flow=tx["flow"],
                    method=tx["method"],
                    account_id=tx["account_id"],
                    amount=tx["amount"],
                    description=tx["description"],
                    installments=tx.get("installments", 1),
                    category_id=category_id,
                )
            imported += 1

    return imported, skipped, errors


# ── Inter extrato ─────────────────────────────────────────────────────────────

def _classify_inter_extrato(description: str, valor: float) -> dict | None:
    """Classify a single Inter extrato row."""
    desc_lower = description.lower()

    # Credit card payments — transfer from inter-db to inter-cc
    if desc_lower.startswith("pagamento efetuado") and "fatura" in desc_lower:
        return {
            "flow": "expense",
            "method": "transfer",
            "account_id": "inter-db",
            "amount": abs(valor),
            "dest_account_id": "inter-cc",
            "category_name": None,
            "category_flow": None,
        }

    # Investment movements — Porquinho Inter
    is_porquinho = "porquinho" in desc_lower or "cdb porq" in desc_lower
    if ("aplicacao" in desc_lower or "cdb porq" in desc_lower) and is_porquinho and "resgate" not in desc_lower and "estorno" not in desc_lower:
        return {"investment": True, "operation": "deposit", "amount": abs(valor)}
    if ("resgate" in desc_lower or "estorno" in desc_lower) and is_porquinho:
        return {"investment": True, "operation": "withdrawal", "amount": abs(valor)}

    if valor > 0:
        # Self-transfer received from own Nubank account — skip (inb.total handles balance)
        if "felipe artur macedo" in desc_lower:
            return None
        if desc_lower.startswith("pix recebido"):
            method = "pix_received"
            category = "PIX recebido"
        else:
            method = "transfer"
            category = "Transferência"
        return {
            "flow": "income",
            "method": method,
            "account_id": "inter-db",
            "amount": valor,
            "category_name": category,
            "category_flow": "income",
        }

    if valor < 0:
        # Self-transfer sent to own Nubank account
        if "felipe artur macedo" in desc_lower:
            return {
                "flow": "expense",
                "method": "transfer",
                "account_id": "inter-db",
                "amount": abs(valor),
                "dest_account_id": "nu-db",
                "category_name": None,
                "category_flow": None,
            }
        if desc_lower.startswith("pix enviado"):
            method = "pix"
        else:
            method = "pix"
        return {
            "flow": "expense",
            "method": method,
            "account_id": "inter-db",
            "amount": abs(valor),
            "category_name": "Outro",
            "category_flow": "expense",
        }

    return None


def import_inter_extrato(data_dir: Path) -> tuple[int, int, int, int]:
    """Import the Inter extrato CSV. Returns (imported, skipped_dup, investments, errors)."""
    folder = data_dir / "Extrato completo Inter"
    files = list(folder.glob("*.csv"))

    if not files:
        _logger.info("Extrato completo Inter/ — nenhum arquivo encontrado.")
        return 0, 0, 0, 0

    cat_cache: dict[tuple[str, str], Optional[int]] = {}
    existing = database.get_investment_by_name("Porquinho Inter")
    porquinho_id = existing["id"] if existing else database.upsert_investment("Porquinho Inter", "savings", "inter")

    imported = skipped = inv_imported = errors = 0

    for filepath in files:
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"  [WARN] Não foi possível ler {filepath.name}: {e}")
            continue

        lines = content.splitlines()

        # Skip the Inter extrato header block (first 5 lines are metadata)
        data_start = 0
        for i, line in enumerate(lines):
            if line.startswith("Data Lançamento") or line.startswith("Data La"):
                data_start = i
                break

        data_lines = "\n".join(lines[data_start:])
        reader = csv.DictReader(io.StringIO(data_lines), delimiter=";")

        for row in reader:
            try:
                raw_date = (row.get("Data Lançamento") or row.get("Data La") or "").strip()
                date = _normalize_date(raw_date)
                if not date:
                    continue

                raw_valor = row.get("Valor", "").strip()
                if not raw_valor:
                    continue
                valor = _parse_br_value(raw_valor)

                description = row.get("Descrição", "").strip()
                if not description:
                    continue

                result = _classify_inter_extrato(description, valor)
                if result is None:
                    skipped += 1
                    continue

                if result.get("investment"):
                    operation = result["operation"]
                    amount = result["amount"]
                    if not _investment_movement_exists(date, porquinho_id, operation, amount):
                        if not DRY_RUN:
                            database.insert_investment_movement(
                                date, porquinho_id, operation, amount
                            )
                        inv_imported += 1
                    else:
                        skipped += 1
                    continue

                flow         = result["flow"]
                method       = result["method"]
                account_id   = result["account_id"]
                amount       = result["amount"]
                dest_account = result.get("dest_account_id")
                cat_key      = (result["category_name"], result["category_flow"])
                category_id  = None
                if cat_key != (None, None):
                    if cat_key not in cat_cache:
                        cat_cache[cat_key] = _get_category_id(*cat_key)
                    category_id = cat_cache[cat_key]

                if database.transaction_exists(date, amount, description, account_id):
                    skipped += 1
                    continue

                if not DRY_RUN:
                    database.insert_transaction(
                        date=date,
                        flow=flow,
                        method=method,
                        account_id=account_id,
                        amount=amount,
                        description=description,
                        installments=1,
                        category_id=category_id,
                        dest_account_id=dest_account,
                        is_revenue=1 if flow == "income" and dest_account is None else 0,
                    )
                imported += 1

            except Exception as exc:
                _logger.warning("Inter extrato — erro em %s linha %r: %s", filepath.name, row, exc)
                errors += 1
                continue

    return imported, skipped, inv_imported, errors


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> dict:
    """Run the full historical import. Returns a summary dict with counters."""
    global DRY_RUN

    parser = argparse.ArgumentParser(description="BrokerShark — importação de dados históricos")
    parser.add_argument("--dry-run", action="store_true", help="Simula o import sem gravar no banco")
    args = parser.parse_args()
    DRY_RUN = args.dry_run

    database.init_db()

    label = " [DRY RUN — nenhuma gravação]" if DRY_RUN else ""
    print(f"BrokerShark — Importação de dados históricos{label}")
    print("=" * 55)

    nu_folder = BASE_DIR / "Extrato completo Nubank"
    if not nu_folder.exists() or not list(nu_folder.glob("*.csv")):
        print("\n[1/4] Nubank extrato — pasta vazia ou não encontrada, pulando.")
        nu_imp = nu_skip = nu_inv = nu_err = 0
    else:
        print("\n[1/4] Nubank extrato (conta corrente)...")
        nu_imp, nu_skip, nu_inv, nu_err = import_nubank_extrato(BASE_DIR)
        print(f"      {nu_imp} importadas | {nu_skip} puladas | {nu_inv} investimentos | {nu_err} erros")

    nu_cc_folder = BASE_DIR / "Fatura Nubank"
    if not nu_cc_folder.exists() or not list(nu_cc_folder.glob("*.csv")):
        print("\n[2/4] Nubank CC faturas — pasta vazia ou não encontrada, pulando.")
        nu_cc_imp = nu_cc_skip = nu_cc_err = 0
    else:
        print("\n[2/4] Nubank CC faturas (cartão de crédito)...")
        nu_cc_imp, nu_cc_skip, nu_cc_err = import_nubank_cc_faturas(BASE_DIR)
        print(f"      {nu_cc_imp} importadas | {nu_cc_skip} puladas | {nu_cc_err} erros")

    inter_cc_folder = BASE_DIR / "Fatura banco Inter"
    if not inter_cc_folder.exists() or not list(inter_cc_folder.glob("*.csv")):
        print("\n[3/4] Inter CC faturas — pasta vazia ou não encontrada, pulando.")
        inter_cc_imp = inter_cc_skip = inter_cc_err = 0
    else:
        print("\n[3/4] Inter CC faturas (cartão de crédito)...")
        inter_cc_imp, inter_cc_skip, inter_cc_err = import_inter_cc_faturas(BASE_DIR)
        print(f"      {inter_cc_imp} importadas | {inter_cc_skip} puladas | {inter_cc_err} erros")

    inter_db_folder = BASE_DIR / "Extrato completo Inter"
    if not inter_db_folder.exists() or not list(inter_db_folder.glob("*.csv")):
        print("\n[4/4] Inter extrato — pasta vazia ou não encontrada, pulando.")
        inter_db_imp = inter_db_skip = inter_db_inv = inter_db_err = 0
    else:
        print("\n[4/4] Inter extrato (conta corrente)...")
        inter_db_imp, inter_db_skip, inter_db_inv, inter_db_err = import_inter_extrato(BASE_DIR)
        print(f"      {inter_db_imp} importadas | {inter_db_skip} puladas | {inter_db_inv} investimentos | {inter_db_err} erros")

    total_tx  = nu_imp + nu_cc_imp + inter_cc_imp + inter_db_imp
    total_inv = nu_inv + inter_db_inv
    total_err = nu_err + nu_cc_err + inter_cc_err + inter_db_err

    print("\n" + "=" * 55)
    print(f"Total: {total_tx} transações + {total_inv} movimentos de investimento importados.")
    if total_err:
        print(f"Atenção: {total_err} linhas com erro — veja logs/import_errors.log")
    if DRY_RUN:
        print("DRY RUN — nenhuma alteração foi gravada no banco.")
    else:
        print("Pronto. Abra o dashboard em http://localhost:8080")

    return {
        "imported": total_tx,
        "investments": total_inv,
        "skipped": nu_skip + nu_cc_skip + inter_cc_skip + inter_db_skip,
        "errors": total_err,
    }


if __name__ == "__main__":
    main()
