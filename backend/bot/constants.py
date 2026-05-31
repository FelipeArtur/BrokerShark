"""Account/investment mappings and display labels used across bot handlers."""
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

ACCOUNT_BANK: dict[str, str] = {
    "nu-cc":    "nubank",
    "nu-db":    "nubank",
    "inter-cc": "inter",
    "inter-db": "inter",
}

INCOME_LABELS: dict[str, str] = {
    "salary":       "Salário",
    "freelance":    "Freela",
    "pix_received": "PIX recebido",
    "other":        "Outro",
}
