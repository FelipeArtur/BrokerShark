# Product

## Register

product

## Users

Um único usuário (o dono), no Linux desktop/notebook (≥1280px; mobile não é alvo), 100% local e offline. Contexto de uso: sessões curtas e frequentes para responder "quanto posso gastar agora?" e sessões mensais de manutenção (importar extratos, categorizar, conferir investimentos).

## Product Purpose

BrokerShark é um painel pessoal de análise financeira. Pergunta central: **"quanto eu posso gastar agora?"** — depois, para onde o dinheiro vai (histórico/categorias) e onde ele está guardado (investimentos). Sucesso = confiança absoluta nos números (centavos inteiros, reconciliação) + leitura instantânea da situação financeira em uma única tela.

**Formato do produto (decisão 2026-07): dashboard único**, sem abas. Faixa de KPIs fixa no topo (Disponível pra gastar · Patrimônio total · Saldo livre do mês · Total investido) + área de widgets (fluxo mês a mês, categorias, contas, investimentos, top PIX) + tabela full-width com scroll interno — a página nunca rola. Seletor de mês global rege os widgets de fluxo; posição (saldo disponível) é sempre "agora". Detalhe abre em drill-down overlay. Investimentos: resumo no widget, posições em drill-down.

**Orçamento (decisão 2026-07):** alvo de gasto **por categoria**, fixo, com override opcional por mês. Substitui o teto global único que vivia no localStorage. Categoria sem alvo não é alvo zero — é "sem alvo", e a UI mostra os dois diferente.

## Brand Personality

Preciso, denso, adulto. "Painel de operação" — informação densa por bloco, tipografia compacta, números tabulares em destaque, hierarquia clara apesar da densidade. Ferramenta de dono, não app de consumidor: mostra o número, não o esconde.

Identidade visual (remodel 2026-07): **pixel-art / 8-bit, paleta Balatro-CRT**, tema único dark. Accent cyan "água de tubarão" (`#5cc6ff`) mantido como identidade. Silkscreen (labels) + Departure Mono (números), vendorizadas. Cantos duros em todo lugar. Tokens em `docs/DESIGN.md`.

## Anti-references

- **App de banco (Nubank-like):** cartõezinhos arredondados, roxo, tom infantilizado, números escondidos atrás de "ver saldo".
- **SaaS analytics genérico:** grid de cards idênticos KPI+sparkline+Δ%, gradientes, look Stripe/Vercel, hero-metric template.
- **Bloomberg/terminal hardcore:** denso ao ponto de hostil, tudo monospace, zero hierarquia, sopa de siglas.

Denso ≠ hostil: a densidade serve à leitura de relance, nunca contra ela.

## Design Principles

1. **O número certo em ≤2 segundos.** "Disponível pra gastar" é o herói permanente; tudo o mais se organiza ao redor.
2. **Densidade com hierarquia.** Muitos dados por bloco, mas cada bloco tem UM ponto de entrada visual óbvio. Tipografia e cor fazem a triagem, não o espaço em branco.
3. **Confiança visível.** Números reconciliados, sinais (+/−) sempre explícitos, cor semântica por **espécie de dinheiro** (receita · despesa de consumo · investimento · transferência · liquidação · terceiros — ver `money.js`) e proveniência (chips de banco, tags de fonte). Nunca arredondar para "ficar bonito". Corolário: **nunca mostrar um número que pode estar errado** — se as condições pra ele ser verdade não estão dadas (ex.: saldo corrente fora de ordem cronológica), o número não aparece.
4. **Drill-down, não navegação.** Uma tela; detalhe abre em camada (overlay/modal) e volta. Nenhum estado se perde ao aprofundar.
5. **Offline e instantâneo.** Sem CDN, sem build, sem spinner gratuito — dados locais devem parecer locais.

## Accessibility & Inclusion

WCAG AA como piso (contraste ≥4.5:1 em texto corrente — atenção redobrada por ser tema escuro denso e fonte bitmap), `prefers-reduced-motion` respeitado (já implementado), foco visível. Um usuário sem necessidades específicas declaradas, mas o piso AA não é negociável.

**Teclado (decisão 2026-07):** a interação é por mouse — **não há hotkey global**. O que fica é o piso, e não é negociável: `Esc` fecha modal/overlay, `Tab` fica preso dentro do modal (sem focus trap o modal deixa de ser modal pra quem usa teclado), `Enter` submete form. Isso não é "navegação por teclado": é conter e confirmar.
