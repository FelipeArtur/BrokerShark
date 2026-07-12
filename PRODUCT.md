# Product

## Register

product

## Users

Um único usuário (Felipe), no Linux desktop/notebook (≥1280px; mobile não é alvo), 100% local e offline. Contexto de uso: sessões curtas e frequentes para responder "quanto posso gastar agora?" e sessões mensais de manutenção (importar extratos, categorizar, conferir investimentos).

## Product Purpose

BrokerShark é um painel pessoal de análise financeira. Pergunta central: **"quanto eu posso gastar agora?"** — depois, para onde o dinheiro vai (histórico/categorias) e onde ele está guardado (investimentos). Sucesso = confiança absoluta nos números (centavos inteiros, reconciliação) + leitura instantânea da situação financeira em uma única tela.

**Formato do produto (decisão 2026-07): dashboard único**, sem abas. Faixa de KPIs fixa no topo (Disponível pra gastar · Balanço do mês · Total investido) + área de widgets com scroll (timeline, categorias, contas, investimentos, atividade). Seletor de mês global na topbar rege os widgets de fluxo; posição (saldo disponível) é sempre "agora". Tabela completa de transações (filtros, busca, edição em lote) vive em drill-down (não ocupa o dashboard); widget compacto de atividade recente no lugar. Investimentos: resumo + donut no widget, posições em drill-down.

## Brand Personality

Preciso, denso, adulto. "Painel de operação" — informação densa por bloco, tipografia compacta, números tabulares em destaque, hierarquia clara apesar da densidade. Ferramenta de dono, não app de consumidor: mostra o número, não o esconde. Identidade visual existente é mantida e evoluída: dark-first, neutros frios (hue 250), accent cyan "água de tubarão" (hue 200), Inter + JetBrains Mono.

## Anti-references

- **App de banco (Nubank-like):** cartõezinhos arredondados, roxo, tom infantilizado, números escondidos atrás de "ver saldo".
- **SaaS analytics genérico:** grid de cards idênticos KPI+sparkline+Δ%, gradientes, look Stripe/Vercel, hero-metric template.
- **Bloomberg/terminal hardcore:** denso ao ponto de hostil, tudo monospace, zero hierarquia, sopa de siglas.

Denso ≠ hostil: a densidade serve à leitura de relance, nunca contra ela.

## Design Principles

1. **O número certo em ≤2 segundos.** "Disponível pra gastar" é o herói permanente; tudo o mais se organiza ao redor.
2. **Densidade com hierarquia.** Muitos dados por bloco, mas cada bloco tem UM ponto de entrada visual óbvio. Tipografia e cor fazem a triagem, não o espaço em branco.
3. **Confiança visível.** Números reconciliados, sinais (+/−), cores semânticas consistentes (pos/neg/info/reserve) e proveniência (chips de banco, tags de fonte). Nunca arredondar para "ficar bonito".
4. **Drill-down, não navegação.** Uma tela; detalhe abre em camada (drawer/modal) e volta. Nenhum estado se perde ao aprofundar.
5. **Offline e instantâneo.** Sem CDN, sem build, sem spinner gratuito — dados locais devem parecer locais.

## Accessibility & Inclusion

WCAG AA como piso (contraste ≥4.5:1 em texto corrente — atenção redobrada por ser tema escuro denso), `prefers-reduced-motion` respeitado (já implementado), foco visível, navegação por teclado (atalhos existentes: `/` busca; drill-downs fecham com Esc). Um usuário sem necessidades específicas declaradas, mas o piso AA não é negociável.
