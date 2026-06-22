# BrokerShark — TODOS

Deferred work with enough context to pick up cold. Created from the
2026-06-05 CEO review (`~/.gstack/projects/FelipeArtur-BrokerShark/ceo-plans/2026-06-05-import-ux-foundation.md`).

> Removed 2026-06-22: Removed credit-card specific logic (faturas, installments) to keep the system strictly checking-account based and simplified.

---

## T-A — Auto-suggest categories in Histórico (P2)

**What:** When categorizing in the Histórico table, suggest a likely category per
uncategorized row instead of a blank `<select>`.

**Why:** Categorization stays "100% manual no Histórico" by design; this just makes that manual pass faster.

**Context:** Categorization today is a manual `<select>` per row. Suggestions could come from prior mappings. No auto-apply — suggest, user confirms.

**Effort:** M (human) → S (CC).  **Priority:** P2.  **Depends on:** nothing.

---

## T-B — Credit Card Strategy (Parked)

**What:** Repensar a modelagem de Cartões de Crédito (faturas) no futuro.

**Why:** A complexidade anterior de conciliar faturas, datas de fechamento e parcelas poluía a interface e a lógica de banco de dados, divergindo do foco em liquidez imediata. A estratégia agora é focada estritamente em extratos de conta corrente. Se for necessário reintroduzir faturas no futuro, deverá ser desenhado como um módulo isolado que não comprometa a estabilidade dos extratos em "cash basis".

**Effort:** L.  **Priority:** Parked.
