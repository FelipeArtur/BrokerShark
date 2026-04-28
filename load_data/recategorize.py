#!/usr/bin/env python3
"""Batch recategorization of expenses imported as 'Outro'.

Uses keyword matching (case-insensitive substring) on transaction descriptions.
Runs in dry-run mode by default; pass --apply to write changes to the database.

Usage:
    python recategorize.py           # dry run — shows what would change
    python recategorize.py --apply   # apply changes to the database
"""
from __future__ import annotations

import argparse
import sqlite3
from collections import defaultdict
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "brokershark.db"

# (keyword_fragment, target_category_name) — first match wins, case-insensitive.
# Keep more specific rules before broader ones to avoid false matches.
RULES: list[tuple[str, str]] = [
    # ── Alimentação ───────────────────────────────────────────────────────────
    ("COMERCIAL DE ALIMENTOS",  "Alimentação"),
    ("GARFODEOURO",             "Alimentação"),
    ("SUBWAY",                  "Alimentação"),
    ("VVS COMERCIO DE ALIMEN",  "Alimentação"),
    ("MAMMA JAMMA",             "Alimentação"),
    ("SVM VENDING MACHINE",     "Alimentação"),
    ("SVM COM MANUT E SERV",    "Alimentação"),
    ("SVM COMERCIO MANUTENCA",  "Alimentação"),
    ("G BARBOSA",               "Alimentação"),
    ("JIM COM  SORVETERIA",     "Alimentação"),
    ("CS GELATERIA",            "Alimentação"),
    ("DOMINOS",                 "Alimentação"),
    ("REI DO CREPE",            "Alimentação"),
    ("OUTBACK",                 "Alimentação"),
    ("IFD TUTTO PIZZARIA",      "Alimentação"),
    ("GARE COMERCIO DE ALIME",  "Alimentação"),
    ("GANACHE CAFE",            "Alimentação"),
    ("FLOR E CAFE",             "Alimentação"),
    ("COXINHA DO GAGO",         "Alimentação"),
    ("CANTINA VOLPI",           "Alimentação"),
    ("ACAI",                    "Alimentação"),
    ("ASSAI ATACADISTA",        "Alimentação"),
    ("HIPERIDEAL",              "Alimentação"),
    ("IFOOD",                   "Alimentação"),

    # ── Carro ─────────────────────────────────────────────────────────────────
    ("LUBRIPREMIUM",             "Carro"),
    ("POSTO SOL",                "Carro"),
    ("POSTO PARALELA",           "Carro"),
    ("POSTO KALILANDIA",         "Carro"),
    ("POSTO BARRA",              "Carro"),
    ("POSTO ALPHAVILLE",         "Carro"),
    ("ROTA PARK",                "Carro"),
    ("PITUBA PARQUE CENTE",      "Carro"),
    ("CIAPARK ESTACIONAMENTO",   "Carro"),
    ("PARALELA 202",             "Carro"),
    ("SALVADOR 201",             "Carro"),
    ("LAVA JATO",                "Carro"),
    ("CENTRO DE FROMACAO DE CONDUTORES", "Carro"),
    ("CENTRO DE FORMACAO DE CONDUTORES", "Carro"),

    # ── Jogos ─────────────────────────────────────────────────────────────────
    ("STEAM",       "Jogos"),
    ("APP BERZERK", "Jogos"),

    # ── Lazer ─────────────────────────────────────────────────────────────────
    ("SPOTIFY",  "Lazer"),
    ("CINEMARK", "Lazer"),
    ("TEMBICI",  "Lazer"),

    # ── Atividade física ──────────────────────────────────────────────────────
    ("SESI",                "Atividade física"),
    ("FOR FIT SUPLEMENTOS", "Atividade física"),
    ("DECATHLON",           "Atividade física"),

    # ── Eletrônicos ───────────────────────────────────────────────────────────
    ("FERREIRA COSTA", "Eletrônicos"),
    ("ALIEXPRESS",     "Eletrônicos"),

    # ── Educação ──────────────────────────────────────────────────────────────
    ("CLAUDE AI",                 "Educação"),
    ("CENTRO BRASILEIRO DE PESQ", "Educação"),

    # ── Igreja ────────────────────────────────────────────────────────────────
    ("IGREJA BATISTA", "Igreja"),
]


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def match_category(description: str) -> str | None:
    upper = description.upper()
    for keyword, category in RULES:
        if keyword.upper() in upper:
            return category
    return None


def run(apply: bool) -> None:
    with _connect() as conn:
        cat_rows = conn.execute(
            "SELECT id, name FROM categories WHERE flow = 'expense'"
        ).fetchall()
        cat_map: dict[str, int] = {r["name"]: r["id"] for r in cat_rows}

        tx_rows = conn.execute(
            """SELECT t.id, t.description
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE c.name = 'Outro' AND t.flow = 'expense'
                 AND t.dest_account_id IS NULL"""
        ).fetchall()

    matches: dict[str, list[tuple[int, str]]] = defaultdict(list)
    unmatched = 0
    for row in tx_rows:
        cat = match_category(row["description"])
        if cat:
            matches[cat].append((row["id"], row["description"]))
        else:
            unmatched += 1

    total_matched = sum(len(v) for v in matches.values())
    prefix = "DRY RUN — " if not apply else ""
    print(f"{prefix}{len(tx_rows)} transações com categoria 'Outro'")
    print(f"Correspondências: {total_matched}  |  Sem correspondência: {unmatched}\n")

    for cat_name in sorted(matches):
        txs = matches[cat_name]
        print(f"  {cat_name} ({len(txs)})")
        for tx_id, desc in txs[:3]:
            print(f"    [{tx_id}] {desc[:80]}")
        if len(txs) > 3:
            print(f"    ... e mais {len(txs) - 3}")
        print()

    if not apply:
        print("Execute com --apply para salvar as alterações no banco.")
        return

    with _connect() as conn:
        for cat_name, txs in matches.items():
            cat_id = cat_map[cat_name]
            ids = [tx_id for tx_id, _ in txs]
            placeholders = ",".join("?" * len(ids))
            conn.execute(
                f"UPDATE transactions SET category_id = ? WHERE id IN ({placeholders})",
                [cat_id, *ids],
            )

    print(f"✔ {total_matched} transações atualizadas.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Write changes to the database")
    args = parser.parse_args()
    run(args.apply)
