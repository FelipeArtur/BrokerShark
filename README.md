# BrokerShark

Ferramenta **pessoal** de análise de dinheiro. 100% local, Linux, um usuário, contas
Nubank + Inter. Responde primeiro **"quanto eu posso gastar agora?"** — e só depois
deixa cavar pra onde o dinheiro foi.

Sem API de banco, sem nuvem, sem telemetria: a entrada são os arquivos que os bancos
já exportam.

> **North star:** fácil de alimentar + extremamente confiável.
> Dinheiro em **centavos inteiros** — sem float no ledger.

## Rodando

Requer **Node ≥ 26** (type-stripping nativo — o projeto não tem build step).

```bash
cd backend
npm install                                    # instala xlsx (única dependência)
node src/jobs/backfill.ts "<dir do acervo>"    # → backend/data/brokershark-v2.db
npm start                                      # http://127.0.0.1:8000
npm test                                       # node:test (backend + frontend)
```

O servidor sobe em `127.0.0.1:8000` (`PORT` no env ou `--port N` pra mudar).

## Rodar como app desktop

Wrapper opcional (`desktop/brokershark.py`, WebKitGTK) que sobe o server numa porta
efêmera, abre numa janela nativa e mata o `node` ao fechar — nada sobra rodando.

Deps runtime: `python-gobject`, `gtk3`, `webkit2gtk-4.1`, `node ≥ 26`.

```bash
python desktop/brokershark.py            # abre a janela
python desktop/brokershark.py --check    # smoke headless: sobe, confirma 200, encerra

# Entrada de menu (ajuste os caminhos absolutos no .desktop pro seu clone):
cp desktop/brokershark.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

**Backup mensal automático** (`desktop/systemd/`): snapshot datado (`VACUUM INTO`,
retém 12) via systemd user timer. Confirme o caminho do `node` no `.service`
(`which node`), então:

```bash
mkdir -p ~/.config/systemd/user
cp desktop/systemd/brokershark-backup.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start brokershark-backup.service   # dispara já, uma vez
systemctl --user enable --now brokershark-backup.timer
```

Backups em `~/brokershark-backups/` (0600). `BROKERSHARK_BACKUP_DIR` muda o destino
lido pelo endpoint `backup-status`.

## O que faz

- **Dashboard web** — tela única, sem abas: faixa KPI fixa (Disponível pra gastar ·
  Patrimônio · Saldo livre do mês · Investido) + grid de widgets (visão geral do mês,
  fluxo mês a mês clicável = seletor de mês global, contas, categorias, investimentos,
  fatura do cartão, compromissos futuros). Detalhe abre em **overlay de drill-down**,
  nunca navegação.
- **Orçamento por categoria** — alvo fixo por categoria, com override opcional por mês.
- **Backfill** — reconstrói o banco do zero a partir do acervo de exports.
- **Import incremental via UI** — extratos Nubank/Inter (CSV) e relatório B3 (xlsx),
  com preview, dedup, staging editável, confirmação e reverter-lote. Fatura Inter
  (cartão) só via backfill.

## Acervo

O backfill descobre os arquivos **recursivamente e pelo nome**, então a árvore de pastas
é livre. Os padrões reconhecidos:

| Fonte | Padrão do arquivo | Formato |
|---|---|---|
| Extrato Nubank | `NU_<conta>_<DDMMMYYYY>_<DDMMMYYYY>.csv` | CSV (`Data,Valor,Identificador,Descrição`) |
| Extrato Inter | `Extrato-DD-MM-YYYY-a-*.csv` | CSV (ponto-e-vírgula, preâmbulo de 5 linhas, saldo corrente conferido) |
| Fatura Inter | `fatura-inter-YYYY-MM.csv` | CSV (categoria do banco + parcelas) |
| Relatório B3 | `relatorio-consolidado-{anual-YYYY,mensal-YYYY-<mês>}.xlsx` | xlsx (Tesouro, Renda Fixa, Ações, BDR) |

Arquivo que não casa com nenhum padrão é ignorado em silêncio — fatura do Nubank, por
exemplo, não é suportada.

## Invariantes financeiras

O que não pode quebrar (detalhe e raciocínio em `CLAUDE.md` e nos comentários do código):

- **Fatura itemizada** — os itens da fatura são os gastos reais; o pagamento no extrato
  é uma **liquidação** (`is_settlement=1`), fora dos totais de consumo. Sem isso o
  consumo contaria em dobro.
- **Regra consumo-despesa** — `flow='expense' AND method != 'transfer' AND
  is_settlement=0 AND is_third_party=0 AND dest_account_id IS NULL`. Transferência
  nunca é despesa de consumo.
- **Self-transfer por pareamento de pernas** — saída + entrada de mesmo valor, contas
  diferentes, ±3 dias → `counterpart='SELF'`. Sem allow-list de keyword. SELF é
  **derivado**, nunca declarado pelo cliente.
- **Investimento = posições + snapshots datados** — rendimento é computado, nunca
  chutado. Posição some do relatório → soft-close (`closed_at`), nunca DELETE.
- **Caixinha Nubank é derivada do ledger** (RDB fora da B3); **Porquinho Inter não é** —
  é CDB custodiado na B3, e derivá-lo contaria em dobro.

O backfill valida as invariantes ao final e **aborta** se alguma quebrar.

## Segurança

App local sem auth — a máquina é o perímetro:

- Banco em `0600` (backfill e servidor aplicam; WAL/SHM inclusos). Sem auth, permissão
  de arquivo é a fronteira at-rest.
- Bind em `127.0.0.1` + allowlist de **Host** (anti DNS-rebinding) + allowlist de
  **Origin** em todo método != GET/HEAD (anti-CSRF).
- CSP self-only, `nosniff`, frame-deny. O frontend é 100% vendorizado — nada externo é
  legítimo.
- Writes 100% validados no servidor (data, FKs, whitelist de method/flow/operation).
- Body cap 1MB (upload multipart 20MB / 64 partes).

O `.gitignore` mantém `data/` e `backups/` fora do VCS: **o ledger nunca é
versionado.** `docs/` é versionado normalmente.

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (Node ≥ 26, type-stripping nativo — sem build step) |
| Banco | SQLite via `node:sqlite` (builtin, WAL, `foreign_keys=ON`, modo 0600) |
| Parsing | parsers CSV próprios; `xlsx` pros relatórios B3 (única dependência npm) |
| Frontend | React 18 + Chart.js, vendorizados, sem CDN e sem build step (hyperscript puro, nunca JSX) |
| Servidor | `node:http` + micro-router próprio + SSE (`/api/events`) — zero dependências |

## Documentação

- `CLAUDE.md` — fonte única da verdade: schema, contas, invariantes, arquitetura.
  **Fica na raiz de propósito**: é auto-carregado em toda sessão de agente; em
  `docs/` ele deixaria de entrar em contexto e viraria letra morta.
- `docs/DESIGN.md` — sistema visual (tokens, tipografia, layout, motion).
- `docs/PRODUCT.md` — usuário, propósito, escopo.
- `docs/superpowers/` — specs, planos e auditorias datadas.
- Histórico completo (roadmap, decisões datadas, revisões de segurança) vive no
  `git log`, não em arquivo.
