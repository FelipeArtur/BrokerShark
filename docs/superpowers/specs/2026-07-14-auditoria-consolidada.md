# Auditoria Consolidada — BrokerShark

> Data: 2026-07-14 · Escopo: arquitetura, organização de arquivos, estratégias de uso/escopo, UI, segurança.
> Modo: read-only (nenhuma mudança de código nesta auditoria). Base: ~5.800 LOC (2.825 backend, 2.955 frontend), 32 rotas, schema v2.
> Método UI (impeccable critique): ⚠️ DEGRADED single-context (sem sub-agents por política do harness; server offline → sem screenshots; mobile fora de escopo por PRODUCT.md). Detector determinístico rodou: 0 achados (baixo sinal — a UI é JS-gerada, não markup).

---

## 0. Veredito

Projeto **maduro e bem-arquitetado** para o tamanho. Camadas reais, dinheiro em centavos, invariantes documentadas, UI deliberada (anti-slop). Não é protótipo.

**Um bug estrutural crítico** e **um furo de segurança alto** justificam ação antes de qualquer expansão:

| Prio | Achado | Dimensão |
|------|--------|----------|
| 🔴 P0 | Backfill `rmSync` destrói dados escritos pela UI | Arquitetura |
| 🔴 P0 | Sem check de `Origin` → CSRF nos POST de escrita | Segurança |
| 🟠 P1 | Zero testes num app que se vende como "confiável" | Arquitetura |
| 🟠 P1 | Dois caminhos de ingestão duplicam invariantes | Arquitetura |
| 🟡 P2 | `xlsx@0.18.5` vulnerável, agora recebe upload não-confiável | Segurança |
| 🟡 P2 | Contraste `--fg-3` borderline <4.5:1 | UI |
| 🟡 P2 | Staging de import perdido no refresh/restart | UI + Arquitetura |

---

## 1. Arquitetura

### Estado
```
ingest/ (parsers)  →  domain/ (PURO: money, classify, dates, positions)
       ↓                          ↑ reusado por
jobs/backfill/ (fases 1-por-arquivo) ─┘
       ↓ escreve
db/ SQLite (centavos inteiros, WAL, 0600)
       ↑ lê                 http/ (router, sse, multipart, security) → routes/ (handlers finos)
frontend/ (React hyperscript, sem build, offline) ← SSE
```

**Fortes (manter):** `domain/` puro e testável; centavos inteiros; zero-deps (só `xlsx`); invariantes concentradas em módulos compartilhados; handlers finos com SQL nomeado.

### Achado A (P0) — Backfill destrói dados da UI
`jobs/backfill.ts` faz `rmSync(dbPath, -wal, -shm)` e reconstrói do zero. Enquanto a UI era read-only, tudo bem. **Agora a UI escreve** (apelido, categoria, terceiros, lançamento manual, lotes importados via `/api/import/*`, renomear categoria). O próximo `backfill` **apaga tudo isso**. É o conflito central introduzido ao ligar a UI de escrita.

### Achado B (P1) — Dois caminhos de ingestão
`backfill/extratos.ts` e `routes/import.ts` reimplementam dedup/classificação. Invariante replicada diverge com o tempo. (Metade disso foi introduzida ao adicionar `import.ts`.)

### Achado C (P1) — Zero testes
Nenhum teste. `domain/` puro é trivial de cobrir; invariantes (regra consumo-despesa, dupla contagem, dedup) pedem golden/property tests.

### Alvo — evolução, não rewrite
> **Aposentar o "wipe & rebuild". Um core de ingestão idempotente vira o único caminho de escrita; backfill = importar o acervo inteiro PELO MESMO pipeline, preservando dados do usuário.**

```
        ┌── core/pipeline.ts (ÚNICO caminho de escrita) ──────────────────┐
Sources │ dedup(por-fonte) → classify(rules+domain) → upsert              │
─Record→│                                       ↓                          │
        │ post-process idempotente: selfPairs · faturas · caixinha · b3   │
        │                                       ↓ verify(invariantes)      │
        └──────────────────────────────────────────────────────────────────┘
             ▲ backfill (bulk, SEM rmSync)      ▲ import (incremental, staged)
```
Falta p/ backfill virar idempotente (pequeno): `seeds` → `INSERT OR IGNORE`; dedup Inter semeado do DB (**já feito em `import.ts`** — extrair); `faturas`/`caixinha` idempotentes (`rederiveCaixinha` **já existe**); remover `rmSync`.

**Durabilidade:** separar *fatos importados* (reconstruíveis) de *overlay do usuário* (apelido, categoria, manual, regras — não reconstruível). Com pipeline idempotente o overlay sobrevive por nunca ser apagado. Reforço: **classificação via `rules`** (hoje decorativa) — editar na UI vira `rule`, tornando a classificação dado replayável.

---

## 2. Organização de arquivos

**Backend: exemplar.** `domain/ingest/http/routes/jobs`, 1 preocupação por arquivo, arquivos pequenos (média ~70 LOC). Nada a mudar.

**Frontend: começando a inchar.** `primitives.js` (634) mistura formatadores + charts + `Modal/Drawer/BankChip/TxRow` + classificadores (`isSelf/isInvest/...`). `view-dashboard.js` (572), `modal-import.js` (506). Sinal de "fazendo demais".
- **Sugestão:** quebrar `primitives.js` em `format.js` (fmt*), `components.js` (Modal/Drawer/BankChip/TxRow), `charts.js` (Donut/DualLine), `classify.js` (isSelf/isInvest/isRevenue/isConsumptionExpense). Mantém o ethos sem-build (IIFE + `window.BS`).
- **Acoplamento latente:** namespace global `window.BS` é a fronteira à medida que cresce. Aceitável hoje; um `store.js` (pub/sub sobre SSE) reduziria o refetch ad-hoc conforme escala.

---

## 3. Estratégias de uso & escopo

Escopo **já bem documentado**: `PRODUCT.md` (usuário único, "quanto posso gastar", dashboard único, anti-refs, a11y AA) + `DESIGN.md` (sistema visual). Sólido. Validação:

- ✅ **Coerente:** produto = análise; import é apoio; drill-down não navegação; offline/local.
- ⚠️ **Lacuna de escopo (expansão):** não há lista do que ENTRA/SAI para o futuro. Direções plausíveis a delimitar: orçamentos/metas, previsão ("quanto vou poder gastar"), motor de regras (auto-categorização — `rules` já existe), recorrências/alertas, novas fontes (parsers). Recomendo um `## Roadmap / Não-objetivos` no PRODUCT.md.
- ⚠️ **Onboarding/primeiro uso** não é escopo declarado: DB vazio → dashboard sem estado útil. Definir empty states.
- ✅ **Mobile fora de escopo** (≥1280px) — decisão explícita, respeitada.

---

## 4. UI (impeccable critique — degraded)

### Design Health (Nielsen, honesto p/ ferramenta de 1 usuário-especialista)
| # | Heurística | Nota | Ponto |
|---|-----------|:----:|------|
| 1 | Visibilidade de status | 3 | SSE ao vivo, toasts, estados "Analisando…/Salvando…", flash de save |
| 2 | Mundo real | 3 | pt-BR de domínio; jargão (SELF/liquidação/Porquinho) mas o usuário É o especialista |
| 3 | Controle & liberdade | 3 | Esc fecha, undo no delete (restore), reverter lote, seletor de mês |
| 4 | Consistência | 3 | tokens + cores semânticas + primitivas; leve divergência de inline-style (redesign do view-overview) |
| 5 | Prevenção de erro | 3 | dedup, confirm-delete, validação server-side, revisão staged antes do commit |
| 6 | Reconhecer > lembrar | 3 | dicas kbd visíveis; alguns atalhos (i/c) dependem de memória |
| 7 | Flexibilidade/eficiência | 3 | atalhos, bulk categorize, drill-downs, densidade |
| 8 | Estético/minimalista | 3 | denso por design mas hierárquico; on-brand |
| 9 | Recuperação de erro | 3 | copy boa no import ("Confira se a conta…"), toasts, undo |
| 10 | Ajuda/documentação | 2 | sem ajuda in-app (só `title`); aceitável p/ 1 especialista |
| **Total** | | **30/40** | **Good** — base sólida, pontos fracos localizados |

### Anti-slop: **passa.** Combate ativamente as anti-refs (não é card-grid genérico, não é banco roxo infantil, não é terminal hostil). Números mono, cores semânticas, chips de proveniência. Não parece "AI fez isso".

### Priority issues
- **[P2] Contraste `--fg-3`.** `oklch(53% …)` sobre `bg-0 (12%)` ~4:1; sobre `bg-1/2` cai abaixo; placeholders usam `--fg-3`. Light: `fg-3 (64%)` sobre `bg-1 (99.5%)` ~3:1. Regra impeccable #1. **Fix:** puxar `--fg-3` para o lado do ink (~L58% dark / ~L58% light) OU restringir a texto grande/não-essencial; placeholder nunca em `--fg-3`. → `/impeccable audit` ou `colorize`.
- **[P1] Staging perdido no refresh.** Batch em memória (backend, TTL 1h) + estado no React. Refresh/restart no meio da revisão de import → lote perde-se, re-dropar arquivos. Persona Riley. **Fix:** persistir staging (SQLite table ou localStorage do batch_id) OU avisar antes de sair. → `harden`.
- **[P1] Empty/first-run.** DB vazio sem estado útil. Persona Jordan/Riley. → `/impeccable onboard`.
- **[P2] Carga cognitiva no import (step-2).** Por linha: checkbox + select de categoria + valor editável + apelido editável + tag + (banner divergência + header de grupo). OK p/ manutenção mensal (Alex), pesado p/ primeira vez (Jordan). Bem estruturado (progressive: drop→revisão). Monitorar.

### Personas
- **Alex (power):** bem servido — teclado, bulk, drill. Sem red flags graves.
- **Sam (a11y):** contraste `--fg-3` borderline; foco visível existe (11 `outline`, 3 `:focus`) mas confie menos no default; significado por cor é reforçado por sinal (+/−) e chips (bom); tema escuro denso cansa em zoom.
- **Riley (edge):** staging no refresh (acima); strings longas tratadas (ellipsis); empty states faltam.

---

## 5. Segurança (vibesec — bug-hunter)

Threat model atípico: bind `127.0.0.1`, sem auth (perms `0600` = fronteira at-rest). O app **se preocupa com DNS-rebinding**, então o adversário real = **página maliciosa no browser do usuário** enquanto o server roda.

### SEC-1 (ALTO) — CSRF: sem check de `Origin`
`security.ts` valida `Host` (anti DNS-rebinding) mas **não** `Origin`. `readBody` faz `JSON.parse` ignorando `Content-Type` → endpoints JSON viram "simple request" via `Content-Type: text/plain` (sem preflight CORS). Uma página que o usuário visite pode disparar POST cross-origin com efeito colateral (resposta é bloqueada, o **write executa**):
- `POST /api/transactions` (lançamento manual falso), `POST /api/categories`, `POST /api/investment-movements`, `POST /api/import/b3` (multipart = simple).
- (DELETE/PATCH exigem preflight → bloqueados sem ACAO. `import/confirm` precisa de `batch_id` que o atacante não conhece.)

Impacto: corrupção silenciosa do ledger. **Fix (~5 linhas em `security.ts`):** em métodos != GET, rejeitar quando `Origin` presente e fora do allowlist localhost. Fetches same-origin do próprio app mandam `Origin: http://127.0.0.1:PORT` (permitido).

### SEC-2 (MÉDIO) — Dependência `xlsx@0.18.5`
Advisories conhecidos (Prototype Pollution GHSA-4r6h-8v6p-xvw6 CVSS 7.8; ReDoS) sem fix na versão publicada no npm (SheetJS self-hospeda ≥0.19.3). Agora recebe **upload não-confiável** via UI/CSRF. **Fix:** migrar para o build do CDN oficial do SheetJS, ou validar/sandbox o parse.

### SEC-3 (BAIXO / hardening) — multipart sem cap de partes
`http/multipart.ts` limita 20MB totais mas não o nº de partes. Corpo com milhares de partes minúsculas → CPU. Bounded pelos 20MB. **Fix:** cap de partes (ex. ≤32).

### Positivos (verificados)
- SQL **100% parametrizado** (WHERE dinâmico usa predicados estáticos + `?`; ORDER BY hardcoded; LIMIT `?`). Sem injection.
- XSS limpo: React `createElement` escapa; único `dangerouslySetInnerHTML` = mapa **estático** de ícones (`ICONS[t.kind]`), nunca input do usuário; CSP self-only de backstop.
- Path traversal guardado em `static.ts`; PATCH com whitelist explícita (sem mass-assignment); erros não vazam stack; perms 0600 (server + backfill, incl. WAL/SHM); body caps.

---

## 6. Plano de remediação (ordem sugerida)

| Fase | Escopo | Fecha | Esforço |
|------|--------|-------|---------|
| **0** | `node:test` + golden fixtures (`domain/` + parsers + invariantes) | C (rede de segurança) | 1 sessão |
| **1** | SEC-1 Origin check + SEC-3 cap de partes | CSRF | pequeno |
| **2** | `core/pipeline.ts`: extrair dedup+insert+post-process; import.ts e backfill chamam | B | médio |
| **3** | Backfill idempotente (seeds OR IGNORE, dedup do DB, remover `rmSync`) | **A** (perda de dados) | pequeno-médio |
| **4** | UI: Origin/contraste `--fg-3` + staging durável + empty states | UI P1/P2 | médio |
| **5** | Ativar `rules` (editar = criar regra) + SEC-2 (xlsx CDN) + `## Não-objetivos` no PRODUCT.md | D + escopo | médio |
| **6** | Quebrar `primitives.js`; `store.js` frontend | org/escala | médio |

**Padrão-alvo:** *ledger append-only idempotente com separação fatos-vs-overlay* — parente enxuto de event-sourcing/local-first, sem CRDT (single-user local não precisa). Reaproveita 100% da estrutura em camadas atual.

**Começar por:** Fase 0 (testes) + Fases 1+3 (fecham os dois P0). O resto é incremento seguro sobre a rede de testes.
