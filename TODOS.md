# BrokerShark — TODOS

Deferred work with enough context to pick up cold. Created from the
2026-06-05 CEO review (`~/.gstack/projects/FelipeArtur-BrokerShark/ceo-plans/2026-06-05-import-ux-foundation.md`).

> Removed 2026-06-22: Removed credit-card specific logic (faturas, installments) to keep the system strictly checking-account based and simplified.
> Removed 2026-06-23: Deleted the whole `deploy/` folder (paused systemd units, restore.sh, brokershark.sh, README). Deploy strategy is being rethought — see T-C. The Health Stack pre-commit hook moved to `.githooks/` (`git config core.hooksPath .githooks`).

---

## T-C — Repensar estratégia de deploy / runtime (P2, com sub-item P1)

**What:** Redesenhar como o BrokerShark roda e se recupera. A pasta `deploy/` inteira foi
apagada em 2026-06-23 (decisão do dono: limpar a estratégia atual antes de repensar).

**Estado atual (cold context):**
- systemd estava **pausado** desde `899ff78` — app roda em **foreground via `./run.sh`**
  (logs no terminal). Backup automático (timer) também pausado → rodar manual:
  `PYTHONPATH=backend .venv/bin/python -m jobs.backup`.
- `deploy/restore.sh` **foi apagado**. Restore agora = **cópia manual** do `.db` com o app parado.
- O que existia: `dashboard.service` (Restart=on-failure, `main.py` bloqueia no `waitress.serve`),
  `backup.timer` (diário 07h, Persistent=true, mensal-apenas), `backup-alert.service` (OnFailure
  desktop alert), `brokershark.sh` (atalho de browser). Tudo recuperável no `git log` (commit `08db96c`~).

**✅ Sub-item P1 — restore seguro: FEITO (2026-06-24).** Wrapper `python -m jobs.restore`
(`backend/jobs/restore.py`): guard **fail-closed** que recusa rodar se o dashboard está servindo
na porta (restaurar sob o writer vivo corrompe — o dashboard é o único processo que abre o DB,
então "porta servindo?" é o liveness check autoritativo); seleção de backup (`--latest` / caminho /
picker interativo / `--list`); confirmação que falha fechada sem TTY (a não ser `--yes`).
`core/backup.py::restore_backup` foi endurecido: verify + sidecar `.pre-restore` + **swap atômico**
(stage `.restore-tmp` → `os.replace`, nunca copy in-place). Gate: `tests/integration/test_restore.py`.
Ainda **manual** parar/subir o app (Ctrl+C no `./run.sh` → restore → `./run.sh`) — a automação
disso depende da decisão de runtime abaixo (se virar systemd, o wrapper pode chamar `systemctl --user`).

**Why:** A estratégia systemd (linger, units de usuário, OnFailure) tinha fricção e está pausada;
vale decidir conscientemente entre **systemd / supervisor leve / foreground-só** em vez de manter
units mortas. Constraints a respeitar: always-on local 1-user, backup mensal WAL-safe, alerta de falha.

**Pros:** runtime e recovery intencionais, não herdados; remove cruft pausado.
**Cons:** janela sem restore-script automatizado até o P1 ser feito (mitigação: cópia manual documentada).

**Effort:** M.  **Priority:** P2 (sub-item de restore = P1).  **Depends on:** nothing.

---

## T-A — Auto-suggest categories (P3, mostly done)

**What:** Suggest a likely category per uncategorized row instead of a blank `<select>`.

**Done (2026-06-24):** the suggestion engine exists and is wired to the **import preview** —
`domain.classification.merchant_key`/`build_category_index`/`suggest_from_index` learn
`(flow, merchant_key) → category` from `analytics.get_categorized_history()`; the preview
row's `<select>` pre-selects the suggestion (suggest-only, never auto-written). See the
"Categorização" invariant in CLAUDE.md + `tests/integration/test_import_suggestions.py`.

**Also done (2026-06-24):** the **bulk-categorize panel** in Histórico now surfaces the
same suggestion across the whole backlog — `analytics.get_uncategorized_merchants` groups
uncategorized rows by merchant (with the learned suggestion) and `crud.bulk_categorize`
tags every occurrence in one pick (`/api/uncategorized-merchants`,
`/api/transactions/categorize-bulk`; `test_bulk_categorize.py`). This is the high-volume
path (~474 rows after the full re-import), so it largely closes T-A.

**Remaining (optional, low):** also pre-fill the suggestion in the per-row inline `<select>`
of the Histórico table (the bulk panel covers the mass case; this is just polish for one-offs).

**Why:** Categorization stays manual by design; these make the manual pass fast.

**Effort:** S (CC).  **Priority:** P3.  **Depends on:** nothing.

---

## T-B — Credit Card Strategy (Parked)

**What:** Repensar a modelagem de Cartões de Crédito (faturas) no futuro.

**Why:** A complexidade anterior de conciliar faturas, datas de fechamento e parcelas poluía a interface e a lógica de banco de dados, divergindo do foco em liquidez imediata. A estratégia agora é focada estritamente em extratos de conta corrente. Se for necessário reintroduzir faturas no futuro, deverá ser desenhado como um módulo isolado que não comprometa a estabilidade dos extratos em "cash basis".

**Effort:** L.  **Priority:** Parked.
