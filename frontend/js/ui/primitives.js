/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/**
 * @file primitives.js
 * @brief Formatadores, hooks e componentes compartilhados (Money, TxRow, Modal,
 *        Drawer, gráficos Chart.js, toasts, FilterBar) + os predicados de
 *        espécie derivados de money.js.
 *
 * UNIDADE: todo valor aqui é REAIS (float) — é o que a API entrega em `amount`.
 */
/* primitives.js — formatters, hooks, and shared SVG chart components */
/* global React */

const { useState: _useState, useEffect: _useEffect, useCallback: _useCallback, useRef: _useRef } = React;

/* ── Formatters ─────────────────────────────────────────────────────────── */
/**
 * @brief Formata um valor como string "R$ …" em pt-BR.
 * @param v valor em REAIS; null/undefined vira 0
 * @param opts.sign "auto" (padrão) e "neg-only" só marcam o negativo;
 *        "always" força "+" no não-negativo
 * @param opts.decimals casas decimais (padrão 2)
 * @return string pronta pra title/aria-label (usa "−", menos tipográfico)
 */
function fmtBRL(v, opts = {}) {
  const { sign = "auto", decimals = 2 } = opts;
  const n = v ?? 0;
  const s = "R$ " + Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (sign === "always") return (n >= 0 ? "+" : "−") + s;
  if (sign === "neg-only") return n < 0 ? "−" + s : s;
  return n < 0 ? "−" + s : s;
}
/* ── Money ────────────────────────────────────────────────────────────────
   Um valor monetário. O SINAL carrega a cor da espécie; o número fica neutro
   — com 6 espécies, pintar o número inteiro vira arco-íris numa tabela de 300
   linhas. Os centavos entram atenuados e menores: o olho pega a ordem de
   grandeza primeiro, que é o que se lê numa varredura.

   `emphasis: true` pinta o número todo — pra poucos e grandes (KPI herói,
   cabeçalho de grupo), onde a cor informa em vez de poluir.                  */
/**
 * @brief Renderiza um valor monetário com o sinal na cor da espécie.
 * @param props.t transação de origem — dá a espécie e o sinal quando `kind`/
 *        `value` não vêm; `t.amount` em REAIS
 * @param props.value valor em REAIS a exibir; ausente usa `t.amount`
 * @param props.kind espécie (window.BS.KIND); ausente é derivada de `t`
 * @param props.size corpo da fonte em px; ausente herda do contexto
 * @param props.emphasis true pinta o número inteiro na cor da espécie
 * @param props.strike true risca o valor
 * @param props.title tooltip; ausente usa o KIND_HINT da espécie
 * @return elemento React <span> com sinal, inteiro e centavos atenuados
 */
function Money({ t, value, kind, size, emphasis = false, strike = false, title }) {
  const h = React.createElement;
  const k = kind || (t ? window.BS.moneyKind(t) : null);
  const v = value != null ? value : (t ? t.amount : 0);
  // Zero não tem direção — um "−R$ 0,00" (transferência que se cancela) é ruído.
  const sign = v === 0 ? "" : (t ? window.BS.kindSign(t) : (v < 0 ? "−" : "+"));
  const color = k ? window.BS.KIND_COLOR[k] : "var(--fg-1)";
  const { int, cents } = window.BS.fmtParts(v);
  const dim = k === "settlement" ? 0.6 : 1;

  return h("span", {
    className: "mono",
    title: title || (k ? window.BS.KIND_HINT[k] : undefined),
    style: {
      display: "inline-flex", alignItems: "baseline", gap: 2, opacity: dim,
      textDecoration: strike ? "line-through" : "none",
      fontSize: size ? `${size}px` : undefined,
      fontVariantNumeric: "tabular-nums",
    },
  },
    h("span", { style: { color, fontWeight: 700 } }, sign),
    h("span", { style: { color: emphasis ? color : "var(--fg-1)", fontWeight: 600 } }, "R$ ", int),
    cents && h("span", { style: { color: "var(--fg-3)", fontSize: "0.78em", fontWeight: 500 } }, cents)
  );
}

/**
 * @brief Formata um valor de forma compacta (k/M) pra eixos e Δ.
 * @param v valor em REAIS; o sinal é descartado (quem marca é o caller)
 * @return string "R$ 1,2k" / "R$ 3,4M" / "R$ 950"
 */
function fmtBRLCompact(v) {
  const n = Math.abs(v ?? 0);
  if (n >= 1_000_000) return "R$ " + (n / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (n >= 1_000)     return "R$ " + (n / 1_000).toFixed(1).replace(".", ",") + "k";
  return "R$ " + n.toFixed(0);
}
/**
 * @brief Formata uma data ISO como dia/mês.
 * @param iso data "YYYY-MM-DD"; vazio devolve "—"
 * @return string "DD/MM"
 */
function fmtDateBR(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const PT_MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const PT_SHORT = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/**
 * @brief Formata a data do ciclo de fatura como "5 Mai".
 * @param ddmmyyyy data no formato "DD/MM/YYYY"; vazio devolve "—"
 * @return string "D Mês" com o mês abreviado em pt-BR
 */
function fmtCycleDate(ddmmyyyy) {
  if (!ddmmyyyy) return "—";
  const [d, m] = ddmmyyyy.split("/");
  return `${parseInt(d, 10)} ${PT_SHORT[parseInt(m, 10)]}`;
}

/* ── prettifyDesc ───────────────────────────────────────────────────────────
   Cosmetic, DISPLAY-ONLY cleanup of the raw bank `description`. Never mutates the
   stored value — that stays the source of truth for dedup + classification, so a
   user-set `display_name` always wins over this (callers do display_name ||
   prettifyDesc(description)). Three passes: strip transfer noise → curated accent
   fix (common banking words only; never guesses accents on proper names) → casing
   (ALL-CAPS tokens → Title Case, known acronyms preserved, connectives lowered). */
const _DESC_ACRONYMS = new Set([
  "CDB", "RDB", "SA", "S/A", "ME", "MEI", "EPP", "EIRELI", "LTDA",
  "IOF", "IRRF", "IR", "GRU", "CPF", "CNPJ", "TED", "DOC", "PIX", "II", "III", "IV",
]);
const _DESC_CONNECTIVES = new Set([
  "de", "da", "do", "dos", "das", "e", "em", "no", "na", "nos", "nas", "a", "o", "à",
]);
const _DESC_ACCENTS = {
  "aplicacao": "aplicação", "cobranca": "cobrança", "cartao": "cartão",
  "automacao": "automação", "servico": "serviço", "servicos": "serviços",
  "transferencia": "transferência", "credito": "crédito", "debito": "débito",
  "comercio": "comércio", "avaliacao": "avaliação", "selecao": "seleção",
  "condominio": "condomínio", "salario": "salário", "agua": "água",
};

/**
 * @brief Coloca a primeira letra da palavra em maiúscula.
 * @param w palavra; vazia/nula volta como veio
 * @return palavra capitalizada
 */
function _capWord(w) {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/**
 * @brief Limpa a descrição crua do banco pra exibição — nunca pro armazenamento.
 * @param raw `description` como veio do extrato; vazio volta como veio
 * @return string legível; o valor armazenado segue intacto (é a verdade do
 *         dedup/classificação), e um `display_name` do usuário ganha desta
 */
function prettifyDesc(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();
  // 1. Strip transfer noise: wrapping quotes, "Cp :NNNN-" counterparty codes, and
  //    leading bank routing codes ("...: 00019 136948731 NAME" → "...: NAME").
  s = s.replace(/"/g, "");
  s = s.replace(/Cp\s*:\s*\d+\s*-\s*/gi, "");
  s = s.replace(/:\s*0*\d{4,6}\s+\d{6,}\s+/g, ": ");
  // Drop the Nubank Pix routing tail — everything from the CPF mask / CNPJ onward
  // ("- •••.000.000-•• - BANCO INTER (0077) Agência: 1 Conta: 9") leaving just the
  // counterparty name. Falls back to cutting a stray "Agência:" segment.
  s = s.replace(/\s*[-–]\s*(?:•••|\d{2}\.\d{3}\.\d{3}\/\d{4}).*$/u, "");
  s = s.replace(/\s+Agência:.*$/u, "");
  s = s.replace(/\s+\.\s+/g, " ").replace(/\s{2,}/g, " ").trim();
  // 2+3. Per-token accent + casing, preserving any attached punctuation.
  return s.split(" ").map((tok, i) => {
    const m = tok.match(/^([^0-9A-Za-zÀ-ÿ]*)([0-9A-Za-zÀ-ÿ/]*)([^0-9A-Za-zÀ-ÿ]*)$/);
    if (!m || !m[2]) return tok;
    const [, lead, core, trail] = m;
    const upper = core.toUpperCase();
    const isAllCaps = core === upper && /[A-ZÀ-Ý]/.test(core);
    if (isAllCaps && _DESC_ACRONYMS.has(upper)) return lead + core + trail;
    let base = isAllCaps ? core.toLowerCase() : core;
    const accent = _DESC_ACCENTS[base.toLowerCase()];
    if (accent) base = (!isAllCaps && base[0] === base[0].toUpperCase()) ? _capWord(accent) : accent;
    if (i > 0 && _DESC_CONNECTIVES.has(base.toLowerCase())) return lead + base.toLowerCase() + trail;
    if (isAllCaps) base = _capWord(base);
    return lead + base + trail;
  }).join(" ");
}
/* ── DualLine ───────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza o gráfico de barras receita × despesa (Chart.js).
 * @param props.data pontos {label, income, expenses} — valores em REAIS
 * @param props.height altura do canvas em px (padrão 180)
 * @return elemento React com o <canvas> do gráfico
 */
function DualLine({ data, height = 180 }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } }, []);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    if (chartRef.current) {
      chartRef.current.data.labels = data.map(d => d.label);
      chartRef.current.data.datasets[0].data = data.map(d => d.income || 0);
      chartRef.current.data.datasets[1].data = data.map(d => d.expenses || 0);
      chartRef.current.update('none');
      return;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const posColor   = rootStyles.getPropertyValue("--pos").trim() || "oklch(72% 0.14 155)";
    const negColor   = rootStyles.getPropertyValue("--neg").trim() || "oklch(68% 0.16 25)";
    const fg2Color   = rootStyles.getPropertyValue("--fg-2").trim();
    const line1Color = rootStyles.getPropertyValue("--line-1").trim();

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: "Receita",
            data: data.map(d => d.income || 0),
            backgroundColor: posColor,
            borderRadius: 4,
            barPercentage: 0.6,
            categoryPercentage: 0.8
          },
          {
            label: "Despesa",
            data: data.map(d => d.expenses || 0),
            backgroundColor: negColor,
            borderRadius: 4,
            barPercentage: 0.6,
            categoryPercentage: 0.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "oklch(20% 0.01 250 / 0.9)",
            titleFont: { size: 11, family: "Inter" },
            bodyFont: { size: 13, family: "Departure Mono", weight: "bold" },
            padding: 12,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtBRL(ctx.raw)}` }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: { color: fg2Color, font: { size: 10, family: "Departure Mono" } }
          },
          y: {
            beginAtZero: true,
            grid: { color: line1Color, drawBorder: false, tickLength: 0, borderDash: [2, 3] },
            border: { display: false },
            ticks: { color: fg2Color, font: { size: 10, family: "Departure Mono" }, callback: v => fmtBRLCompact(v), maxTicksLimit: 5 }
          }
        }
      }
    });
  }, [data]);

  return React.createElement("div", { style: { height, width: "100%" } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── Donut ──────────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza o donut de composição (Chart.js).
 * @param props.data itens {name|label, [valueKey]} — valores em REAIS
 * @param props.size lado do gráfico em px (padrão 140)
 * @param props.thickness espessura do anel em px (padrão 18)
 * @param props.valueKey campo do item que carrega o valor (padrão "balance")
 * @param props.colors paleta; ausente usa a padrão
 * @return elemento React com o <canvas> do gráfico
 */
function Donut({ data, size = 140, thickness = 18, valueKey = "balance", colors }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } }, []);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    const COLORS = colors || ["oklch(72% 0.12 250)", "oklch(70% 0.13 290)", "oklch(74% 0.11 220)", "oklch(68% 0.10 200)", "oklch(72% 0.12 312)"];

    if (chartRef.current) {
      if (chartRef.current.data.datasets[0].data.length === data.length) {
        chartRef.current.data.labels = data.map(d => d.name || d.label || "Item");
        chartRef.current.data.datasets[0].data = data.map(d => d[valueKey] || 0);
        chartRef.current.update('none');
        return;
      }
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.map(d => d.name || d.label || "Item"),
        datasets: [{ 
          data: data.map(d => d[valueKey] || 0), 
          backgroundColor: COLORS, 
          borderWidth: 3, 
          borderColor: getComputedStyle(document.documentElement).getPropertyValue("--bg-1").trim() || "transparent",
          hoverOffset: 6 
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: `${100 - (thickness / size) * 100}%`,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtBRL(ctx.raw)}` } }
        }
      }
    });
  }, [data, colors, thickness, size, valueKey]);

  return React.createElement("div", { style: { width: size, height: size } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza um diálogo modal centrado, com trap de foco e Esc pra fechar.
 * @param props.open false não renderiza nada
 * @param props.onClose chamado no Esc, no ✕ e no clique fora
 * @param props.title título do cabeçalho
 * @param props.children corpo do modal
 * @param props.width largura em px (padrão 480), limitada a 92vw
 * @return elemento React com o overlay + diálogo, ou null quando fechado
 */
function Modal({ open, onClose, title, children, width = 480 }) {
  const dialogRef = _useRef(null);
  const titleId   = _useRef("modal-title-" + Math.random().toString(36).slice(2)).current;

  _useEffect(() => {
    if (!open || !dialogRef.current) return;
    const prev = document.activeElement;
    const sel  = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const get  = () => Array.from(dialogRef.current.querySelectorAll(sel));
    get()[0]?.focus();
    /**
     * @brief Fecha no Esc e circula o Tab dentro do diálogo.
     * @param e evento de teclado do document
     */
    function trap(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose && onClose(); return; }
      if (e.key !== "Tab") return;
      const nodes = get();
      if (!nodes.length) { e.preventDefault(); return; }
      const fi = nodes[0], la = nodes[nodes.length - 1];
      if (e.shiftKey) { if (document.activeElement === fi) { e.preventDefault(); la?.focus(); } }
      else            { if (document.activeElement === la) { e.preventDefault(); fi?.focus(); } }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); prev?.focus(); };
  }, [open]);

  if (!open) return null;
  return React.createElement("div", {
    onClick: onClose, role: "presentation",
    style: { position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }
  },
    React.createElement("div", {
      ref: dialogRef,
      onClick: e => e.stopPropagation(), className: "fade-in",
      role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
      style: { width, maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--bg-1)", border: "1px solid var(--line-2)", boxShadow: "0 24px 48px oklch(0% 0 0 / 0.6)", borderRadius: 16 }
    },
      React.createElement("div", { style: { padding: "24px 32px 16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" } },
        React.createElement("div", { id: titleId, style: { fontWeight: 700, fontSize: "var(--fz-4)", letterSpacing: "-0.01em" } }, title),
        React.createElement("button", { 
          onClick: onClose, "aria-label": "Fechar", title: "Fechar",
          style: { width: 32, height: 32, borderRadius: "50%", background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s" },
          onMouseEnter: e => { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-2)"; },
          onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; }
        }, "✕")
      ),
      React.createElement("div", { style: { padding: "0 32px 32px 32px", overflow: "auto" } }, children)
    )
  );
}

/* ── useToasts ──────────────────────────────────────────────────────────── */
/**
 * @brief Hook da fila de toasts; escuta também o evento global `bs-toast`.
 * @return {push, Toaster} — `push` enfileira, `Toaster` é o componente da pilha
 */
function useToasts() {
  const [list, setList] = _useState([]);
  /**
   * @brief Enfileira um toast e agenda o auto-fechamento.
   * @param msg texto exibido
   * @param kind "info" (padrão), "success" ou "error" — define ícone e cor
   * @param action ação opcional {label, onClick, onTimeout}; com ação o toast
   *        dura 6s em vez de 3,5s, e `onTimeout` roda se o usuário não agir
   *        (é como o "desfazer" da exclusão confirma a operação)
   * @return função que cancela o timer e remove o toast na hora
   */
  const push = _useCallback((msg, kind = "info", action = null) => {
    const id = Math.random().toString(36).slice(2);
    const duration = action ? 6000 : 3500;
    setList(l => [...l, { id, msg, kind, action, duration }]);
    const timer = setTimeout(() => {
      setList(l => {
        const item = l.find(x => x.id === id);
        if (item && item.action && item.action.onTimeout) item.action.onTimeout();
        return l.filter(t => t.id !== id);
      });
    }, duration);
    return () => { clearTimeout(timer); setList(l => l.filter(t => t.id !== id)); };
  }, []);

  _useEffect(() => {
    const handler = e => push(e.detail.msg, e.detail.kind, e.detail.action);
    window.addEventListener('bs-toast', handler);
    return () => window.removeEventListener('bs-toast', handler);
  }, [push]);

  const ICONS = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
  };

  /**
   * @brief Renderiza a pilha de toasts no canto inferior direito.
   * @return elemento React com um card por toast na fila
   */
  const Toaster = _useCallback(() => React.createElement("div", {
    role: "status", "aria-live": "polite", "aria-atomic": "false",
    style: { position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 12, zIndex: 999, alignItems: "flex-end" }
  },
    list.map(t => {
      const _k = t.kind === "success" ? "pos" : t.kind === "error" ? "neg" : "info";
      return React.createElement("div", {
        key: t.id, className: "toast",
        style: {
          background: "var(--bg-1)",
          border: "1px solid var(--line-2)",
          color: "var(--fg-0)",
          padding: "10px 16px 10px 12px", minWidth: 320, maxWidth: 500,
          borderRadius: 12, fontSize: 13, fontWeight: 500,
          boxShadow: "0 12px 32px oklch(0% 0 0 / 0.25), 0 4px 12px oklch(0% 0 0 / 0.15)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
          position: "relative", overflow: "hidden"
        }
      },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, zIndex: 1 } },
          React.createElement("div", { 
            dangerouslySetInnerHTML: { __html: ICONS[t.kind] || ICONS.info },
            style: { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: `var(--${_k}-bg)`, color: `var(--${_k})`, flexShrink: 0 }
          }),
          React.createElement("span", { style: { lineHeight: 1.3 } }, t.msg)
        ),
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", zIndex: 1 } },
          t.action && React.createElement("button", {
            onClick: () => { t.action.onClick(); setList(l => l.filter(x => x.id !== t.id)); },
            style: { cursor: "pointer", background: "transparent", border: "none", padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, color: `var(--${_k})`, textTransform: "uppercase", letterSpacing: "0.04em", transition: "background 0.15s" },
            onMouseEnter: e => e.currentTarget.style.background = `var(--${_k}-bg)`,
            onMouseLeave: e => e.currentTarget.style.background = "transparent"
          }, t.action.label),
          React.createElement("button", {
            onClick: () => setList(l => l.filter(x => x.id !== t.id)),
            title: "Fechar",
            style: { cursor: "pointer", background: "transparent", border: "none", padding: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", color: "var(--fg-3)", transition: "all 0.15s" },
            onMouseEnter: e => { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-2)"; },
            onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; }
          }, "✕")
        ),
        t.action && React.createElement("div", {
          style: {
            position: "absolute", bottom: 0, left: 0, height: 3, background: `var(--${_k})`,
            animation: `toast-progress ${t.duration}ms linear forwards`
          }
        })
      );
    })
  ), [list]);

  return { push, Toaster };
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza uma gaveta lateral direita, com trap de foco e Esc pra fechar.
 * @param props.open false não renderiza nada
 * @param props.onClose chamado no Esc, no ✕ e no clique fora
 * @param props.children corpo da gaveta
 * @param props.width largura em px (padrão 480)
 * @param props.title título; ausente omite o cabeçalho
 * @return elemento React com o overlay + gaveta, ou null quando fechada
 */
function Drawer({ open, onClose, children, width = 480, title }) {
  const drawerRef = _useRef(null);

  _useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  _useEffect(() => {
    if (!open || !drawerRef.current) return;
    const prev = document.activeElement;
    const sel  = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const get  = () => Array.from(drawerRef.current.querySelectorAll(sel));
    get()[0]?.focus();
    /**
     * @brief Fecha no Esc e circula o Tab dentro da gaveta.
     * @param e evento de teclado do document
     */
    function trap(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose && onClose(); return; }
      if (e.key !== "Tab") return;
      const nodes = get();
      if (!nodes.length) { e.preventDefault(); return; }
      const fi = nodes[0], la = nodes[nodes.length - 1];
      if (e.shiftKey) { if (document.activeElement === fi) { e.preventDefault(); la?.focus(); } }
      else            { if (document.activeElement === la) { e.preventDefault(); fi?.focus(); } }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); prev?.focus(); };
  }, [open]);

  if (!open) return null;
  return React.createElement("div", {
    onClick: onClose, role: "presentation",
    style: { position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.4)", backdropFilter: "blur(2px)", zIndex: 200, display: "flex", justifyContent: "flex-end" }
  },
    React.createElement("div", {
      ref: drawerRef,
      onClick: e => e.stopPropagation(),
      role: "dialog", "aria-modal": "true",
      style: { width, maxWidth: "100%", height: "100%", background: "var(--bg-0)", boxShadow: "-8px 0 32px oklch(0% 0 0 / 0.2)", display: "flex", flexDirection: "column", animation: "slide-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)" }
    },
      title && React.createElement("div", { style: { padding: "16px 24px", borderBottom: "1px solid var(--line-0)", display: "flex", justifyContent: "space-between", alignItems: "center" } },
        React.createElement("span", { style: { fontWeight: 700, fontSize: 16 } }, title),
        React.createElement("button", { onClick: onClose, className: "btn btn-ghost btn-sm", "aria-label": "Fechar" }, "✕")
      ),
      React.createElement("div", { style: { flex: 1, overflowY: "auto" } }, children)
    )
  );
}

/* ── BankChip ───────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza o chip do banco de uma linha, colorido por instituição.
 * @param props.bank nome do banco ("nubank"/"inter"/"outro"); pode faltar
 * @param props.accountId id da conta ("nu-db"/"inter-db"/"inter-cc") — usado
 *        como prefixo quando `bank` não identifica
 * @return elemento React <span> com o rótulo do banco
 */
function BankChip({ bank, accountId }) {
  const isNu = bank === "nubank" || (accountId && accountId.startsWith("nu"));
  const isInter = bank === "inter" || (accountId && accountId.startsWith("inter"));
  // "outro" is the B3 parser's bucket for unrecognized issuers — label it "B3"
  // (matches the "B3 / Outras" filter) instead of leaking the raw enum value.
  const label = isNu ? "Nubank" : (isInter ? "Inter" : (bank === "outro" ? "B3" : (bank || accountId)));
  const cls = isNu ? "nubank" : (isInter ? "inter" : "");
  return React.createElement("span", { className: `chip ${cls}` }, label);
}

/* ── SegmentControl ─────────────────────────────────────────────────────── */
/**
 * @brief Renderiza um grupo de botões-rádio segmentado.
 * @param props.options opções {value, label, icon?}
 * @param props.value valor selecionado
 * @param props.onChange chamado com o valor da opção clicada
 * @param props.columns colunas do grid (padrão 3)
 * @return elemento React com o radiogroup
 */
function SegmentControl({ options, value, onChange, columns = 3 }) {
  return React.createElement("div", { className: "seg-control", role: "radiogroup", style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } },
    options.map(opt => React.createElement("button", {
      key: opt.value, type: "button",
      role: "radio", "aria-checked": opt.value === value,
      className: `seg-btn${opt.value === value ? " active" : ""}`,
      onClick: () => onChange(opt.value),
    }, opt.icon && React.createElement("span", null, opt.icon), React.createElement("span", null, opt.label)))
  );
}

/* ── BrokerSharkLogo ────────────────────────────────────────────────────── */
/**
 * @brief Renderiza a marca (ícone + wordmark) da topbar.
 * @param props.size lado do ícone em px (padrão 28)
 * @return elemento React com o logo
 */
function BrokerSharkLogo({ size = 28 }) {
  return React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } },
    React.createElement("img", {
      src: "/static/img/favicon.ico",
      alt: "",
      width: size, height: size,
      style: { borderRadius: 6, display: "block", flexShrink: 0 }
    }),
    React.createElement("span", { style: { fontWeight: 700, fontSize: 14, letterSpacing: "-0.015em", color: "var(--fg-0)" } },
      "Broker",
      React.createElement("span", { style: { color: "var(--accent)" } }, "Shark")
    )
  );
}

/* ── TxRow ──────────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza uma linha da tabela de lançamentos.
 *
 * Memoizado com comparador explícito (2º argumento do React.memo): a tabela
 * chega a 300 linhas, e só os campos listados lá mudam o que a linha desenha.
 *
 * @param props.t transação (`amount` em REAIS)
 * @param props.cols colunas visíveis ("date","desc","cat","account","method",
 *        "amount","balance") — a de saldo só é pedida quando é verdade
 * @param props.onEditCategory abre o editor da transação ao clicar na linha
 * @param props.onApplySuggestion aplica a categoria sugerida pelo histórico
 *        (suggest-only: nada é gravado sem este clique)
 * @param props.catsByFlow {expense, income} — categorias do select inline
 * @param props.onInlineCategory grava a recategorização feita no select
 * @param props.amountSize corpo da fonte do valor em px (ver scaleFor)
 * @param props.selected true quando a linha está marcada
 * @param props.onToggleSelect alterna a seleção; ausente esconde o checkbox
 * @param props.runningBalance saldo da conta após o lançamento, em REAIS;
 *        null/undefined mostra "—"
 * @return Fragment React com o <tr> da linha
 */
const TxRow = React.memo(({ t, cols, onEditCategory, onApplySuggestion, catsByFlow, onInlineCategory,
                           amountSize, selected, onToggleSelect, runningBalance }) => {
  const h = React.createElement;
  const K = window.BS.KIND;
  const kind = window.BS.moneyKind(t);
  const isThirdParty = kind === K.THIRD_PARTY;
  const _self   = kind === K.TRANSFER;
  const _invest = kind === K.INVEST;
  const _settle = kind === K.SETTLEMENT;
  const rows = [
    h("tr", {
      key: t.id,
      className: selected ? "row-active" : undefined,
      onClick: () => onEditCategory && onEditCategory(t),
      // Third-party não é mais grayscale: tem cor própria (--warn) e some dos
      // totais. Apagar a linha inteira escondia uma pendência que precisa voltar.
      style: { cursor: "pointer" }
    },
      onToggleSelect && h("td", { style: { width: 28 }, onClick: e => e.stopPropagation() },
        h("input", {
          type: "checkbox", checked: !!selected, "aria-label": "Selecionar lançamento",
          onChange: () => onToggleSelect(t), style: { cursor: "pointer" },
        })
      ),
      cols.includes("date") && h("td", { className: "mono", style: { color: "var(--fg-3)", fontSize: 10 } }, fmtDateBR(t.date)),
      cols.includes("desc") && h("td", { style: { maxWidth: cols.includes("account") ? 260 : "none" } },
        h("div", { style: { display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: 6, overflow: "hidden" } },
            h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-0)", fontWeight: 700, fontSize: 13 } }, t.display_name || prettifyDesc(t.description)),
            isThirdParty && h("span", { title: window.BS.KIND_HINT[K.THIRD_PARTY], style: { fontSize: 9, padding: "2px 6px", borderRadius: 4, border: "1px dashed var(--warn)", color: "var(--warn)", fontWeight: 600, flexShrink: 0 } }, "TERCEIROS")
          ),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.description)
        )
      ),
      cols.includes("cat") && h("td", null,
        (_settle || _self || _invest || isThirdParty)
          // Espécie não-categorizável: a tag diz o que é, na cor da espécie.
          ? h("span", {
              className: "data-tag",
              title: window.BS.KIND_HINT[kind],
              style: {
                borderColor: `color-mix(in oklch, ${window.BS.KIND_COLOR[kind]} 30%, transparent)`,
                color: window.BS.KIND_COLOR[kind],
              },
            }, { settlement: "pagamento de fatura", transfer: "transferência",
                 invest: "investimento", third_party: "de terceiros" }[kind])
            : (onInlineCategory && catsByFlow)
              // Recategorização inline: select em vez do rótulo estático.
              ? h("select", {
                  value: t.category_id || "",
                  onClick: e => e.stopPropagation(),
                  onChange: e => { e.stopPropagation(); onInlineCategory(t, parseInt(e.target.value, 10)); },
                  style: { border: "2px solid var(--line-1)", background: "var(--bg-0)", fontFamily: "var(--ff-mono)", fontSize: 11, padding: "2px 4px", cursor: "pointer", color: "var(--fg-1)" },
                },
                  h("option", { value: "" }, t.flow === "expense" ? "Sem categoria" : "Receita"),
                  (catsByFlow[t.flow] || []).map(c => h("option", { key: c.id, value: c.id }, c.name))
                )
              : t.category
                ? h("span", {
                    className: "data-tag",
                    style: {
                      ...(t.flow === "income" ? { borderColor: "color-mix(in oklch, var(--pos) 30%, transparent)", color: "var(--pos)" } : {}),
                    }
                  }, t.category)
                : (t.suggested_category_id != null && onApplySuggestion)
                  // Sugestão do histórico (suggest-only): 1 clique aplica, nada é
                  // auto-escrito — mesmo índice do preview de import / painel de lote.
                  ? h("button", {
                      className: "data-tag",
                      title: `Sugerida do histórico — clique para aplicar "${t.suggested_category_name}"`,
                      onClick: e => { e.stopPropagation(); onApplySuggestion(t); },
                      style: {
                        borderStyle: "dashed", cursor: "pointer", background: "none",
                        borderColor: "color-mix(in oklch, var(--accent) 45%, transparent)",
                        color: "var(--accent)", fontFamily: "inherit",
                      },
                    }, `✓ ${t.suggested_category_name}?`)
                  : h("span", {
                      className: "data-tag",
                      style: { borderStyle: "dashed", color: "var(--fg-3)" },
                    }, t.flow === "expense" ? "Sem categoria" : "Receita")
      ),
      cols.includes("account") && h("td", null, h(BankChip, { accountId: t.account_id, bank: t.bank })),
      cols.includes("method") && h("td", { className: "mono", style: { fontSize: 10, color: "var(--fg-2)", textTransform: "uppercase" } },
        ({ pix: "PIX", pix_received: "PIX", credit: "CRÉDITO", ted: "TED", transfer: "TRANSF", debit: "DÉBITO", salary: "SALÁRIO", freelance: "FREELA" })[t.method] || t.method || "—"),
      cols.includes("amount") && h("td", { className: "num" },
        h("div", { style: { display: "flex", justifyContent: "flex-end", width: "100%" } },
          h(Money, { t, size: amountSize })
        )
      ),
      // Saldo corrente: só existe agrupamento-off + conta única + ordem por data
      // (ver TxTableWidget). Fora disso a coluna nem é pedida.
      cols.includes("balance") && h("td", { className: "num mono", style: { fontSize: 10, color: "var(--fg-3)" } },
        runningBalance == null ? "—" : fmtBRL(runningBalance)
      )
    )
  ];
  return h(React.Fragment, null, ...rows);
}, (prev, next) =>
  prev.t.id === next.t.id &&
  prev.t.amount === next.t.amount &&
  prev.t.date === next.t.date &&
  prev.t.description === next.t.description &&
  prev.t.category === next.t.category &&
  prev.t.category_id === next.t.category_id &&
  prev.t.is_third_party === next.t.is_third_party &&
  prev.t.display_name === next.t.display_name &&
  prev.t.suggested_category_id === next.t.suggested_category_id &&
  prev.t.counterpart === next.t.counterpart &&
  prev.t.is_settlement === next.t.is_settlement &&
  prev.t.method === next.t.method &&
  prev.amountSize === next.amountSize &&
  prev.selected === next.selected &&
  prev.runningBalance === next.runningBalance &&
  prev.onToggleSelect === next.onToggleSelect &&
  prev.onEditCategory === next.onEditCategory &&
  prev.onApplySuggestion === next.onApplySuggestion &&
  prev.catsByFlow === next.catsByFlow &&
  prev.onInlineCategory === next.onInlineCategory
);

// ── Transaction classification ────────────────────────────────────────────────
// Derivados de moneyKind (money.js) — a ÚNICA regra do front. Antes eram quatro
// predicados independentes, o que deixava is_third_party sem espécie: saía dos
// totais mas era pintado como consumo. Ver money.js pra ordem de precedência e
// pra equivalência com a regra consumo-despesa do CLAUDE.md.
/**
 * @brief Diz se a linha é despesa de consumo (entra nos totais de gasto).
 * @param t transação; ausente devolve false (moneyKind(null) é null)
 * @return true só para a espécie EXPENSE
 */
const isConsumptionExpense = t => window.BS.moneyKind(t) === "expense";
/**
 * @brief Diz se a linha é receita real (entra nos totais de entrada).
 * @param t transação; ausente devolve false
 * @return true só para a espécie REVENUE
 */
const isRevenue            = t => window.BS.moneyKind(t) === "revenue";
/**
 * @brief Diz se a linha é perna de investimento (não é gasto nem ganho).
 * @param t transação; ausente devolve false
 * @return true só para a espécie INVEST
 */
const isInvest             = t => window.BS.moneyKind(t) === "invest";
/**
 * @brief Diz se a linha é transferência entre contas próprias.
 * @param t transação; ausente devolve false
 * @return true só para a espécie TRANSFER
 */
const isSelf               = t => window.BS.moneyKind(t) === "transfer";
/**
 * @brief Diz se a linha é gasto de terceiro (fora dos totais, mas é pendência).
 * @param t transação; ausente devolve false
 * @return true só para a espécie THIRD_PARTY
 */
const isThirdParty         = t => window.BS.moneyKind(t) === "third_party";

// ── FilterBar (faceted-filter chip strip) ───────────────────────────────────
/**
 * @brief Renderiza a faixa de chips do filtro facetado ativo.
 * @param props.filter filtro atual (ver filter.js)
 * @param props.onRemove chamado com (kind, value) do chip clicado
 * @param props.onClear limpa todas as facetas
 * @return elemento React com os chips, ou null quando não há nada filtrado
 */
function FilterBar({ filter, onRemove, onClear }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const chips = [];
  filter.categories.forEach(v => chips.push(["categories", v, v]));
  filter.banks.forEach(v => chips.push(["banks", v, v]));
  filter.accounts.forEach(v => chips.push(["accounts", v, v]));
  if (filter.flow !== "all") chips.push(["flow", filter.flow, filter.flow === "expense" ? "Despesas" : "Receitas"]);
  if (filter.method !== "all") chips.push(["method", filter.method, filter.method.toUpperCase()]);
  if (!chips.length && !filter.search) return null;
  return h("div", { className: "filter-bar" },
    chips.map(([kind, value, label]) => h("button", {
      key: kind + ":" + value, className: "filter-chip", onClick: () => onRemove(kind, value),
      title: "Remover filtro",
    }, label, h("span", { className: "filter-chip-x" }, "×"))),
    h("button", { className: "filter-chip filter-chip-clear", onClick: onClear }, "limpar tudo")
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, {
  fmtBRL, fmtBRLCompact, fmtDateBR, prettifyDesc,
  PT_MONTHS, PT_SHORT, fmtCycleDate,
  DualLine, Donut,
  Modal, Drawer, useToasts, BankChip, SegmentControl,
  BrokerSharkLogo, TxRow, FilterBar, Money,
  isSelf, isConsumptionExpense, isRevenue, isInvest, isThirdParty,
});

/* ── SingleAreaChart ───────────────────────────────────────────────────────────── */
/**
 * @brief Renderiza o gráfico de área de uma série só (Chart.js).
 * @param props.data pontos {label, value} — `value` em REAIS
 * @param props.height altura do canvas em px (padrão 180)
 * @param props.color cor da linha, como var() do tema (padrão "var(--pos)")
 * @param props.label rótulo da série no tooltip (padrão "Evolução")
 * @return elemento React com o <canvas> do gráfico
 */
function SingleAreaChart({ data, height = 180, color = "var(--pos)", label = "Evolução" }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } }, []);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    if (chartRef.current) {
      chartRef.current.data.labels = data.map(d => d.label);
      chartRef.current.data.datasets[0].data = data.map(d => d.value || 0);
      chartRef.current.update('none');
      return;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const mainColor = rootStyles.getPropertyValue(color.replace("var(", "").replace(")", "")).trim() || color;
    const fg2Color   = rootStyles.getPropertyValue("--fg-2").trim();
    const line1Color = rootStyles.getPropertyValue("--line-1").trim();

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          label: label,
          data: data.map(d => d.value || 0),
          borderColor: mainColor,
          backgroundColor: (context) => {
            const chart = context.chart;
            const {ctx, chartArea} = chart;
            if (!chartArea) return "transparent";
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            const base = mainColor.includes("oklch") ? mainColor : "oklch(60% 0.15 250)";
            const inner = base.replace(/oklch\((.*?)\)/, "$1").split("/")[0].trim();
            gradient.addColorStop(0, `oklch(${inner} / 0.15)`);
            gradient.addColorStop(1, `oklch(${inner} / 0.01)`);
            return gradient;
          },
          borderWidth: 3, tension: 0.4, fill: true,
          pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: "var(--bg-0)", pointBorderColor: mainColor, pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { 
          legend: { display: false }, 
          tooltip: { 
            backgroundColor: "oklch(20% 0.01 250 / 0.9)", 
            titleFont: { size: 11, family: "var(--ff-sans)" }, 
            bodyFont: { size: 13, weight: "bold", family: "var(--ff-mono)" }, 
            displayColors: false, padding: 12, cornerRadius: 8
          } 
        },
        scales: {
          x: { grid: { display: false, drawBorder: false }, ticks: { color: fg2Color, font: { size: 10, family: "var(--ff-mono)" } } },
          y: { position: "right", beginAtZero: true, grid: { color: line1Color, drawBorder: false, borderDash: [2, 4] }, border: { display: false }, ticks: { color: fg2Color, font: { size: 10, family: "var(--ff-mono)" }, maxTicksLimit: 6, callback: v => "R$ " + (v/1000 >= 1 ? (v/1000).toFixed(1) + "k" : v) } }
        }
      }
    });
  }, [data, color, label]);

  return React.createElement("div", { style: { position: "relative", height, width: "100%" } },
    React.createElement("canvas", { ref: canvasRef })
  );
}
window.BS.SingleAreaChart = SingleAreaChart;

})();
