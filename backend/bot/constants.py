"""ConversationHandler state integers, account/investment mappings, and display labels.

All state numbers are defined here to prevent collisions across flows.
Every handler module imports its required constants from this file.
"""
from parsers import nubank_cc, inter_cc

# ── Expense flow (0–8) ────────────────────────────────────────────────────────
(
    EXP_PAYMENT_TYPE,
    EXP_BANK,
    EXP_AMOUNT,
    EXP_INSTALLMENTS,
    EXP_NUM_INSTALLMENTS,
    EXP_DESCRIPTION,
    EXP_DATE,
    EXP_CATEGORY,
    EXP_CONFIRMATION,
) = range(9)

# ── Income flow (10–15) ───────────────────────────────────────────────────────
(
    INC_TYPE,
    INC_BANK,
    INC_AMOUNT,
    INC_DESCRIPTION,
    INC_DATE,
    INC_CONFIRMATION,
) = range(10, 16)

# ── Investment flow (20–25) ───────────────────────────────────────────────────
(
    INV_OPERATION,
    INV_DESTINATION,
    INV_AMOUNT,
    INV_DESCRIPTION,
    INV_DATE,
    INV_CONFIRMATION,
) = range(20, 26)

# ── CSV import flow (30–31) ───────────────────────────────────────────────────
(
    CSV_ACCOUNT,
    CSV_CONFIRMATION,
) = range(30, 32)

# ── Account routing: (payment_method, bank) → account_id ─────────────────────
ACCOUNT_MAP: dict[tuple[str, str], str] = {
    ("pix",    "nubank"): "nu-db",
    ("ted",    "nubank"): "nu-db",
    ("credit", "nubank"): "nu-cc",
    ("pix",    "inter"):  "inter-db",
    ("ted",    "inter"):  "inter-db",
    ("credit", "inter"):  "inter-cc",
}

# ── Investment metadata: name → (type, bank) ─────────────────────────────────
INVESTMENT_META: dict[str, tuple[str, str]] = {
    "Caixinha Nubank": ("savings",  "nubank"),
    "Tesouro Direto":  ("treasury", "nubank"),
    "Porquinho Inter": ("savings",  "inter"),
}

# ── CSV parsers indexed by account_id ────────────────────────────────────────
PARSER_MAP = {
    "nu-cc":    nubank_cc,
    "inter-cc": inter_cc,
}

# ── Display labels ────────────────────────────────────────────────────────────
ACCOUNT_LABELS: dict[str, str] = {
    "nu-cc":    "Nubank Crédito",
    "nu-db":    "Nubank Conta",
    "inter-cc": "Inter Crédito",
    "inter-db": "Inter Conta",
}

METHOD_LABELS: dict[str, str] = {
    "pix":    "PIX",
    "credit": "Crédito",
    "ted":    "TED",
}

OPERATION_LABELS: dict[str, str] = {
    "deposit":    "Aporte",
    "withdrawal": "Resgate",
}
