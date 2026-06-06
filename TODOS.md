# BrokerShark — TODOS

Deferred work with enough context to pick up cold. Created from the
2026-06-05 CEO review (`~/.gstack/projects/FelipeArtur-BrokerShark/ceo-plans/2026-06-05-import-ux-foundation.md`).

---

## T-A — Auto-suggest categories in Histórico (P2)

**What:** When categorizing in the Histórico table, suggest a likely category per
uncategorized row instead of a blank `<select>`.

**Why:** The CEO-review outside voice argued the real categorization win is *in
Histórico* (where categorization already lives and you see the whole month), not
moved into the import flow. Categorization stays "100% manual no Histórico" by
design; this just makes that manual pass faster.

**Context:** Categorization today is a manual `<select>` per row + "Sem categoria"
filter (`view-history.js`, `PATCH /api/transactions/<id>`). Suggestions could come
from prior `(description → category_id)` pairs the user already set, or from
`display_name`. No auto-apply — suggest, user confirms. Keeps the clean
"Sem categoria = everything imported" mental model intact.

**Effort:** M (human) → S (CC).  **Priority:** P2.  **Depends on:** nothing.

---

## T-B — Activate systemd user timers (P2, ops)

**What:** Install + enable the systemd user timers for backup / weekly report /
monthly closing, and enable linger.

**Why:** Code + units are done (`deploy/systemd/`), but nothing fires until the
one-time activation runs. Split out of the import-UX plan because it's unrelated
ops with a privileged dependency.

**Context / steps** (see `deploy/README.md`):
```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/brokershark-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brokershark-backup.timer \
  brokershark-weekly-report.timer brokershark-monthly-closing.timer
loginctl enable-linger joao   # CRITICAL: without it, boot catch-up never fires
systemctl --user list-timers 'brokershark-*'
```
**Risk if skipped:** `enable-linger` omission silently kills the monthly backup
catch-up (the one failure CLAUDE.md flags). Verify with `list-timers` after.

**Effort:** S (human + CC).  **Priority:** P2.  **Depends on:** nothing.

---

## Parked (in CEO plan, not yet TODOS)
- CP1 — inline category in import preview (revisit after living with editable preview).
- CP4 — CSV source auto-detect (only if the per-file account picker proves annoying;
  carries a dedup-key risk note).

---

## T-C — Migrate Local AI to Hermes Agent (P3, architecture)

**What:** Swap the current `qwen2.5:7b` prompt-based tool calling loop for a dedicated Hermes agent (e.g. `Hermes-3-Llama-3.1-8B` or similar) utilizing native tool-calling capabilities.

**Why:** The current AI integration in Telegram (`backend/bot/handlers/ai_chat.py`) relies on a fragile regex/JSON-parsing loop to simulate tool-calling. It is not being effectively used because it's slow and occasionally fails parsing. A Hermes agent is heavily fine-tuned for precise tool-calling, making the Telegram bot faster and much more reliable for queries.

**Context:** The Telegram bot strictly executes read-only tools (`get_monthly_summary`, `get_account_balances`, etc). Hermes could act as the conversational layer (Agent) connecting the Telegram front to the BrokerShark database, making queries instant and accurate. We will likely transition from plain text-based prompt engineering to OpenAI-compatible Tool structures.

**Effort:** M (human + AI). **Priority:** P3. **Depends on:** evaluating local hardware constraints for Hermes 8B.
