# Reestruturação pragmática — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar migration runner, backup mensal automático e um launcher desktop, sem reescrever o stack (TS + `node:sqlite` + React hyperscript).

**Architecture:** Três movimentos independentes. (1) Runner forward-only lê SQL numerado e registra em `migration_log`, chamado no boot após `initSchema`. (2) Job `backup.ts` faz snapshot `VACUUM INTO` datado + poda; um systemd user timer roda mensal; o endpoint `backup-status` vira real. (3) `desktop/brokershark.py` (WebKitGTK) sobe o server em porta efêmera e o mata ao fechar a janela.

**Tech Stack:** TypeScript (Node ≥ 26, type-stripping), `node:sqlite` builtin, `node:test`, Python 3 + GTK3 + WebKit2 4.1 (já instalados), systemd user units.

## Global Constraints

- **Node ≥ 26**, sem build step (type-stripping nativo `.ts`).
- **Zero nova dep npm.** `xlsx` continua a única dependência.
- **Dinheiro em centavos inteiros** — nenhum código deste plano toca valores; não introduzir float.
- **Testes co-locados** `*.test.ts` rodando por `node:test` (`npm test`).
- **Python é launcher-only**, isolado em `desktop/`, nunca importa nem toca `backend/src`.
- **Migrations forward-only**; não contêm controle de transação (`BEGIN`/`COMMIT`) — o runner envelopa.
- **Permissões 0600** em qualquer arquivo de ledger gerado (backups incluídos).
- Commits pequenos e frequentes (um por task no mínimo).

---

## File Structure

```
backend/src/db/migrate.ts            # NOVO — runMigrations(db, dir?)
backend/src/db/migrate.test.ts       # NOVO
backend/src/db/migrations/.gitkeep   # NOVO — dir vazio no início
backend/src/db/open.ts               # inalterado
backend/src/server.ts:51-56          # MODIFICA — chama runMigrations
backend/src/jobs/backfill.ts:60      # MODIFICA — chama runMigrations
backend/src/jobs/backup.ts           # NOVO — runBackup() + backupStatus() + CLI
backend/src/jobs/backup.test.ts      # NOVO
desktop/brokershark.py               # NOVO — wrapper WebKitGTK (+ --check)
desktop/brokershark.desktop          # NOVO — entrada de menu
desktop/systemd/brokershark-backup.service  # NOVO
desktop/systemd/brokershark-backup.timer    # NOVO
desktop/icon.png                     # NOVO (best-effort, derivado do favicon)
frontend/js/screens/dashboard.js     # MODIFICA — limiar de staleness p/ cadência mensal
CLAUDE.md / README.md                # MODIFICA — docs
```

---

## Movimento 1 — Migration runner

### Task 1: Runner `migrate.ts`

**Files:**
- Create: `backend/src/db/migrate.ts`
- Create: `backend/src/db/migrations/.gitkeep`
- Test: `backend/src/db/migrate.test.ts`

**Interfaces:**
- Produces: `runMigrations(db: DatabaseSync, dir?: string): string[]` — aplica SQL pendente em ordem de nome, retorna os nomes aplicados nesta chamada. Assume `migration_log(name TEXT PK, ran_at TEXT)` já existe (via `initSchema`).

- [ ] **Step 1: Criar o diretório de migrations**

```bash
mkdir -p backend/src/db/migrations
touch backend/src/db/migrations/.gitkeep
```

- [ ] **Step 2: Escrever o teste que falha**

Create `backend/src/db/migrate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "./migrate.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE migration_log (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL)");
  return db;
}

test("aplica migrations pendentes em ordem de nome", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (y);");
  writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (x);");
  const db = freshDb();
  const ran = runMigrations(db, dir);
  assert.deepEqual(ran, ["0001_a.sql", "0002_b.sql"]);
  db.exec("INSERT INTO a (x) VALUES (1)");
  db.exec("INSERT INTO b (y) VALUES (2)");
  rmSync(dir, { recursive: true });
});

test("é idempotente — 2ª chamada é no-op", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (x);");
  const db = freshDb();
  assert.deepEqual(runMigrations(db, dir), ["0001_a.sql"]);
  assert.deepEqual(runMigrations(db, dir), []);
  rmSync(dir, { recursive: true });
});

test("falha faz ROLLBACK e lança, sem registrar", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(dir, "0001_bad.sql"), "CREATE TABLE oops (");
  const db = freshDb();
  assert.throws(() => runMigrations(db, dir), /0001_bad\.sql falhou/);
  const rows = db.prepare("SELECT name FROM migration_log").all();
  assert.equal(rows.length, 0);
  rmSync(dir, { recursive: true });
});

test("diretório sem .sql → retorna vazio", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  assert.deepEqual(runMigrations(freshDb(), dir), []);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 3: Rodar o teste — deve falhar**

Run: `cd backend && node --test "src/db/migrate.test.ts"`
Expected: FAIL — `Cannot find module './migrate.ts'`.

- [ ] **Step 4: Implementar `migrate.ts`**

Create `backend/src/db/migrate.ts`:

```ts
/**
 * @file migrate.ts
 * @brief Runner de migrations forward-only: aplica SQL numerado uma vez por DB.
 *
 * Complementa schema.sql (CREATE ... IF NOT EXISTS): cobre o que o baseline
 * idempotente NÃO expressa — ALTER/rename/drop/data-fix. Ordem = nome do arquivo
 * (NNNN_slug.sql). Cada migration roda uma vez por DB (guarda em migration_log) e
 * dentro de uma transação: falha → ROLLBACK + throw (aborta o boot).
 *
 * Migrations NÃO devem conter BEGIN/COMMIT — o runner envelopa.
 */
import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

/**
 * @brief Aplicar as migrations pendentes em ordem lexicográfica de nome.
 * @param db conexão já com initSchema aplicado (migration_log precisa existir)
 * @param dir diretório de migrations (default ./migrations) — parametrizável p/ teste
 * @return nomes das migrations aplicadas nesta chamada, em ordem
 */
export function runMigrations(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (db.prepare("SELECT name FROM migration_log").all() as { name: string }[])
      .map((r) => r.name),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO migration_log(name, ran_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${file} falhou: ${(err as Error).message}`);
    }
    ran.push(file);
  }
  return ran;
}
```

- [ ] **Step 5: Rodar o teste — deve passar**

Run: `cd backend && node --test "src/db/migrate.test.ts"`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/migrate.ts backend/src/db/migrate.test.ts backend/src/db/migrations/.gitkeep
git commit -m "feat(db): migration runner forward-only sobre migration_log"
```

### Task 2: Ligar o runner no boot

**Files:**
- Modify: `backend/src/server.ts:51-56`
- Modify: `backend/src/jobs/backfill.ts` (linha do `initSchema(db)`, ~60)

**Interfaces:**
- Consumes: `runMigrations(db)` da Task 1.

- [ ] **Step 1: Wire em `server.ts`**

Em `backend/src/server.ts`, adicionar ao import existente (linha 23):

```ts
import { openDb, initSchema, restrictPermissions } from "./db/open.ts";
import { runMigrations } from "./db/migrate.ts";
```

Substituir o bloco atual (linhas 52-56):

```ts
// schema.sql é todo CREATE ... IF NOT EXISTS: aplicar no boot cria tabela nova
// (ex.: category_budgets) num DB vivo sem rebuild, e é no-op quando já existe.
// NÃO substitui migration de verdade: ALTER/rename ainda exigiria um runner.
initSchema(db);
restrictPermissions(dbPath); // WAL/SHM recriados pelo server também ficam 0600
```

por:

```ts
// schema.sql (CREATE IF NOT EXISTS) = baseline idempotente: cria tabela nova num
// DB vivo sem rebuild, no-op quando já existe. Migrations cobrem o que ele não
// expressa (ALTER/rename/drop) — aplicadas uma vez por DB logo em seguida.
initSchema(db);
runMigrations(db);
restrictPermissions(dbPath); // WAL/SHM recriados pelo server também ficam 0600
```

- [ ] **Step 2: Wire em `backfill.ts`**

Em `backend/src/jobs/backfill.ts`, no import (linha 21):

```ts
import { openDb, initSchema, restrictPermissions } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
```

Logo após `initSchema(db);` (linha ~60), adicionar:

```ts
initSchema(db);
runMigrations(db);
```

- [ ] **Step 3: Rodar a suíte inteira — nada quebra**

Run: `cd backend && npm test`
Expected: PASS (suíte atual + os 4 testes novos da Task 1). `runMigrations` num DB sem migrations = no-op, então nenhum teste existente muda.

- [ ] **Step 4: Smoke do boot do server**

Run (com DB já existente): `cd backend && node src/server.ts & sleep 2 && curl -s -H "Host: 127.0.0.1:8000" http://127.0.0.1:8000/api/accounts >/dev/null && echo OK; kill %1`
Expected: `OK` — boot aplica `initSchema` + `runMigrations` (vazio) sem erro.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts backend/src/jobs/backfill.ts
git commit -m "feat(db): roda migrations no boot (server + backfill)"
```

---

## Movimento 2 — Backup mensal automático

### Task 3: Job `backup.ts`

**Files:**
- Create: `backend/src/jobs/backup.ts`
- Test: `backend/src/jobs/backup.test.ts`

**Interfaces:**
- Produces:
  - `runBackup(dbPath: string, destDir: string, now?: Date): string` — cria snapshot `brokershark-YYYY-MM-DD.db` (0600), poda p/ 12 mais recentes, retorna o caminho criado.
  - `backupStatus(destDir: string, now?: Date): { exists: boolean; name?: string; age_seconds?: number }` — estado do backup mais recente.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/src/jobs/backup.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup, backupStatus } from "./backup.ts";

test("runBackup: gera cópia datada válida com as tabelas", () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"));
  const src = join(dir, "src.db");
  const s = new DatabaseSync(src);
  s.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42);");
  s.close();
  const out = runBackup(src, join(dir, "backups"), new Date("2026-07-18T12:00:00Z"));
  assert.ok(out.endsWith("brokershark-2026-07-18.db"));
  const copy = new DatabaseSync(out, { readOnly: true });
  assert.equal((copy.prepare("SELECT x FROM t").get() as { x: number }).x, 42);
  copy.close();
  rmSync(dir, { recursive: true });
});

test("runBackup: retém só as 12 mais recentes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"));
  const src = join(dir, "src.db");
  const s = new DatabaseSync(src);
  s.exec("CREATE TABLE t (x)");
  s.close();
  const destDir = join(dir, "backups");
  mkdirSync(destDir, { recursive: true });
  for (let i = 1; i <= 12; i++) {
    writeFileSync(join(destDir, `brokershark-2025-01-${String(i).padStart(2, "0")}.db`), "");
  }
  runBackup(src, destDir, new Date("2026-07-18T12:00:00Z")); // 13º → poda o mais antigo
  const left = readdirSync(destDir).filter((f) => f.endsWith(".db")).sort();
  assert.equal(left.length, 12);
  assert.equal(left[left.length - 1], "brokershark-2026-07-18.db");
  assert.ok(!left.includes("brokershark-2025-01-01.db"));
  rmSync(dir, { recursive: true });
});

test("backupStatus: sem dir → exists false", () => {
  assert.deepEqual(backupStatus(join(tmpdir(), "nao-existe-xyz-123")), { exists: false });
});

test("backupStatus: pega o mais recente e calcula idade em segundos", () => {
  const dir = mkdtempSync(join(tmpdir(), "bs-"));
  writeFileSync(join(dir, "brokershark-2026-07-10.db"), "");
  writeFileSync(join(dir, "brokershark-2026-07-15.db"), "");
  const st = backupStatus(dir, new Date("2026-07-18T00:00:00Z"));
  assert.deepEqual(st, { exists: true, name: "brokershark-2026-07-15.db", age_seconds: 3 * 86400 });
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Rodar o teste — deve falhar**

Run: `cd backend && node --test "src/jobs/backup.test.ts"`
Expected: FAIL — `Cannot find module './backup.ts'`.

- [ ] **Step 3: Implementar `backup.ts`**

Create `backend/src/jobs/backup.ts`:

```ts
/**
 * @file backup.ts
 * @brief Backup mensal do ledger: snapshot consistente (VACUUM INTO), datado, retém 12.
 *
 * Sem cifra (desktop caseiro; threat model exclui roubo físico). Seguro contra
 * perda/corrupção de disco e DELETE acidental. Rodado por systemd user timer mensal.
 *
 * Uso: node src/jobs/backup.ts [<db>] [<destDir>]
 */
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEEP = 12;
const RE = /^brokershark-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * @brief Gerar snapshot datado do DB e podar cópias antigas.
 * @param dbPath caminho do .db de origem
 * @param destDir diretório de destino (criado se não existir)
 * @param now data de referência (injeta p/ teste)
 * @return caminho do arquivo de backup criado
 */
export function runBackup(dbPath: string, destDir: string, now: Date = new Date()): string {
  if (!existsSync(dbPath)) throw new Error(`DB não encontrado: ${dbPath}`);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `brokershark-${now.toISOString().slice(0, 10)}.db`);
  const db = new DatabaseSync(dbPath);
  // VACUUM INTO serializa o estado atual num arquivo novo e limpo — WAL-safe, origem intacta.
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
  chmodSync(dest, 0o600);
  prune(destDir);
  return dest;
}

/** @brief Manter só as KEEP cópias mais recentes (nome datado = ordem cronológica). */
function prune(destDir: string): void {
  const backups = readdirSync(destDir).filter((f) => RE.test(f)).sort();
  for (const f of backups.slice(0, Math.max(0, backups.length - KEEP))) {
    rmSync(join(destDir, f));
  }
}

/**
 * @brief Estado do backup mais recente: existência, nome e idade em segundos.
 * @param destDir diretório de backups
 * @param now referência p/ idade (injeta p/ teste)
 */
export function backupStatus(
  destDir: string,
  now: Date = new Date(),
): { exists: boolean; name?: string; age_seconds?: number } {
  if (!existsSync(destDir)) return { exists: false };
  const backups = readdirSync(destDir).filter((f) => RE.test(f)).sort();
  if (backups.length === 0) return { exists: false };
  const name = backups[backups.length - 1];
  const day = name.slice("brokershark-".length, -".db".length);
  const ageMs = now.getTime() - new Date(`${day}T00:00:00Z`).getTime();
  return { exists: true, name, age_seconds: Math.max(0, Math.floor(ageMs / 1000)) };
}

// Entrada CLI — só quando executado direto (não no import do teste).
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbPath = args[0] ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
  const destDir = args[1] ?? join(homedir(), "brokershark-backups");
  console.log(`Backup: ${runBackup(dbPath, destDir)}`);
}
```

- [ ] **Step 4: Rodar o teste — deve passar**

Run: `cd backend && node --test "src/jobs/backup.test.ts"`
Expected: PASS (4 testes).

- [ ] **Step 5: Smoke da CLI (com DB real)**

Run: `cd backend && node src/jobs/backup.ts && ls ~/brokershark-backups/`
Expected: imprime `Backup: .../brokershark-YYYY-MM-DD.db` e o arquivo aparece no `ls`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/jobs/backup.ts backend/src/jobs/backup.test.ts
git commit -m "feat(backup): job de snapshot mensal (VACUUM INTO) + status"
```

### Task 4: Endpoint `backup-status` real + limiar do dashboard

**Files:**
- Modify: `backend/src/server.ts:20-77` (import + handler)
- Modify: `frontend/js/screens/dashboard.js:234` (limiar de staleness)

**Interfaces:**
- Consumes: `backupStatus(destDir)` da Task 3.
- Contrato preservado com o front: `{ exists, name?, age_seconds? }` (ver `frontend/js/core/api.js:142`).

- [ ] **Step 1: Trocar o stub por leitura real em `server.ts`**

Adicionar imports (junto aos existentes no topo):

```ts
import { homedir } from "node:os";
import { backupStatus } from "./jobs/backup.ts";
```

Adicionar a constante de config (perto de `dbPath`, ~linha 43):

```ts
const BACKUP_DIR = process.env.BROKERSHARK_BACKUP_DIR ?? join(homedir(), "brokershark-backups");
```

Substituir o handler stub (linhas 67-77):

```ts
function handleBackupStatus(_req: Req, res: Res): void {
  json(res, { exists: false });
}
```

por:

```ts
/**
 * @brief Responder o estado do backup mais recente lendo o diretório de backups.
 * @param _req requisição (ignorada) · @param res resposta {exists, name?, age_seconds?}
 */
function handleBackupStatus(_req: Req, res: Res): void {
  json(res, backupStatus(BACKUP_DIR));
}
```

- [ ] **Step 2: Ajustar o limiar de staleness p/ cadência mensal**

Em `frontend/js/screens/dashboard.js`, a lógica de backup usa `backupStale = d > 7`. Com backup **mensal**, 7 dias acenderia "atrasado" quase o mês todo. Trocar o limiar. Localizar:

```js
      backupStale = d > 7;
```

Substituir por:

```js
      backupStale = d > 40; // backup é mensal — atrasado só passando de ~1 mês
```

- [ ] **Step 3: Smoke — endpoint reflete o backup criado na Task 3**

Run: `cd backend && node src/server.ts & sleep 2 && curl -s -H "Host: 127.0.0.1:8000" http://127.0.0.1:8000/api/backup-status; echo; kill %1`
Expected: JSON `{"exists":true,"name":"brokershark-YYYY-MM-DD.db","age_seconds":...}` (após rodar o backup da Task 3). Sem backups → `{"exists":false}`.

- [ ] **Step 4: Rodar a suíte**

Run: `cd backend && npm test`
Expected: PASS. (O front não tem teste do dashboard; a mudança é de limiar visual.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts frontend/js/screens/dashboard.js
git commit -m "feat(backup): backup-status lê o diretório real; limiar mensal no dashboard"
```

### Task 5: Agendamento systemd (mensal)

**Files:**
- Create: `desktop/systemd/brokershark-backup.service`
- Create: `desktop/systemd/brokershark-backup.timer`

**Interfaces:**
- Consumes: a CLI de `backend/src/jobs/backup.ts` (Task 3).

- [ ] **Step 1: Criar o service unit**

Create `desktop/systemd/brokershark-backup.service`:

```ini
[Unit]
Description=BrokerShark — backup mensal do ledger

[Service]
Type=oneshot
# Ajuste o caminho do node se necessário (which node). %h = seu $HOME.
ExecStart=/usr/bin/node %h/Projects/BrokerShark/backend/src/jobs/backup.ts
```

- [ ] **Step 2: Criar o timer unit**

Create `desktop/systemd/brokershark-backup.timer`:

```ini
[Unit]
Description=BrokerShark — dispara o backup mensal

[Timer]
OnCalendar=monthly
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Instalar e validar (manual)**

Run:

```bash
mkdir -p ~/.config/systemd/user
cp desktop/systemd/brokershark-backup.* ~/.config/systemd/user/
# confirme o caminho do node no .service: which node
systemctl --user daemon-reload
systemctl --user start brokershark-backup.service   # dispara já, uma vez
systemctl --user enable --now brokershark-backup.timer
systemctl --user list-timers | grep brokershark
```

Expected: `start` cria um backup em `~/brokershark-backups/`; `list-timers` mostra o próximo disparo mensal.

- [ ] **Step 4: Commit**

```bash
git add desktop/systemd/
git commit -m "feat(backup): systemd user timer mensal"
```

---

## Movimento 3 — Wrapper desktop

### Task 6: `brokershark.py` (WebKitGTK, dono do server)

**Files:**
- Create: `desktop/brokershark.py`

**Interfaces:**
- Consumes: `node src/server.ts --port N` (server já parseia `--port`, ver `server.ts:40`).

- [ ] **Step 1: Implementar o wrapper**

Create `desktop/brokershark.py`:

```python
#!/usr/bin/env python3
"""BrokerShark — janela desktop (WebKitGTK) dona do ciclo de vida do server.

Abre → porta livre → sobe `node src/server.ts --port N` → espera 200 → carrega no
WebView. Fecha → SIGTERM no node (SIGKILL de fallback) → sai. Nada sobra rodando.

Deps runtime: python-gobject, gtk3, webkit2gtk-4.1, node >= 26.
Uso: python brokershark.py [--check]
  --check: smoke headless — sobe server, confirma 200, encerra. Sem GUI.
"""
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(port: int) -> subprocess.Popen:
    return subprocess.Popen(
        ["node", "src/server.ts", "--port", str(port)], cwd=str(BACKEND)
    )


def wait_ready(port: int, timeout: float = 15.0) -> bool:
    url = f"http://127.0.0.1:{port}/"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def stop_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()  # SIGTERM
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()  # SIGKILL


def run_check() -> int:
    port = free_port()
    proc = start_server(port)
    try:
        ok = wait_ready(port)
        print("OK" if ok else "FALHOU: server não respondeu 200")
        return 0 if ok else 1
    finally:
        stop_server(proc)


def run_gui() -> int:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gtk, WebKit2

    port = free_port()
    proc = start_server(port)
    if not wait_ready(port):
        stop_server(proc)
        print("FALHOU: server não subiu", file=sys.stderr)
        return 1

    win = Gtk.Window(title="BrokerShark")
    win.set_default_size(1400, 900)
    icon = Path(__file__).resolve().parent / "icon.png"
    if icon.exists():
        win.set_icon_from_file(str(icon))
    view = WebKit2.WebView()
    view.load_uri(f"http://127.0.0.1:{port}")
    win.add(view)

    def on_destroy(*_):
        stop_server(proc)
        Gtk.main_quit()

    win.connect("destroy", on_destroy)
    win.show_all()
    Gtk.main()
    return 0


def main() -> int:
    if "--check" in sys.argv[1:]:
        return run_check()
    return run_gui()


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Smoke headless (`--check`)**

Run (precisa do DB já criado pelo backfill): `python desktop/brokershark.py --check`
Expected: imprime `OK`, sai 0. Nenhum processo `node` sobra:
`pgrep -f "server.ts" || echo "nenhum node vivo"` → `nenhum node vivo`.

- [ ] **Step 3: Smoke GUI (manual, com display gráfico)**

Run: `python desktop/brokershark.py`
Expected: janela "BrokerShark" abre com o dashboard; ao fechar a janela, `pgrep -f "server.ts"` fica vazio.

- [ ] **Step 4: Commit**

```bash
git add desktop/brokershark.py
git commit -m "feat(desktop): wrapper WebKitGTK dono do ciclo de vida do server"
```

### Task 7: Entrada de menu + ícone + docs

**Files:**
- Create: `desktop/brokershark.desktop`
- Create: `desktop/icon.png` (best-effort)
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Gerar o ícone (best-effort)**

Run (ImageMagick opcional; o wrapper funciona sem ícone):

```bash
magick "frontend/img/favicon.ico[0]" desktop/icon.png 2>/dev/null \
  || convert "frontend/img/favicon.ico[0]" desktop/icon.png 2>/dev/null \
  || echo "sem ImageMagick — pulei o ícone (opcional; a janela abre sem ele)"
```

- [ ] **Step 2: Criar a entrada de menu**

Create `desktop/brokershark.desktop` (ajuste os caminhos absolutos p/ o seu clone):

```ini
[Desktop Entry]
Type=Application
Name=BrokerShark
Comment=Análise de dinheiro pessoal (local)
Exec=python3 /home/felipe/Projects/BrokerShark/desktop/brokershark.py
Icon=/home/felipe/Projects/BrokerShark/desktop/icon.png
Terminal=false
Categories=Office;Finance;
```

- [ ] **Step 3: Instalar no menu (manual)**

Run:

```bash
cp desktop/brokershark.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

Expected: "BrokerShark" aparece no lançador de apps do sistema.

- [ ] **Step 4: Documentar no `README.md`**

Adicionar uma seção "Rodar como app desktop" ao `README.md` com: deps runtime (`python-gobject`, `gtk3`, `webkit2gtk-4.1`, `node ≥ 26`), instalação do `.desktop`, do timer de backup (Task 5), e a nota de ajuste de caminhos absolutos.

- [ ] **Step 5: Atualizar `CLAUDE.md`**

Duas edições:
1. Na seção "Key principles", o item que diz *"Schema aplica no boot; NÃO há migration runner"* — passa a existir runner. Reescrever para: baseline idempotente (`schema.sql`) + **migrations forward-only** (`db/migrate.ts` sobre `migration_log`) aplicadas no boot; documentar a disciplina de baseline (uma vez que uma migration altera uma tabela, o DDL dela em `schema.sql` congela; tabela nova independente ainda pode entrar direto no schema).
2. Registrar em "Repository Structure": `desktop/` (wrapper WebKitGTK + `.desktop` + systemd), `jobs/backup.ts` (backup mensal), `db/migrate.ts` + `db/migrations/`.

- [ ] **Step 6: Commit**

```bash
git add desktop/brokershark.desktop desktop/icon.png README.md CLAUDE.md
git commit -m "feat(desktop): entrada de menu + ícone; docs de migrations/backup/app"
```

---

## Self-Review

**Spec coverage:**
- Mov 1 (migration runner, disciplina baseline, wiring nos 2 boots) → Tasks 1-2. ✓
- Mov 2 (VACUUM INTO datado, retém N, systemd mensal, backup-status real) → Tasks 3-5. ✓
- Mov 3 (wrapper Python porta efêmera + mata node, .desktop, ícone) → Tasks 6-7. ✓
- Docs (CLAUDE.md paragraph + README) → Task 7. ✓
- Não-objetivos (cifra/Tauri/down-migrations) → não implementados. ✓

**Placeholder scan:** sem TBD/TODO; todo passo tem código ou comando real. ✓

**Type consistency:** `runMigrations(db, dir?)→string[]`, `runBackup(dbPath,destDir,now?)→string`, `backupStatus(destDir,now?)→{exists,name?,age_seconds?}` — usados de forma idêntica em servidor/testes/CLI. Contrato `backup-status` bate com `api.js:142`. Funções Python `free_port/start_server/wait_ready/stop_server` consistentes entre `run_check` e `run_gui`. ✓

**Nota de risco:** `VACUUM INTO` numa conexão aberta em modo leitura pode ser rejeitado por algumas versões do SQLite — por isso `runBackup` abre em read-write (origem permanece intacta pelo próprio contrato do `VACUUM INTO`). Se o passo de smoke da Task 3 falhar com erro de permissão de escrita, é sinal de DB montado read-only no FS, não do código.
