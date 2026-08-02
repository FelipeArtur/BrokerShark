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
npm install     # instala xlsx (única dependência)
npm start       # http://127.0.0.1:8000 — sobe sobre data/brokershark-v2.db
```

São esses dois comandos. **O painel é o ponto de entrada:** extrato, fatura e
relatório da corretora entram pela UI, com preview e dedup antes de gravar.

Pra experimentar sem acervo nenhum, existe um ledger sintético de 24 meses:

```bash
npm run demo                # gera data/demo.db (determinístico, se audita)
npm start -- data/demo.db   # sobe o painel sobre ele
```

O gerador da demo não é dump de fixture: passa os lançamentos pelos MESMOS módulos
que o import usa (pareamento SELF, poupança derivada, fatura itemizada,
reconciliação de pagamento) e roda a auditoria de invariantes contra o que
produziu, falhando se algo quebrou. Por isso ele também é passo de CI.

Reconstruir do zero a partir de um diretório de exports é opcional — serve pra
recuperar o histórico inteiro, não pra alimentar o dia a dia:

```bash
node src/jobs/backfill.ts "<dir do acervo>"    # → data/brokershark-v2.db
```

Manutenção:

```bash
npm test        # node:test (backend + frontend)
npm run audit   # confere as invariantes no DB VIVO (read-only)
```

`npm run audit` sai com código 1 se alguma invariante quebrou — é o jeito de
conferir o ledger do dia a dia sem reconstruir nada.

O servidor sobe em `127.0.0.1:8000` (`PORT` no env ou `--port N` pra mudar).

`BROKERSHARK_IDLE_EXIT=<segundos>` faz o processo sair sozinho depois desse tempo
sem nenhum painel aberto — o servidor sabe disso pelo SSE, já que cada aba do
painel segura uma conexão em `/api/events`. Serve pra rodar como serviço que
sobe sob demanda e não fica ocupando memória depois. É opt-in: sem a variável o
servidor fica de pé, que é o que se quer ao depurar.

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

Cada disparo grava um **par datado**: o snapshot do ledger (`.db`) e a config que
o descreve (`.config.json`). O ledger sozinho não reconstrói a instalação, ele
guarda os lançamentos; quais contas existem e qual banco é qual está na config,
que não é versionada. A retenção conta **datas**, não arquivos, e a poda leva o
par inteiro.

O destino é `backupDir` na config; sem declarar, cai em `~/brokershark-backups/`.
Arquivos ficam 0600. **Declare numa fonte só**: o job que escreve e o endpoint
`backup-status` que o painel lê seguem a mesma ordem (argumento/env → config →
padrão), e apontar um pro disco novo esquecendo o outro faz o painel anunciar
"sem backup" com backups existindo.

```json
"backupDir": "/mnt/backup/brokershark"
```

Rodar avulso, sem timer:

```bash
node backend/src/jobs/backup.ts
```

## O que faz

- **Dashboard web** — tela única, sem abas: faixa KPI fixa (Disponível pra gastar ·
  Patrimônio · Saldo livre do mês · Investido) + grid de widgets (visão geral do mês,
  fluxo mês a mês clicável = seletor de mês global, contas com os cartões e faturas
  aninhados, categorias, investimentos, o que já está comprometido). Detalhe abre em
  **overlay de drill-down**, nunca navegação.
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
  A única exceção é a migration `0004`, que renomeia uma chave antiga: ela precisa
  casar o literal que já está gravado nos bancos existentes, senão o rename vira uma
  segunda posição de poupança e dobra o patrimônio. Migration é história, e história
  não pode ser genérica.
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

O que não pode quebrar (cada uma vale como teste e como consulta de auditoria):

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
| Frontend | React 18 vendorizado, sem CDN e sem build step (hyperscript puro, nunca JSX) |
| Servidor | `node:http` + roteador sobre `URLPattern` + SSE (`/api/events`) — zero dependências |

## Documentação

O repositório guarda só o que serve pra rodar e entender o código:

- **`README.md`** (em inglês) — porta de entrada do repositório público.
- **este `README.pt-BR.md`** — a mesma coisa em português, com mais detalhe operacional.
- **o código** — a regra que decide o que é dinheiro mora em `domain/` e em
  `db/ledgerSql.ts`, comentada onde o *porquê* não é óbvio pelo *o quê*.
- **`git log`** — decisões datadas, em Conventional Commits: cada mensagem diz o que
  mudou e por que valia mudar.

Documento de produto, sistema visual e plano de execução vivem fora deste repositório,
num vault pessoal — enquanto um trabalho corre, e apagados quando o código os alcança.
Aqui não há doc de etapa futura de propósito: **o que está escrito é o que está feito.**
