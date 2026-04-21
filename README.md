# BrokerShark

A personal finance assistant built as a Telegram bot, running entirely on my local Linux machine.

## About

BrokerShark is a personal project I built to simplify how I track my daily finances. Instead of opening a spreadsheet every time I spend money, I just open Telegram on my phone, tap a few buttons, and the transaction is recorded — both locally in a SQLite database and automatically mirrored to Google Sheets for easy access and backup.

A local web dashboard (Flask + Chart.js) runs alongside the bot for visual analysis and real-time updates.

This project also serves as a practical testbed for using **Claude** as an engineering assistant throughout the entire development process, from architecture decisions to code generation.

## What it does

- **Register expenses** via guided button flows (payment type + bank → amount → installments → category → confirm)
- **Register income** (salary, freelance, PIX received, transfers)
- **Track investments** — deposits and withdrawals for Caixinha Nubank, Porquinho Inter, and Tesouro Direto
- **Import CSV statements** from Nubank and Inter credit cards, with duplicate detection
- **Mirror all records to Google Sheets** as an append-only backup — if the local database is lost, the spreadsheet holds the full history
- **Local web dashboard** at `http://localhost:8080` — dark theme, Chart.js charts, bank filter tabs (Todos / Nubank / Inter), updates in real-time via SSE (< 1s latency)
- **Automated reports** — weekly summary every Monday and monthly closing report on the 1st of each month
- **Proactive spending alert** — bot sends a warning when monthly expenses reach or exceed income

## Tech stack

| Layer | Technology |
|---|---|
| Bot | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Sheets sync | gspread + Google Service Account |
| Scheduler | APScheduler |
| Dashboard API | Flask 3.1 + Waitress 3.0 |
| Dashboard frontend | Chart.js 4.4, vanilla JS |
| Real-time updates | SSE (Server-Sent Events) |
| Language | Python 3.12+ |

## Getting started

```bash
# Clone and set up virtualenv
python -m venv .venv
source .venv/bin/activate.fish   # fish shell
# source .venv/bin/activate      # bash/zsh

pip install -r requirements.txt

# Configure credentials
cp .env.example .env
# Fill in TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, DB_PATH, SHEETS_ID, SHEETS_CREDENTIALS
```

Start the bot and dashboard:

```bash
python backend/main.py
# Dashboard available at http://localhost:8080
```

## Development

This project was developed with [Claude](https://claude.ai/claude-code) as a coding assistant. Architecture decisions, data models, conversation flows, and implementation details are documented in [`CLAUDE.md`](./CLAUDE.md).
