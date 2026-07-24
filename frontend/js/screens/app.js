(function () {

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  fmtBRL, fmtDateBR, Modal, useToasts, SegmentControl, BankChip, BrokerSharkLogo,
  PT_MONTHS, PT_SHORT,
  DashboardView,
  CategoriesPanel,
  ImportModal,
  isSelf, isInvest,
} = window.BS;

function useAppInit() {
  useEffect(() => {
    document.documentElement.dataset.density = "comfortable";
  }, []);
}

function ConfirmDeleteModal({ tx, onCancel, onConfirm }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const desc = tx.display_name || window.BS.prettifyDesc(tx.description) || "";
  const _self = isSelf(tx);

  const warnings = [];
  if (_self) warnings.push("É uma transferência entre suas contas — os dois lançamentos do par serão excluídos.");

  return h(Modal, { open: true, onClose: onCancel, title: "Excluir lançamento?", width: 440 },
    h("div", { style: { padding: 4 } },
      h("div", { style: { background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 6, padding: "10px 12px", marginBottom: 12 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 } },
          h("span", { style: { fontSize: 13, color: "var(--fg-0)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, desc),
          h("span", { className: "mono", style: { fontSize: 14, fontWeight: 700, color: tx.flow === "expense" ? "var(--neg)" : "var(--pos)", flexShrink: 0 } },
            (tx.flow === "expense" ? "−" : "+") + fmtBRL(tx.amount))
        ),
        h("div", { style: { fontSize: 11, color: "var(--fg-3)", marginTop: 2 } }, fmtDateBR(tx.date))
      ),
      warnings.map((w, i) => h("div", {
        key: i,
        style: { display: "flex", gap: 6, fontSize: 12, color: "var(--fg-1)", background: "var(--info-bg)", border: "1px solid color-mix(in oklch, var(--info) 30%, transparent)", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }
      }, h("span", null, "ⓘ"), h("span", null, w))),
      h("div", { style: { fontSize: 12, color: "var(--fg-2)", marginBottom: 14 } }, "Esta ação não pode ser desfeita."),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
        h("button", { className: "btn btn-ghost btn-sm", onClick: onCancel, autoFocus: true }, "Cancelar"),
        h("button", {
          className: "btn btn-sm",
          onClick: onConfirm,
          style: { background: "var(--neg)", color: "var(--fg-0)", border: "1px solid var(--neg)", minWidth: 90 }
        }, "Excluir")
      )
    )
  );
}

function MonthNav({ monthly, monthSel, onPick }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  if (!monthly.length || !monthSel) return null;
  const idx = monthly.findIndex(m => m.year === monthSel.year && m.month === monthSel.month);
  const now = new Date();
  const isCalCurrent = monthSel.year === now.getFullYear() && monthSel.month === now.getMonth() + 1;
  const isLatest = idx === monthly.length - 1;
  const pick = i => { const m = monthly[i]; if (m) onPick({ year: m.year, month: m.month }); };
  return h("div", { className: "month-nav", role: "group", "aria-label": "Mês analisado" },
    h("button", { className: "month-nav-btn", disabled: idx <= 0, onClick: () => pick(idx - 1), title: "Mês anterior", "aria-label": "Mês anterior" }, "‹"),
    h("span", { className: "month-nav-label" },
      `${PT_MONTHS[monthSel.month]} ${monthSel.year}`,
      isCalCurrent && h("span", { style: { marginLeft: 6, fontSize: 9, fontWeight: 700, color: "var(--info)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "atual")),
    h("button", { className: "month-nav-btn", disabled: idx < 0 || isLatest, onClick: () => pick(idx + 1), title: "Próximo mês", "aria-label": "Próximo mês" }, "›"),
    !isLatest && h("button", { className: "month-nav-today", onClick: () => pick(monthly.length - 1) }, "Hoje")
  );
}

function App() {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  useAppInit();
  const [editTx, setEditTx] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [monthly, setMonthly] = useState([]);
  const [monthSel, setMonthSel] = useState(null);
  const { push, Toaster } = useToasts();

  useEffect(() => {
    fetchMonthlyFull().then(data => {
      setMonthly(data);
      setMonthSel(prev => {
        if (prev && data.some(m => m.year === prev.year && m.month === prev.month)) return prev;
        const last = data[data.length - 1];
        return last ? { year: last.year, month: last.month } : null;
      });
    }).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    fetchAccounts().then(accs => {
      window.BS.accountNames = Object.fromEntries(accs.map(a => [a.id, a.name]));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let es, debounce;
    function connect() {
      es = new EventSource("/api/events");
      es.onmessage = e => {
        if (e.data === "connected") return;
        if (e.data === "update") {
          clearTimeout(debounce);
          debounce = setTimeout(() => setRefreshKey(k => k + 1), 300);
        }
      };
      es.onerror = () => setTimeout(connect, 5000);
    }
    connect();
    return () => { clearTimeout(debounce); es?.close(); };
  }, []);

  useEffect(() => { window.BS.juice.boot(document.getElementById("app")); }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "i" || e.key === "I") setImportOpen(true);
      if (e.key === "c" || e.key === "C") setCategoriesOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, []);

  async function handleDeleteTx(id) {
    try {
      const res = await deleteTransaction(id);
      setRefreshKey(k => k + 1);
      const n = res?.deleted || 1;
      push(n > 1 ? `${n} lançamentos excluídos` : "Lançamento excluído", "success", {
        label: "Desfazer",
        onClick: async () => {
          if (res?.restore) {
             await restoreTransactions(res.restore);
             setRefreshKey(k => k + 1);
             push("Lançamento restaurado com sucesso.", "info");
          }
        }
      });
    } catch (e) {
      push(e.message || "Erro ao excluir lançamento.", "error");
    }
  }

  return h("div", { id: "app", style: { height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-0)" } },

    h("header", { className: "v3-topbar", style: { display: "flex", gap: 12, alignItems: "center" } },
      h(BrokerSharkLogo, { size: 24 }),
      h(MonthNav, { monthly, monthSel, onPick: setMonthSel }),
      h("div", { style: { flex: 1 } }),
      h("button", { className: "btn btn-primary", style: { height: 30, padding: "0 12px", gap: 6 }, onClick: () => setImportOpen(true) },
        h(window.BS.IconImport, { size: 14 }), "Importar"
      ),
      h("button", { className: "btn btn-ghost", style: { height: 30, padding: "0 12px", gap: 6 }, onClick: () => setCategoriesOpen(true) },
        h(window.BS.IconSettings, { size: 14 }), "Categorias"
      ),
    ),

    h(DashboardView, {
      monthSel, monthly, onPickMonth: setMonthSel, refreshKey,
      onEditCategory: setEditTx,
      onImport: () => setImportOpen(true),
    }),

    importOpen && h(ImportModal, {
      onClose: () => setImportOpen(false),
      onDone: (res) => {
        setImportOpen(false);
        const n = res?.inserted ?? 0;
        const msg = res?.kind === "b3"
          ? (n > 0 ? `${n} ${n === 1 ? "posição importada" : "posições importadas"}` : "Nenhuma posição encontrada")
          : (n > 0 ? `${n} ${n === 1 ? "lançamento importado" : "lançamentos importados"}` : "Nada novo para importar");

        const undo = (res?.kind === "tx" && res?.importBatchId && n > 0)
          ? {
              label: "Desfazer",
              onClick: async () => {
                try {
                  const r = await deleteImportBatch(res.importBatchId);
                  push(`Importação revertida (${r.deleted} ${r.deleted === 1 ? "lançamento" : "lançamentos"})`, "info");
                } catch (e) {
                  push(e.message || "Não foi possível reverter.", "error");
                }
                setRefreshKey(k => k + 1);
              },
            }
          : null;
        push(msg, n > 0 ? "success" : "info", undo);
        if (res?.kind === "tx" && n > 0) window.BS.juice.coinDrop();
        setRefreshKey(k => k + 1);
      },
    }),
    categoriesOpen && h(window.BS.Drawer, {
      open: categoriesOpen, onClose: () => setCategoriesOpen(false), width: 680
    }, h(window.BS.CategoriesPanel, { refreshKey, onRefresh: () => setRefreshKey(k => k + 1), onClose: () => setCategoriesOpen(false) })),

    h(window.BS.CategoryEditor, {
      tx: editTx, onClose: () => setEditTx(null),
      onSave: (result) => {
        if (result?.deleted) {
          setEditTx(null);
          setConfirmDelete(result._tx);
          return;
        }
        {
          const parts = [];
          if (result?.category) parts.push(`Categoria: ${result.category}`);
          if ("display_name" in (result || {})) parts.push(result.display_name ? `Nome: ${result.display_name}` : "Nome fantasia removido");
          if ("is_third_party" in (result || {})) parts.push(result.is_third_party ? "Excluído dos gastos" : "Incluído nos gastos");
          push(parts.length ? parts.join(" · ") : "Salvo", "success");
          setRefreshKey(k => k + 1);
        }
        setEditTx(null);
      }
    }),

    confirmDelete && h(ConfirmDeleteModal, {
      tx: confirmDelete,
      onCancel: () => setConfirmDelete(null),
      onConfirm: () => { const id = confirmDelete.id; setConfirmDelete(null); handleDeleteTx(id); },
    }),

    Toaster()
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));

})();
