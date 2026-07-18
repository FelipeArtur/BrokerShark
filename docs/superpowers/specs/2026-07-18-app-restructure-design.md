# Reestruturação pragmática — migrations + backup + app desktop

> Data: 2026-07-18 · Branch alvo: a definir a partir de `main`.
>
> Três movimentos independentes que fecham os gaps de mercado do projeto **sem
> reescrever o stack** (TS backend + `node:sqlite` + React hyperscript continuam).
> Ordem de payoff: **1 migrations → 2 backup → 3 wrapper**.

## Contexto e motivação

O stack atual está ~80% alinhado com convenção de mercado para app financeiro
local (família "servidor web local + browser": Actual Budget, Fava, Firefly). O
que destoa é o artesanal-do-zero — escolha deliberada por confiabilidade e baixa
dependência, não um erro. Três gaps reais restam:

1. **Sem migration runner.** `schema.sql` só cresce por tabela nova
   (`CREATE IF NOT EXISTS`); `ALTER`/rename/drop "não têm por onde rodar". É o
   bloqueador nº1 de evolvability.
2. **Sem backup.** Risco real do ledger não é rede nem roubo (desktop caseiro) —
   é disco morrer, corromper, ou DELETE errado. Hoje não há cópia.
3. **Não "vira app".** Roda por `npm start` + browser. Falta janela clicável.

**Fora de escopo (decidido):** cifra at-rest (LUKS/gocryptfs/age) — desktop
caseiro, risco de roubo físico baixo. LUKS fica anotado como ideal só numa
reinstalação futura, nunca retrofit scriptado.

---

## Movimento 1 — Migration runner

### Objetivo
Permitir mudança de schema que `CREATE IF NOT EXISTS` não expressa
(`ALTER`/rename/drop/data-fix), de forma reproduzível em DB fresco e vivo.

### Design

- **Arquivos numerados:** `backend/src/db/migrations/NNNN_slug.sql` (4 dígitos
  zero-padded, ordem lexicográfica = ordem de aplicação). Ex.:
  `0001_rename_foo.sql`.
- **Runner:** `backend/src/db/migrate.ts` exporta `runMigrations(db)` (~40 linhas,
  zero dep). Lógica:
  1. Lê o diretório `migrations/`, ordena por nome de arquivo.
  2. Consulta `migration_log` (tabela que **já existe no schema e ninguém lê**)
     pelos `name` já aplicados.
  3. Para cada arquivo pendente: abre transação → `db.exec(sql)` →
     `INSERT INTO migration_log(name, ran_at)` → commit. Falha em qualquer
     migration → **rollback dessa migration + aborta o boot** (throw).
- **Forward-only.** Sem down-migrations (YAGNI para 1 usuário).
- **Wiring:** chamar `runMigrations(db)` **logo após** `initSchema(db)` nos dois
  sites de boot: `server.ts:55` e `backfill.ts:60`. Assim DB fresco (backfill) e
  DB vivo (server) convergem para a mesma ordem.

### Disciplina de baseline (regra load-bearing)

Para evitar a armadilha "migration altera tabela que o `schema.sql` já criou na
forma pós-migration":

- `schema.sql` = **DDL gênese**. Uma vez que uma migration **altera** uma tabela,
  o DDL daquela tabela em `schema.sql` **congela** — não se edita mais.
- **Tabela nova e independente** (nada a migrar) pode continuar entrando direto no
  `schema.sql` (idempotente, seguro em fresco e vivo). Mantém a conveniência atual.
- `migration_log` garante que cada migration nomeada roda **uma vez por DB**.
  - DB fresco: `schema.sql` (gênese) + replay de todas as migrations = forma atual.
  - DB vivo: `schema.sql` no-op (`IF NOT EXISTS`) + replay só das não-aplicadas.
- **Adoção:** o `schema.sql` de hoje é tratado como gênese; `migration_log` começa
  vazio; a primeira migration é `0001`. DBs existentes já batem com a gênese, então
  nenhuma migration é necessária ainda — elas só acumulam daqui pra frente.

### Testes (`backend/src/db/migrate.test.ts`, `node:test`)

- DB fresco: replay aplica todas as pendentes na ordem correta.
- Idempotência: rodar `runMigrations` 2x não reaplica (2ª é no-op).
- Falha: migration com SQL inválido faz rollback (estado inalterado) e lança.
- `migration_log` registra `name` + `ran_at` de cada aplicada.

---

## Movimento 2 — Backup mensal automático

### Objetivo
Cópia consistente e datada do `.db` uma vez por mês, automática, sem cifra.
Seguro contra perda/corrupção de disco e DELETE acidental.

### Design

- **Script:** `backend/src/jobs/backup.ts` (`node src/jobs/backup.ts`). Usa
  `node:sqlite` — **sem dep de `sqlite3` CLI, sem bash frágil**:
  1. Abre o DB.
  2. `db.exec("VACUUM INTO '<dest>'")` → cópia limpa e **consistente mesmo com
     WAL** (VACUUM INTO serializa o estado atual num arquivo novo).
  3. Destino: `~/brokershark-backups/brokershark-YYYY-MM-DD.db`.
  4. `restrictPermissions` (0600) na cópia — mesma fronteira do original.
  5. **Retenção:** mantém as 12 cópias mais recentes; remove as mais antigas.
- **Agendamento (systemd user):** `desktop/systemd/`
  - `brokershark-backup.service` — `Type=oneshot`, roda o node script.
  - `brokershark-backup.timer` — `OnCalendar=monthly` + `Persistent=true`
    (recupera o run se o PC estava desligado na data).
  - Instalação documentada no `README.md` (`systemctl --user enable --now
    brokershark-backup.timer`).

### Testes (`backend/src/jobs/backup.test.ts`, `node:test`)

- Gera cópia; o arquivo resultante abre como SQLite válido e tem as mesmas tabelas.
- `VACUUM INTO` produz snapshot íntegro com WAL ativo.
- Retenção: com 13 cópias simuladas, poda para 12 (remove a mais antiga).
- Cópia nasce 0600.

---

## Movimento 3 — Wrapper desktop (Python WebKitGTK, dono do server)

### Objetivo
Janela desktop dedicada (sem barra de URL, ícone no menu) que **é dona do ciclo
de vida do server**: abre → sobe o Node; fecha → mata o Node. Nada sobra rodando.

### Por que Python GTK
Único caminho **zero-build** para WebKit nesta máquina. Já instalados:
`webkit2gtk-4.1`, `python-gobject`, `gtk3/4`. Node não tem binding WebKit sem
compilar nativo. Tauri = build Rust (rejeitado). Python fica **isolado como
launcher em `desktop/`, fora de `backend/src` — nunca toca o ledger.**

### Design

- **`desktop/brokershark.py`** (GTK3 + WebKit2 4.1):
  1. **Porta efêmera:** `bind` num socket na porta 0, lê a porta atribuída, fecha.
     Evita choque de "8000 já em uso".
  2. **Sobe o server:** `subprocess.Popen(["node", "src/server.ts", "--port", N],
     cwd=<backend>)`.
  3. **Espera pronto:** poll `GET http://127.0.0.1:N/` até 200 ou timeout (~10 s);
     se estourar, mata o subprocess e sai com erro.
  4. **Janela:** `Gtk.Window` (título "BrokerShark", ~1400×900, ícone do app)
     contendo um `WebKit2.WebView` que carrega `http://127.0.0.1:N`.
  5. **Fechar:** sinal `destroy` → `SIGTERM` no subprocess → aguarda →
     `SIGKILL` de fallback → `Gtk.main_quit()`.
- **`desktop/brokershark.desktop`:** entrada de menu.
  `Exec=python <path>/brokershark.py`, `Icon=<path>`,
  `Categories=Office;Finance;`.
- **Ícone:** derivar de `frontend/img/favicon.ico` (ou PNG novo). Sem asset →
  placeholder simples.
- **`--check` (smoke, opcional):** modo headless que sobe o server, faz o poll,
  confirma 200 e sai 0 — testável sem GUI.

### Dependências (todas já presentes / runtime)
`python-gobject`, `gtk3`, `webkit2gtk-4.1`, `node ≥ 26`. Documentar no `README.md`.

### Testes
GUI GTK não é unit-testável de forma barata. Cobertura via:
- `--check` headless (server sobe + responde 200 + processo encerra limpo).
- QA manual: abrir, usar, fechar; confirmar que nenhum `node` sobra
  (`pgrep -f server.ts` vazio após fechar).

---

## Estrutura de arquivos nova

```
backend/src/db/migrations/          # SQL numerado (vazio no início)
backend/src/db/migrate.ts           # runner + migrate.test.ts
backend/src/jobs/backup.ts          # backup mensal + backup.test.ts
desktop/
  brokershark.py                    # wrapper WebKitGTK
  brokershark.desktop               # entrada de menu
  systemd/
    brokershark-backup.service
    brokershark-backup.timer
  icon.png                          # opcional
```

Nada renomeia/remove do layout atual. `desktop/` é novo top-level (Python
isolado). `migrate.ts`/`backup.ts` seguem a convenção existente (co-locados com
`*.test.ts`, `node:test`).

## Atualizações de documentação

- **`CLAUDE.md`:** trocar o parágrafo "Schema aplica no boot; NÃO há migration
  runner" — passa a existir runner; documentar a disciplina de baseline.
  Registrar `desktop/` e o backup mensal.
- **`README.md`:** seções de instalação do timer de backup e do launcher desktop.

## Não-objetivos

- Cifra at-rest (LUKS/gocryptfs/age) — fora de escopo por threat model.
- Reescrever backend, adotar framework, ORM, ou build step de frontend.
- Down-migrations, migração de dados multi-etapa complexa.
- Empacotar binário distribuível (Tauri/Electron) — é ferramenta de 1 máquina.
