"""BrokerShark — import histórico de dados bancários.

Ports & Adapters: cada banco é um adapter em ``backend/adapters/``.
Para adicionar um novo banco: crie ``backend/adapters/<banco>.py`` implementando
``BankAdapter`` e coloque os CSVs em ``load_data/<Pasta>/``. Nenhuma outra
mudança é necessária — este script descobre adapters automaticamente.

Uso:
    python load_data/import.py              # importa tudo
    python load_data/import.py --preview    # simula, não grava
    python load_data/import.py --validate   # relatório pós-import
    python load_data/import.py --since 2024-01-01   # só arquivos com dados após esta data
"""
from __future__ import annotations

import argparse
import importlib
import pkgutil
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Optional

# Allow importing backend modules from project root
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

import config
from adapters import BankAdapter, ParsedRow
from core import database

BASE_DIR = Path(__file__).parent
DB_PATH = config.DB_PATH

# ── Adapter discovery ─────────────────────────────────────────────────────────

def _load_adapters() -> list[BankAdapter]:
    """Auto-discover all BankAdapter subclasses in backend/adapters/."""
    adapters_pkg = PROJECT_ROOT / "backend" / "adapters"
    adapters: list[BankAdapter] = []
    for finder, name, _ in pkgutil.iter_modules([str(adapters_pkg)]):
        try:
            mod = importlib.import_module(f"adapters.{name}")
        except ImportError:
            continue
        for obj in vars(mod).values():
            if (
                isinstance(obj, type)
                and issubclass(obj, BankAdapter)
                and obj is not BankAdapter
            ):
                adapters.append(obj())
    return adapters


# ── Dedup helpers ─────────────────────────────────────────────────────────────

def _seen_keys(conn: sqlite3.Connection) -> set[str]:
    """Load all (dedup_key) values already in the DB for UUID-based dedup."""
    rows = conn.execute(
        "SELECT external_id FROM transactions WHERE external_id IS NOT NULL"
    ).fetchall()
    return {r[0] for r in rows}


def _tx_exists(conn: sqlite3.Connection, row: ParsedRow) -> bool:
    """True if this transaction is already in the database."""
    result = conn.execute(
        "SELECT 1 FROM transactions WHERE date=? AND amount=? AND description=? AND account_id=?",
        (row.date, row.amount, row.description, row.account_id),
    ).fetchone()
    return result is not None


def _inv_exists(conn: sqlite3.Connection, inv_id: int, date: str, op: str, amount: float) -> bool:
    result = conn.execute(
        "SELECT 1 FROM investment_movements WHERE investment_id=? AND date=? AND operation=? AND amount=?",
        (inv_id, date, op, amount),
    ).fetchone()
    return result is not None


# ── Category helpers ──────────────────────────────────────────────────────────

def _get_category_id(conn: sqlite3.Connection, name: str, flow: str) -> Optional[int]:
    row = conn.execute(
        "SELECT id FROM categories WHERE name=? AND flow=?", (name, flow)
    ).fetchone()
    return row[0] if row else None


# ── Investment ID cache ───────────────────────────────────────────────────────

_inv_cache: dict[str, int] = {}

def _get_or_create_investment(name: str) -> int:
    if name in _inv_cache:
        return _inv_cache[name]
    existing = database.get_investment_by_name(name)
    if existing:
        _inv_cache[name] = existing["id"]
        return existing["id"]
    bank = "nubank" if "nubank" in name.lower() or "caixinha" in name.lower() else "inter"
    inv_id = database.upsert_investment(name, "savings", bank)
    _inv_cache[name] = inv_id
    return inv_id


# ── Per-adapter processing ────────────────────────────────────────────────────

class AdapterStats:
    def __init__(self, adapter_name: str):
        self.name = adapter_name
        self.files = 0
        self.expenses = 0
        self.incomes = 0
        self.transfers = 0
        self.investments = 0
        self.skipped = 0
        self.errors = 0
        self.duplicates = 0

    def total_inserted(self) -> int:
        return self.expenses + self.incomes + self.transfers + self.investments


def _process_adapter(
    adapter: BankAdapter,
    csv_files: list[Path],
    dry_run: bool,
    since: Optional[str],
    seen_ext_ids: set[str],
) -> AdapterStats:
    stats = AdapterStats(adapter.name)

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cat_outro_exp = _get_category_id(conn, "Outro", "expense")

    for filepath in sorted(csv_files):
        stats.files += 1
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            print(f"  [ERRO] Não foi possível ler {filepath.name}: {e}")
            stats.errors += 1
            continue

        try:
            rows = adapter.parse(content)
        except Exception as e:
            print(f"  [ERRO] Falha ao parsear {filepath.name}: {e}")
            stats.errors += 1
            continue

        for row in rows:
            if since and row.date and row.date < since:
                continue

            if row.row_type == "skip":
                stats.skipped += 1
                continue

            if row.row_type == "investment":
                _handle_investment(row, stats, dry_run)
                continue

            # Dedup: UUID-based first, then tuple-based
            if row.dedup_key and row.dedup_key in seen_ext_ids:
                stats.duplicates += 1
                continue

            with sqlite3.connect(DB_PATH) as conn:
                if _tx_exists(conn, row):
                    stats.duplicates += 1
                    continue

            # Insert
            if not dry_run:
                _insert_row(row, cat_outro_exp, seen_ext_ids)

            if row.row_type == "expense":
                stats.expenses += 1
            elif row.row_type == "income":
                stats.incomes += 1
            elif row.row_type == "transfer":
                stats.transfers += 1

    return stats


def _handle_investment(row: ParsedRow, stats: AdapterStats, dry_run: bool) -> None:
    inv_id = _get_or_create_investment(row.investment_name)
    with sqlite3.connect(DB_PATH) as conn:
        if _inv_exists(conn, inv_id, row.date, row.operation, row.amount):
            stats.duplicates += 1
            return
    if not dry_run:
        database.insert_investment_movement(row.date, inv_id, row.operation, row.amount)
    stats.investments += 1


def _insert_row(row: ParsedRow, default_expense_cat: Optional[int], seen_ext_ids: set[str]) -> None:
    cat_id = row.category_id if row.category_id is not None else (
        default_expense_cat if row.row_type == "expense" else None
    )
    ext_id = row.dedup_key

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """INSERT INTO transactions
               (date, flow, method, account_id, amount, installments,
                description, category_id, dest_account_id, counterpart,
                is_revenue, external_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                row.date,
                row.row_type if row.row_type in ("expense", "income") else "expense",
                row.method,
                row.account_id,
                row.amount,
                row.installments,
                row.description,
                cat_id,
                row.dest_account_id,
                row.counterpart,
                row.is_revenue,
                ext_id,
            ),
        )
    if ext_id:
        seen_ext_ids.add(ext_id)


# ── File routing ──────────────────────────────────────────────────────────────

def _find_files(adapters: list[BankAdapter]) -> dict[str, list[Path]]:
    """Map each adapter.name → list of CSV files it should process."""
    result: dict[str, list[Path]] = defaultdict(list)
    for csv_path in BASE_DIR.rglob("*.csv"):
        for adapter in adapters:
            if adapter.can_handle(csv_path):
                result[adapter.name].append(csv_path)
                break
    return result


# ── Validate / report ─────────────────────────────────────────────────────────

def _validate() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        print("\nReceitas mensais (is_revenue=1)")
        print("─" * 55)
        rows = conn.execute("""
            SELECT strftime('%Y-%m', date) as month,
                   SUM(amount) as income
            FROM transactions
            WHERE is_revenue=1
            GROUP BY month ORDER BY month
        """).fetchall()
        for r in rows:
            print(f"  {r['month']}   R$ {r['income']:>10.2f}")

        print("\nDespesas mensais (dest_account_id IS NULL)")
        print("─" * 55)
        rows = conn.execute("""
            SELECT strftime('%Y-%m', date) as month,
                   SUM(amount) as expenses
            FROM transactions
            WHERE flow='expense' AND dest_account_id IS NULL
            GROUP BY month ORDER BY month
        """).fetchall()
        for r in rows:
            print(f"  {r['month']}   R$ {r['expenses']:>10.2f}")

        print("\nTransações por conta")
        print("─" * 55)
        rows = conn.execute("""
            SELECT account_id, flow, COUNT(*) as n
            FROM transactions GROUP BY account_id, flow ORDER BY account_id
        """).fetchall()
        for r in rows:
            print(f"  {r['account_id']:10s}  {r['flow']:7s}  {r['n']:5d}")

        print("\nMovimentos de investimento")
        print("─" * 55)
        rows = conn.execute("""
            SELECT i.name, im.operation, COUNT(*) as n, SUM(im.amount) as total
            FROM investment_movements im JOIN investments i ON im.investment_id=i.id
            GROUP BY i.name, im.operation
        """).fetchall()
        for r in rows:
            print(f"  {r['name']:25s}  {r['operation']:10s}  {r['n']:4d}x  R$ {r['total']:.2f}")

        print("\nTransações sem categoria (despesas)")
        count = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE flow='expense' AND dest_account_id IS NULL AND category_id IS NULL"
        ).fetchone()[0]
        print(f"  {count} transações sem categoria para categorizar")

        # True duplicates: same (date, amount, description, account_id) appears twice
        print("\nDuplicatas reais (mesma data+valor+descrição+conta)")
        rows = conn.execute("""
            SELECT date, amount, account_id, description, COUNT(*) as n
            FROM transactions
            GROUP BY date, amount, account_id, description
            HAVING n > 1
            ORDER BY n DESC LIMIT 10
        """).fetchall()
        if rows:
            for r in rows:
                print(f"  ⚠  {r['date']}  R${r['amount']:.2f}  {r['account_id']}  ({r['n']}x)  {r['description'][:50]}")
        else:
            print("  ✓ Nenhuma detectada")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="BrokerShark — importação histórica")
    parser.add_argument("--preview", action="store_true", help="Simula sem gravar")
    parser.add_argument("--validate", action="store_true", help="Relatório do banco atual")
    parser.add_argument("--since", metavar="YYYY-MM-DD", help="Só importa transações após esta data")
    args = parser.parse_args()

    # Init DB (idempotent)
    database.init_db()

    if args.validate:
        _validate()
        return

    adapters = _load_adapters()
    if not adapters:
        print("Nenhum adapter encontrado em backend/adapters/")
        return

    file_map = _find_files(adapters)
    adapter_by_name = {a.name: a for a in adapters}

    label = " [PREVIEW — sem gravação]" if args.preview else ""
    print(f"\nBrokerShark Import{label}")
    print("━" * 50)

    # Pre-load known external IDs (UUID dedup)
    seen_ext_ids: set[str] = set()
    if not args.preview:
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                "SELECT external_id FROM transactions WHERE external_id IS NOT NULL"
            ).fetchall()
            seen_ext_ids = {r[0] for r in rows}

    all_stats: list[AdapterStats] = []
    for adapter_name, files in sorted(file_map.items()):
        adapter = adapter_by_name[adapter_name]
        stats = _process_adapter(
            adapter, files,
            dry_run=args.preview,
            since=args.since,
            seen_ext_ids=seen_ext_ids,
        )
        all_stats.append(stats)

        parts = []
        if stats.expenses:    parts.append(f"{stats.expenses} despesas")
        if stats.incomes:     parts.append(f"{stats.incomes} receitas")
        if stats.transfers:   parts.append(f"{stats.transfers} transferências")
        if stats.investments: parts.append(f"{stats.investments} investimentos")
        skip_info = f"  ({stats.duplicates} dup, {stats.skipped} skip)" if (stats.duplicates or stats.skipped) else ""
        print(f"[{adapter_name:18s}]  {stats.files:3d} arquivo(s) → {', '.join(parts) or '—'}{skip_info}")

    total_tx  = sum(s.expenses + s.incomes + s.transfers for s in all_stats)
    total_inv = sum(s.investments for s in all_stats)
    total_err = sum(s.errors for s in all_stats)

    print("━" * 50)
    print(f"Total: {total_tx} transações | {total_inv} movimentos de investimento")
    if total_err:
        print(f"⚠  {total_err} erros de parse")
    if args.preview:
        print("\nExecute sem --preview para gravar no banco.")
    else:
        print("\nPronto. Execute --validate para verificar os dados.")


if __name__ == "__main__":
    main()
