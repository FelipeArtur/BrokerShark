# Categorias unificadas — design (2026-07-24)

## Objetivo

Consolidar TODA a gestão de categorias num único lugar (o card Categorias do dashboard), reduzir o seed a 6 macro fundamentadas no gasto real do usuário, mostrar limites como barra de vida (health-bar) no card, e ligar um reconhecimento nome→categoria que aprende quando o usuário categoriza e sugere depois (nunca aplica sozinho).

Decidido via brainstorming 2026-07-24. As 6 macro vieram de análise do DB real via antigravity (`agy`), com a #6 (Igreja/Dízimo) separada a pedido do usuário.

## Decisões travadas

- **Um só lugar de gestão:** o card Categorias. Bulk-categorize só nele. Botão "Categorias" sai da topbar.
- **Reconhecimento:** aprende-e-sugere, o usuário confirma. Não-invasivo.
- **Health-bar:** só pra categoria COM alvo. Verde<80 / âmbar 80-100 / vermelho>100 estourado. Sem alvo = "definir alvo" discreto.
- **6 macro de despesa** (receitas ficam iguais): Alimentação · Transporte · Saúde e Bem-Estar · Compras e Lazer · Compromissos e Transferências · Igreja/Dízimo.

## Componentes

### C. Modelo de dados — 6 macro + migração

**Seed** (`backend/src/jobs/backfill/seeds.ts`): `EXPENSE_CATS` passa a ser exatamente as 6 macro. `INCOME_CATS` inalterado (Salário, Freela, PIX recebido, Transferência, Outro). Afeta só rebuild do zero.

**Migration** `db/migrations/NNNN_macro_categories.sql` (forward-only, sem BEGIN/COMMIT — o runner envelopa):
1. `INSERT OR IGNORE` das 6 macro por (name, flow='expense'). Idempotente; no-op num DB que já as tem (fresh backfill).
2. Reatribui `transactions.category_id` das categorias de despesa antigas → macro mapeada:
   - Alimentação → Alimentação (mantém)
   - Carro → Transporte
   - Atividade física → Saúde e Bem-Estar
   - Jogos, Lazer, Eletrônicos → Compras e Lazer
   - Educação → Compras e Lazer
   - Igreja, Dízimo → Igreja/Dízimo
   - Eventos / Terceiros, Outro → Compromissos e Transferências
3. Deleta as categorias de despesa que sobraram fora das 6 (o CASCADE de `category_budgets` limpa alvos órfãos).
4. Feito por NOME (subselect), então num DB fresh (só as 6 macro existem) os passos 2-3 são no-op.

Mapa acima é a política; a migration referencia nomes literais. Categorias criadas pelo usuário que não estejam no mapa e não sejam macro caem em "Compromissos e Transferências" via um passo catch-all final (qualquer categoria expense não-macro restante → Compromissos).

**Disciplina de baseline:** `schema.sql` não muda (categories já existe lá); a migration leva daí. Efêmero no `--force` (rebuild recria do seed) — documentar no CLAUDE.md junto de due_date/fatura-aberta.

### A. Card Categorias vira hub (`frontend/js/screens/dashboard.js` CategoriesWidget)

- Cabeçalho do card ganha dois controles à direita do total:
  - `+ Nova` — cria categoria inline (input aparece na primeira linha da lista, submit grava via `postCategory`, flow=expense). Reusa o handler do overlay.
  - `⚙ Gerenciar` — abre o `Overlay`/`CategoriesPanel` que já existe (CRUD completo: renomear, excluir com reatribuição, alvo).
- "Categorizar em lote · N" permanece no rodapé do card (já está lá).
- `frontend/js/screens/app.js`: remove o botão "Categorias" da topbar e o estado que só ele usava permanece (o card abre o mesmo overlay via prop/callback). O overlay continua montado no shell, disparado por callback do card em vez do topbar.
- `frontend/js/screens/history.js`: remove o botão `lote · N` da toolbar da tabela (linha ~219) e o disparo associado. O bulk agora só nasce do card. `openBulk`/`onBulkConsumed` continuam sendo a ponte card→tabela (o modal de bulk vive no fluxo da tabela; só o gatilho sai).

### B. Health-bar (`CategoryRow` em dashboard.js + `budgetState` em `tx-group.js`)

- Só renderiza barra quando `budget != null` (categoria com alvo). `budgetState(spent, budget)` já devolve `{ratio, color}`.
- Barra: altura ~8px (era 3px), fundo `--bg-2`, preenchimento `st.color` largura `min(100, ratio*100)%`.
  - **Cores (DECIDIDO — opção a):** <80% = `--accent` (ciano, "sob controle"), 80-100% = `--warn` (âmbar), >100% = `--neg` (vermelho). Preserva a invariante "verde = receita e só receita" intacta — a health-bar nunca usa verde. Verde continua exclusivo de receita.
  - Atualizar cores de `budgetState` (`tx-group.js`) pra esse tri-estado e registrar no DESIGN.md que a barra de orçamento usa accent/âmbar/neg (não verde).
  - >100%: a barra fica cheia em `--neg` + um segundo traço de "excedente" (dithered `--neg`) OU um leve pulse `bs-pop` uma vez ao cruzar — efeito "estourado" de barra de vida. Sem animação contínua (respeita reduced-motion).
- Rótulo ao lado: `NN% de R$X` na cor do estado (já existe, ajustar).
- Sem alvo: `definir alvo` discreto (`--fg-3`, dashed) — já existe.

### D. Reconhecimento nome→categoria (aprende-e-sugere)

Infra existente (não recriar): tabela `rules` (matcher, action, value, priority, enabled); `routes/transactions.ts` e `routes/import.ts` já leem `rules WHERE action='category'` e anexam `suggested_category_id/name`. Hoje nenhuma regra `category` é gravada — este componente preenche isso.

**Gravar (aprender):** quando o usuário define categoria de um lançamento:
- Inline na tabela (`PATCH /api/transactions/:id` com category_id) e no bulk (`routes` do bulk por comerciante) → após gravar, faz upsert de uma `rule`:
  - `matcher` = chave normalizada do comerciante (mesma normalização do reconhecimento: lowercase, tira prefixos "Pix enviado: Cp :NNN-", "Transferência enviada pelo Pix - ", cidade/UF no fim; trunca).
  - `action='category'`, `value` = category_id (string), `priority` default (ex. 50), `enabled=1`.
  - Upsert: se já existe rule `action='category'` com esse matcher, atualiza o value; senão insere. (matcher não é UNIQUE hoje → `SELECT` + `UPDATE`/`INSERT`, ou adicionar índice único parcial via migration.)
- Um helper puro de normalização em `domain/` (espelha o que o suggest usa) pra backend E o suggest baterem.

**Sugerir (usar):** já implementado — `suggested_category_id/name` no payload. Front mostra chip "sugerido" na coluna categoria quando `category_id` está vazio e há sugestão; clicar aceita (grava, o que por sua vez reforça a regra). No import, idem (já tem `suggestedCategoryId`).

**Não-invasivo:** nunca auto-aplica. Só pré-preenche/sugere. O usuário sempre confirma.

**Normalização (load-bearing):** o matcher gravado e o matcher lido têm que usar a MESMA função, senão a sugestão nunca casa. Extrair `normalizeMerchant(desc)` puro e testá-lo. O suggest atual usa `hay.includes(matcher)` — manter esse contrato (matcher é substring da descrição normalizada).

### E. Criar/excluir revisado

- Criar: inline no card (`+ Nova`) + no overlay. Ambos via `postCategory(name, 'expense')`. Nome duplicado → erro do backend exibido.
- Excluir (no overlay): mantém — exige categoria de reatribuição quando `transaction_count > 0`, confirma, reatribui + deleta. Sem undo (documentado); é ação do overlay de gestão, não do fluxo rápido.
- Auditar: garantir que excluir uma categoria também remove/reaponta as `rules` `action='category'` cujo value era aquela categoria (senão viram sugestões órfãs). Adicionar: no delete, `DELETE FROM rules WHERE action='category' AND value = :oldId` (ou reaponta pro destino). Decisão: **deletar** as regras órfãs (o usuário reaprende ao recategorizar).

## Invariantes preservadas

- Regra consumo-despesa intacta (categorias não mudam a classificação de espécie).
- Verde = só receita: a health-bar usa accent/âmbar/vermelho, nunca verde pra "ok".
- Ledger = só fato; regras e sugestões são metadados, nunca viram lançamento.
- Reconhecimento nunca auto-aplica (sem escrita silenciosa de category_id).

## Testes

- `normalizeMerchant` — unit puro (prefixos PIX, cidade/UF, truncagem, idempotência).
- Migration — e2e: DB com categorias antigas + transações categorizadas → após migrate, só as 6 macro, transações reatribuídas pelo mapa, nenhuma órfã.
- Aprender-e-sugerir — e2e: categoriza comerciante X → rule gravada → nova transação de X vem com suggested_category_id correto; excluir a categoria remove a rule.
- `budgetState` cores — unit: <80 accent, 80-100 warn, >100 neg.
- Regressão: bulk continua funcionando disparado do card; topbar sem botão Categorias não quebra o shell.

## Ordem de build

C (dados: seed + migration) → A (consolidação UI + remover topbar/tabela) → B (health-bar) → D (reconhecimento: normalize + upsert + chip) → E (revisão criar/excluir + limpeza de rules órfãs).

## Fora de escopo

- Editar regras de reconhecimento à mão (painel de rules) — futuro.
- Auto-aplicar sugestões — decidido contra.
- Orçamento por subcategoria / hierarquia — as 6 são planas.
