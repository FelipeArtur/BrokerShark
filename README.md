# BrokerShark

![BrokerShark](img/logo.png)

A personal finance assistant built as a Telegram bot, running entirely on my local Linux machine.

## About

BrokerShark is a personal project I built to simplify how I track my daily finances. Instead of opening a spreadsheet every time I spend money, I just open Telegram on my phone, tap a few buttons, and the transaction is recorded — both locally in a SQLite database and automatically mirrored to Google Sheets for easy access and backup.

This project also serves as a practical testbed for using **Claude** as an engineering assistant throughout the entire development process, from architecture decisions to code generation.

## What it does

- **Register expenses** via guided button flows (payment type → bank → amount → category → confirm)
- **Register income** (salary, freelance, transfers received)
- **Track investments** (deposits and withdrawals)
- **Mirror all records to Google Sheets** as an append-only backup — if the local database is lost, the spreadsheet holds the full history
- **Weekly summary** sent automatically every Monday morning via Telegram

## Tech stack

| Layer | Technology |
|---|---|
| Bot | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Sheets sync | gspread + Google Service Account |
| Scheduler | APScheduler |
| Language | Python 3.12 |

## Getting started

```bash
cp .env.example .env
# fill in your credentials
pip install -r requirements.txt
```

## Development

This project was developed with [Claude](https://claude.ai/claude-code) as a coding assistant. Architecture decisions, data models, conversation flows, and implementation details are documented in [`CLAUDE.md`](./CLAUDE.md).
