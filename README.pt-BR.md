# BrokerShark

*[Read this in English](README.md)*

Ferramenta **pessoal** de análise de dinheiro. 100% local, Linux, um usuário, contas
declaradas em `config/`. Responde primeiro **"quanto eu posso gastar agora?"** — e só depois
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
npm run audit                                  # confere as invariantes no DB VIVO (read-only)
```

`npm run audit` é read-only e sai com código 1 se alguma invariante quebrou — é o
jeito de conferir o ledger do dia a dia sem reconstruir nada.

O servidor sobe em `127.0.0.1:8000` (`PORT` no env ou `--port N` pra mudar).

**É um dashboard web, e só isso.** Não há app desktop nem empacotamento: abra
`http://127.0.0.1:8000` no navegador. Houve um wrapper WebKitGTK
(`desktop/brokershark.py`); foi removido em 2026-07-26 — está no `git log` se um
dia fizer falta.

## Backup do ledger

Snapshot mensal datado (`VACUUM INTO`, retém 12) por systemd user timer. Confirme
o caminho do `node` no `.service` (`which node`), então:

```bash
mkdir -p ~/.config/systemd/user
cp backend/systemd/brokershark-backup.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start brokershark-backup.service   # dispara já, uma vez
systemctl --user enable --now brokershark-backup.timer
```

Backups em `~/brokershark-backups/` (0600). `BROKERSHARK_BACKUP_DIR` muda o destino
lido pelo endpoint `backup-status`. Rodar avulso, sem timer:

```bash
node backend/src/jobs/backup.ts
```

## O que faz

- **Dashboard web** — tela única, sem abas: faixa KPI fixa (Disponível pra gastar ·
  Patrimônio · Saldo livre do mês · Investido) + grid de widgets (visão geral do mês,
  fluxo mês a mês clicável = seletor de mês global, contas, categorias, investimentos,
  fatura do cartão, visão de futuro). Detalhe abre em **overlay de drill-down**,
  nunca navegação.
- **Orçamento por categoria** — alvo fixo por categoria, com override opcional por mês.
- **Ledger novo nasce sem categoria nenhuma** — taxonomia de gasto é decisão de quem usa,
  não estrutura do domínio. Lançamento importado nasce sem categoria (estado que a tela
  mostra e resolve em lote), e cada categorização vira regra que passa a se sugerir.
- **Contas entram e saem sem perder histórico** — conta nova pela UI, conta encerrada
  vira *soft-close*: sai do disponível, do patrimônio e das opções de import, mas cada
  lançamento dela continua no ledger e os meses passados seguem contando o que ela
  movimentou. Apagar uma conta com histórico é recusado — encerre. E, como no banco,
  **só encerra quem está quite**: cartão com fatura em aberto ou conta no vermelho é
  recusado.
- **Categorização que aprende** — categorizar um lançamento vira regra; a aba *Regras*
  deixa corrigir, desligar sem apagar, ou apagar. Apagar a regra não descategoriza o
  que já passou.
- **Backfill** — reconstrói o banco do zero a partir do acervo de exports.
- **Bancos são configuração, não código** — contas, formato de arquivo de cada uma,
  padrão de nome no acervo e keywords vivem em `config/default.json` (genérico) ou
  `config/local.json` (o seu, fora do git). Parser tem nome de formato, não de banco.
- **Import incremental via UI** — extratos (CSV, nos dois formatos), fatura (CSV) e
  relatório de corretora (xlsx), com preview, dedup, staging editável, confirmação e
  reverter-lote. Tudo entra por aqui: o backfill serve pra reconstruir do acervo,
  não pra alimentar o dia a dia.

## Acervo

O backfill descobre os arquivos **recursivamente e pelo nome**, então a árvore de pastas
é livre. Os padrões reconhecidos:

| Fonte | Padrão do arquivo | Formato |
|---|---|---|
| Extrato com identificador | `filePattern` da conta na config | CSV (`Data,Valor,Identificador,Descrição`) |
| Extrato com saldo corrente | `filePattern` da conta na config | CSV (ponto-e-vírgula, preâmbulo, saldo conferido) |
| Fatura de cartão | `filePattern` do cartão na config | CSV (categoria do banco + parcelas) |
| Relatório de corretora | `brokerReportPattern` na config | xlsx (Tesouro, Renda Fixa, Ações, BDR) |

Os padrões vêm da config: cada conta declara o `filePattern` do export dela. Arquivo que
não casa com nenhum é ignorado em silêncio.

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
- **Perna de investimento ≠ perna SELF** — as duas se parecem no banco de dados (o
  pareamento SELF reescreve a perna de saída pra `method='transfer'`, que é a marca
  da aplicação), então toda soma de investimento exclui `self_pair_tx_id`. Sem isso,
  mandar dinheiro de uma conta pra outra vira "aplicou".
- **Investimento = posições + snapshots datados** — rendimento é computado, nunca
  chutado. Posição some do relatório → soft-close (`closed_at`), nunca DELETE.
- **Poupança derivada é calculada do ledger** (reserva sem custódia em corretora);
  **posição custodiada não é** — ela entra pelo relatório, e derivá-la contaria em dobro.
  É pra isso que serve `derivedSavings.excludeKeywords`.
- **`closed_at` de conta afeta posição, nunca histórico** — o disponível soma só contas
  abertas (e conta encerrada vale zero, não o último saldo conhecido); todo total mensal
  ignora o encerramento, porque o dinheiro se moveu de verdade na época. Encerrar com
  dívida em aberto é recusado, senão o valor a pagar sumiria do disponível sem ter sido
  pago.

O backfill valida as invariantes ao final e **aborta** se alguma quebrar. No DB do dia
a dia, `npm run audit` faz a mesma conferência sem reconstruir.

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
versionado.**

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (Node ≥ 26, type-stripping nativo — sem build step) |
| Banco | SQLite via `node:sqlite` (builtin, WAL, `foreign_keys=ON`, modo 0600) |
| Parsing | parsers CSV próprios, por formato; `xlsx` pros relatórios de corretora (única dependência npm) |
| Frontend | React 18 + Chart.js, vendorizados, sem CDN e sem build step (hyperscript puro, nunca JSX) |
| Servidor | `node:http` + micro-router próprio + SSE (`/api/events`) — zero dependências |

## Documentação

O repositório guarda só o que serve pra rodar e entender o código:

- **`README.md`** (em inglês) — porta de entrada do repositório público.
- **este `README.pt-BR.md`** — a mesma coisa em português, com mais detalhe operacional.
- **`CLAUDE.md`** — fonte única da verdade pra agentes de IA: schema, contas,
  invariantes, arquitetura. **Fica na raiz de propósito**: é auto-carregado em toda
  sessão de agente; numa subpasta deixaria de entrar em contexto e viraria letra morta.
- **`git log`** — roadmap, decisões datadas, revisões de segurança.

O resto da documentação (produto, sistema visual, specs, planos e auditorias datadas)
mora num vault Obsidian, fora do repo:

```
~/Documents/Rede de projetos/Pessoal/BrokerShark/
├── BrokerShark.md      # índice do projeto (comece por aqui)
├── CLAUDE.md           # symlink pro arquivo da raiz deste repo
├── Produto.md          # usuário, propósito, escopo
├── Design System.md    # tokens, tipografia, layout, motion
├── Specs/              # design docs datados
├── Planos/             # planos de execução datados
└── Arquivo/            # documentos superados, mantidos como registro
```
