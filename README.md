# BrokerShark

A local tool to **understand and analyze my money**. Runs 100% on Linux, accounts at
Nubank + Inter. It answers one question first — **"quanto eu posso gastar agora?"** —
and then lets me dig into where the money goes.

**v2 rewrite in progress.** The Python/Flask backend was removed (git history has it);
the new backend is TypeScript on Node's built-in tooling. The design doc lives in
`docs/redesign-v2.md` (local, not versioned). The React frontend (`frontend/`) is kept
as-is and will be served by the new backend.

## What works today

- **Backfill** — builds the v2 SQLite database from the export archive (Nubank
  statements 2020→2026, Inter statements, itemized Inter credit-card invoices,
  B3 consolidated reports):

  ```bash
  cd backend-ts
  node src/jobs/backfill.ts "<dir do acervo>"   # → data/brokershark-v2.db
  ```

  Idempotent by rebuild. Verified: Inter balance matches the bank's running balance
  to the cent; all 7 invoices reconciled to their payments by exact amount; SELF
  transfers detected by leg-pairing (no keyword allow-list).

## What v2 does differently from v1

- **Money is integer cents** — no floats in the ledger.
- **Itemized credit-card invoices** — invoice items are the real expenses; the bill
  payment is a settlement (`is_settlement=1`), excluded from consumption totals.
- **Investments = positions + snapshots** — every B3 report import writes a dated
  snapshot (quantity, applied/gross/net value); yield is computed, never guessed.
  Positions soft-close (never deleted) when they leave the reports.
- **Self-transfers by leg-pairing** — opposite legs, same amount, ±3 days, across
  own accounts.

## Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (Node ≥ 26, native type-stripping — no build step) |
| Database | SQLite via `node:sqlite` (builtin, WAL, file mode 0600) |
| Parsing | own CSV parsers; `xlsx` for B3 reports (only npm dependency) |
| Frontend | React 18 + Chart.js, fully vendored, no CDN, no build step |
| Server | Hono + SSE — **planned (phase 5)**, will preserve the v1 API contract |

## Data sources (all local files, no bank APIs)

| Source | Format |
|--------|--------|
| Nubank statement | CSV (`Data,Valor,Identificador,Descrição`) — OFX planned |
| Inter statement | CSV (semicolon, running-balance checked) — OFX planned |
| Inter card invoice | CSV (bank category + installments) |
| B3 consolidated report | xlsx (Tesouro, Renda Fixa, Ações, BDR) |
