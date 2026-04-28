"""ConversationHandler state integers, account/investment mappings, and display labels.

All state numbers are defined here to prevent collisions across flows.
Every handler module imports its required constants from this file.

Expense flow states (0–6):
    ACCOUNT → AMOUNT → INSTALLMENTS → DESCRIPTION → DATE → CATEGORY → CONFIRMATION

Income flow states (10–17):
    TYPE → BANK → AMOUNT → DESCRIPTION → DATE → CONFIRMATION
    Transfer sub-flow: TYPE → TRANSFER_FROM → TRANSFER_TO → AMOUNT → DATE → CONFIRMATION

Investment flow states (20–25):
    OPERATION → DESTINATION → AMOUNT → DESCRIPTION → DATE → CONFIRMATION
"""
from bot.parsers import nubank_cc, inter_cc

# ── Expense flow (0–6) ────────────────────────────────────────────────────────
# Step 1: account+method selection (combined)
# Step 2: amount
# Step 3: installments (credit only — À vista / 2x / 3x / ...)
# Step 4: description
# Step 5: date (Hoje / Ontem / Outra data)
# Step 6: category
# Step 7: confirmation
(
    EXP_ACCOUNT,
    EXP_AMOUNT,
    EXP_INSTALLMENTS,
    EXP_DESCRIPTION,
    EXP_DATE,
    EXP_CATEGORY,
    EXP_CONFIRMATION,
) = range(7)

# ── Income flow (10–17) ───────────────────────────────────────────────────────
(
    INC_TYPE,
    INC_BANK,
    INC_AMOUNT,
    INC_DESCRIPTION,
    INC_DATE,
    INC_CONFIRMATION,
    INC_TRANSFER_FROM,  # transfer sub-flow: source account selection
    INC_TRANSFER_TO,    # transfer sub-flow: destination account selection
) = range(10, 18)

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

# ── Account choices: callback key → (account_id, method) ─────────────────────
# Used by the combined payment+bank selection step in expense flow.
ACCOUNT_CHOICES: dict[str, tuple[str, str]] = {
    "nu-cc_credit":    ("nu-cc",    "credit"),
    "inter-cc_credit": ("inter-cc", "credit"),
    "nu-db_pix":       ("nu-db",    "pix"),
    "inter-db_pix":    ("inter-db", "pix"),
    "nu-db_ted":       ("nu-db",    "ted"),
    "inter-db_ted":    ("inter-db", "ted"),
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
