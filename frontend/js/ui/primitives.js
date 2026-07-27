(function () {

const { useState: _useState, useEffect: _useEffect, useCallback: _useCallback, useRef: _useRef } = React;

function fmtBRL(v, opts = {}) {
  const { sign = "auto", decimals = 2 } = opts;
  const n = v ?? 0;
  const s = "R$ " + Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (sign === "always") return (n >= 0 ? "+" : "−") + s;
  if (sign === "neg-only") return n < 0 ? "−" + s : s;
  return n < 0 ? "−" + s : s;
}

function Money({ t, value, kind, size, emphasis = false, strike = false, title }) {
  const h = React.createElement;
  const k = kind || (t ? window.BS.moneyKind(t) : null);
  const v = value != null ? value : (t ? t.amount : 0);

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

function fmtBRLCompact(v) {
  const n = Math.abs(v ?? 0);
  if (n >= 1_000_000) return "R$ " + (n / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (n >= 1_000)     return "R$ " + (n / 1_000).toFixed(1).replace(".", ",") + "k";
  return "R$ " + n.toFixed(0);
}

function fmtDateBR(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Data COM ano. `fmtDateBR` corta em DD/MM porque no mês selecionado o ano é
// óbvio — mas fora dele o corte mente: um vencimento "15/05" de 2029 lido como
// deste ano vira "semana que vem", e três medições de 31/12 de anos diferentes
// viram três linhas idênticas. Onde a data atravessa anos, use esta.
function fullDateBR(iso) {
  const [y, m, d] = String(iso || "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : (iso ? String(iso) : "—");
}

const PT_MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const PT_SHORT = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

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

function _capWord(w) {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

function prettifyDesc(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();

  s = s.replace(/"/g, "");
  s = s.replace(/Cp\s*:\s*\d+\s*-\s*/gi, "");
  s = s.replace(/:\s*0*\d{4,6}\s+\d{6,}\s+/g, ": ");

  s = s.replace(/\s*[-–]\s*(?:•••|\d{2}\.\d{3}\.\d{3}\/\d{4}).*$/u, "");
  s = s.replace(/\s+Agência:.*$/u, "");
  s = s.replace(/\s+\.\s+/g, " ").replace(/\s{2,}/g, " ").trim();

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

function Modal({ open, onClose, title, children, width = 480 }) {
  const dialogRef = _useRef(null);
  const titleId   = _useRef("modal-title-" + Math.random().toString(36).slice(2)).current;

  _useEffect(() => {
    if (!open || !dialogRef.current) return;
    const prev = document.activeElement;
    const sel  = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const get  = () => Array.from(dialogRef.current.querySelectorAll(sel));
    get()[0]?.focus();

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
    style: { position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "var(--z-modal)" }
  },
    React.createElement("div", {
      ref: dialogRef,
      onClick: e => e.stopPropagation(), className: "modal fade-in",
      role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
      style: { width, maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--bg-1)", border: "1px solid var(--line-2)" }
    },
      React.createElement("div", { style: { padding: "24px 32px 16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" } },
        React.createElement("div", { id: titleId, style: { fontWeight: 700, fontSize: "var(--fz-4)", letterSpacing: "-0.01em" } }, title),
        React.createElement("button", {
          onClick: onClose, "aria-label": "Fechar", title: "Fechar",
          style: { width: 32, height: 32, background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s" },
          onMouseEnter: e => { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-2)"; },
          onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; }
        }, "✕")
      ),
      React.createElement("div", { style: { padding: "0 32px 32px 32px", overflow: "auto" } }, children)
    )
  );
}

function useToasts() {
  const [list, setList] = _useState([]);

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

  const Toaster = _useCallback(() => React.createElement("div", {
    role: "status", "aria-live": "polite", "aria-atomic": "false",
    style: { position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 12, zIndex: "var(--z-toast)", alignItems: "flex-end" }
  },
    list.map(t => {
      const _k = t.kind === "success" ? "pos" : t.kind === "error" ? "neg" : "info";
      return React.createElement("div", {
        key: t.id, className: "toast",
        style: {
          background: "var(--bg-1)",
          border: "1px solid var(--line-2)",
          color: "var(--fg-0)",
          padding: "10px 16px 10px 12px", minWidth: 320, maxWidth: 500, fontSize: 13, fontWeight: 500,
          boxShadow: "0 12px 32px oklch(0% 0 0 / 0.25), 0 4px 12px oklch(0% 0 0 / 0.15)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
          position: "relative", overflow: "hidden"
        }
      },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, zIndex: 1 } },
          React.createElement("div", {
            dangerouslySetInnerHTML: { __html: ICONS[t.kind] || ICONS.info },
            style: { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, background: `var(--${_k}-bg)`, color: `var(--${_k})`, flexShrink: 0 }
          }),
          React.createElement("span", { style: { lineHeight: 1.3 } }, t.msg)
        ),
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", zIndex: 1 } },
          t.action && React.createElement("button", {
            onClick: () => { t.action.onClick(); setList(l => l.filter(x => x.id !== t.id)); },
            style: { cursor: "pointer", background: "transparent", border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 700, color: `var(--${_k})`, textTransform: "uppercase", letterSpacing: "0.04em", transition: "background 0.15s" },
            onMouseEnter: e => e.currentTarget.style.background = `var(--${_k}-bg)`,
            onMouseLeave: e => e.currentTarget.style.background = "transparent"
          }, t.action.label),
          React.createElement("button", {
            onClick: () => setList(l => l.filter(x => x.id !== t.id)),
            title: "Fechar",
            style: { cursor: "pointer", background: "transparent", border: "none", padding: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-3)", transition: "all 0.15s" },
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

// Overlay — camada de drill-down tela cheia sobre o dashboard (estado preservado
// atrás). Difere do Modal: coluna full-height, não caixa centrada. Conteúdo é dono
// do próprio header. Esc fecha, foco preso, corpo rola por dentro.
function Overlay({ open, onClose, children, width = 760 }) {
  const ref = _useRef(null);

  _useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  _useEffect(() => {
    if (!open || !ref.current) return;
    const prev = document.activeElement;
    const sel  = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const get  = () => Array.from(ref.current.querySelectorAll(sel));
    get()[0]?.focus();

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
    style: { position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.55)", zIndex: "var(--z-layer)", display: "flex", justifyContent: "center" }
  },
    React.createElement("div", {
      ref,
      onClick: e => e.stopPropagation(), className: "fade-in",
      role: "dialog", "aria-modal": "true",
      style: { width, maxWidth: "100%", height: "100%", background: "var(--bg-0)", borderLeft: "1px solid var(--line-1)", borderRight: "1px solid var(--line-1)", display: "flex", flexDirection: "column" }
    }, children)
  );
}

function BankChip({ bank, accountId }) {
  const isNu = bank === "nubank" || (accountId && accountId.startsWith("nu"));
  const isInter = bank === "inter" || (accountId && accountId.startsWith("inter"));

  const label = isNu ? "Nubank" : (isInter ? "Inter" : (bank === "outro" ? "B3" : (bank || accountId)));
  const cls = isNu ? "nubank" : (isInter ? "inter" : "");
  return React.createElement("span", { className: `chip ${cls}` }, label);
}

// fill=true ocupa a largura toda em `columns` colunas; sem ele, fica inline.
function SegmentControl({ options, value, onChange, columns = 3, fill = true }) {
  return React.createElement("div", {
    className: `px-seg${fill ? " px-seg--fill" : ""}`, role: "radiogroup",
    style: fill ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined,
  },
    options.map(opt => React.createElement("button", {
      key: opt.value, type: "button",
      role: "radio", "aria-checked": opt.value === value,
      className: `px-seg-btn${opt.value === value ? " active" : ""}`,
      onClick: () => onChange(opt.value),
    }, opt.icon && React.createElement("span", null, opt.icon), React.createElement("span", null, opt.label)))
  );
}

function BrokerSharkLogo({ size = 28 }) {
  return React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } },
    React.createElement("img", {
      src: "/static/img/favicon.ico",
      alt: "",
      width: size, height: size,
      style: { display: "block", flexShrink: 0 }
    }),
    React.createElement("span", { style: { fontWeight: 700, fontSize: 14, letterSpacing: "-0.015em", color: "var(--fg-0)" } },
      "Broker",
      React.createElement("span", { style: { color: "var(--accent)" } }, "Shark")
    )
  );
}

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
            isThirdParty && h("span", { className: "data-tag", title: window.BS.KIND_HINT[K.THIRD_PARTY], style: { borderStyle: "dashed", borderColor: "var(--warn)", color: "var(--warn)", fontWeight: 600, flexShrink: 0 } }, "TERCEIROS")
          ),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.description)
        )
      ),
      cols.includes("cat") && h("td", null,
        (_settle || _self || _invest || isThirdParty)

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

const isConsumptionExpense = t => window.BS.moneyKind(t) === "expense";

const isRevenue            = t => window.BS.moneyKind(t) === "revenue";

const isInvest             = t => window.BS.moneyKind(t) === "invest";

const isSelf               = t => window.BS.moneyKind(t) === "transfer";

const isThirdParty         = t => window.BS.moneyKind(t) === "third_party";

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
  fmtBRL, fmtBRLCompact, fmtDateBR, fullDateBR, prettifyDesc,
  PT_MONTHS, PT_SHORT,
  Modal, Overlay, useToasts, BankChip, SegmentControl,
  BrokerSharkLogo, TxRow, FilterBar, Money,
  isSelf, isConsumptionExpense, isRevenue, isInvest, isThirdParty,
});

})();
