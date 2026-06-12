# BrokerShark

A local tool to **understand and analyze my money**. Runs 100% on Linux, accounts at Nubank + Inter. It answers one question first — **"quanto eu posso gastar agora?"** — and then lets me dig into where the money goes.

**Web-only**: the product is a three-screen web dashboard at `http://localhost:8080`, running as an always-on systemd user service. All data entry happens through the web — there is no other write path.

## What it does

- **Dinheiro** (home) — one honest hero number, **Disponível pra gastar** = checking balance − open credit-card bills. Around it: open faturas (with editable membership), a "this month" cash-flow summary, account balances, recent activity, and run-rate projections.
- **Histórico** — monthly timeline, metrics with deltas, a 6-month cash-flow chart, spending by category, top PIX destinations, and a filterable transaction table with inline categorization. Clicking a credit card pivots to **fatura mode** (statements grouped by due date, the way the bank groups them).
- **Investimentos** — donut chart, sum of current balances, editable positions, and movement tracking.

Supporting roles (not the center):

- **Monthly import** — bank statements and credit-card bills (CSV) plus B3 positions (xlsx), imported exclusively via the web. Multi-file drop, editable staging preview, deduplication against existing records, and a 5-second "Desfazer" that reverts the whole batch.
- **Local-first** — SQLite is the single source of truth, SSE pushes live updates (< 1s), and a two-tier backup (daily ×14 + monthly ×12 snapshots) lands on a local HDD three times a day.

## Accounts

| Account | Type | Bank |
|---------|------|------|
| `nu-cc` | Credit card | Nubank |
| `nu-db` | Checking | Nubank |
| `inter-cc` | Credit card | Inter |
| `inter-db` | Checking | Inter |
| Caixinha Nubank | Investment | Nubank |
| Porquinho Inter | Investment | Inter |
| Tesouro Direto | Investment | — |

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.12+ (in a 3.14 venv) |
| Database | SQLite (WAL mode) |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads) |
| Dashboard frontend | React 18 + Babel standalone, Chart.js (no build step) |
| Real-time | SSE via `core/events.py` |
| Runtime | systemd **user** units — always-on service + backup timer (`Persistent=true`) |
| Backup | Two-tier local HDD snapshots via the SQLite backup API (WAL-safe) |

## Getting started

```bash
# Create virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate.fish   # fish
# source .venv/bin/activate      # bash/zsh

pip install -r requirements.txt

# Configure
cp .env.example .env
# Fill in: DB_PATH (absolute!), DASHBOARD_PORT, OWNER_SELF_KEYWORDS

# Run in the foreground (development)
python backend/main.py
# Dashboard: http://localhost:8080
```

## Running as a service (production)

The dashboard runs as an always-on systemd **user** service and the backup as a timer — install once, see [`deploy/README.md`](./deploy/README.md) for the full guide (acceptance checks, daily ops, backup/restore semantics):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/brokershark-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brokershark-dashboard.service brokershark-backup.timer
loginctl enable-linger $USER   # CRITICAL: without it, user units die on logout/boot
```

Logs go to the journal: `journalctl --user -u brokershark-dashboard -f`.
Restore a snapshot safely (stops the service first): `deploy/restore.sh <snapshot.db>`.

## Development

Co-developed with [Claude Code](https://claude.ai/claude-code) and [Gemini CLI](https://github.com/google-gemini/gemini-cli). Architecture, data model, and the load-bearing financial invariants are documented in [`CLAUDE.md`](./CLAUDE.md) and [`GEMINI.md`](./GEMINI.md).

```bash
# Health stack (required green before committing)
.venv/bin/ruff check backend tests
.venv/bin/mypy backend
PYTHONPATH=backend .venv/bin/python -m pytest -q
```
