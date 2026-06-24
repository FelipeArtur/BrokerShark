# BrokerShark

A local tool to **understand and analyze my money**. Runs 100% on Linux, accounts at Nubank + Inter. It answers one question first — **"quanto eu posso gastar agora?"** — and then lets me dig into where the money goes.

**Web-only**: the product is a three-screen web dashboard at `http://localhost:8080`, running as an always-on systemd user service. All data entry happens through the web — there is no other write path.

## What it does

- **Dinheiro** (home) — one honest hero number, **Disponível pra gastar** = checking balance. Around it: a "this month" cash-flow summary, account balances, recent activity, and run-rate projections.
- **Histórico** — monthly timeline, metrics with deltas, a 6-month cash-flow chart, spending by category, top PIX destinations, and a filterable transaction table with inline categorization.
- **Investimentos** — donut chart, sum of current balances, editable positions, and movement tracking.

Supporting roles (not the center):

- **Monthly import** — bank statements (CSV) plus B3 positions (xlsx), imported exclusively via the web. Multi-file drop, editable staging preview, deduplication against existing records, and a 5-second "Desfazer" that reverts the whole batch.
- **Local-first** — SQLite is the single source of truth, SSE pushes live updates (< 1s), and a monthly backup (one snapshot per month, 12 kept, refreshed on every confirmed import) lands on a local HDD.

## Accounts

| Account | Type | Bank |
|---------|------|------|
| `nu-db` | Checking | Nubank |
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
| Dashboard frontend | React 18 + Chart.js + Inter/JetBrains Mono fonts, all vendored locally (no CDN → fully offline, no build step, no Babel — plain JS hyperscript) |
| Real-time | SSE via `core/events.py` |
| Runtime | systemd **user** units — always-on service + backup timer (`Persistent=true`) |
| Backup | Monthly local HDD snapshot via the SQLite backup API (WAL-safe) |

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

## Running (foreground)

The deploy strategy is being rethought (see `TODOS.md` → T-C). For now the dashboard
runs in the **foreground** via `./run.sh` (logs straight to the terminal, Ctrl-C to stop):

```bash
./run.sh
# Dashboard: http://localhost:8080
```

Backup runs **manually** (monthly snapshot, WAL-safe, keeps 12):

```bash
PYTHONPATH=backend .venv/bin/python -m jobs.backup
```

Restore a snapshot: stop `./run.sh`, then copy the snapshot `.db` into `DB_PATH` (or call
`core/backup.py::restore_backup`, which verifies + writes a `.pre-restore` sidecar) **with the
app stopped** — never while it's writing. A safe operational restore wrapper is P1 in T-C.

> The previous always-on model (systemd user units + linger + `OnFailure` desktop alert)
> lived in `deploy/`, deleted 2026-06-23; it's recoverable from `git log` if the rethink revives it.

## Development

Co-developed with [Claude Code](https://claude.ai/claude-code) and [Gemini CLI](https://github.com/google-gemini/gemini-cli). Architecture, data model, and the load-bearing financial invariants are documented in [`CLAUDE.md`](./CLAUDE.md) and [`GEMINI.md`](./GEMINI.md).

```bash
# Health stack (required green before committing)
.venv/bin/ruff check backend tests
.venv/bin/mypy backend
PYTHONPATH=backend .venv/bin/python -m pytest -q
```
