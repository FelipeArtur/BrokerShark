(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  fmtBRL, fmtDateBR, Modal, useToasts, BankChip, BrokerSharkLogo,
  PT_MONTHS, PT_SHORT,
  DashboardView,
  CategoriesPanel,
  ImportModal,
  isSelf, isInvest,
} = window.BS;

function ConfirmDeleteModal({ tx, onCancel, onConfirm }) {
  const desc = tx.display_name || window.BS.prettifyDesc(tx.description) || "";
  const _self = isSelf(tx);

  const warnings = [];
  if (_self) warnings.push("É uma transferência entre suas contas — os dois lançamentos do par serão excluídos.");

  return h(Modal, { open: true, onClose: onCancel, title: "Excluir lançamento?", width: 440 },
    h("div", { style: { padding: 4 } },
      h("div", { style: { background: "var(--bg-2)", border: "1px solid var(--line-1)", padding: "10px 12px", marginBottom: 12 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 } },
          h("span", { style: { fontSize: 13, color: "var(--fg-0)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, desc),
          h("span", { className: "mono", style: { fontSize: 14, fontWeight: 700, color: tx.flow === "expense" ? "var(--neg)" : "var(--pos)", flexShrink: 0 } },
            (tx.flow === "expense" ? "−" : "+") + fmtBRL(tx.amount))
        ),
        h("div", { style: { fontSize: 11, color: "var(--fg-3)", marginTop: 2 } }, fmtDateBR(tx.date))
      ),
      warnings.map((w, i) => h("div", {
        key: i,
        style: { display: "flex", gap: 6, fontSize: 12, color: "var(--fg-1)", background: "var(--info-bg)", border: "1px solid color-mix(in oklch, var(--info) 30%, transparent)", padding: "8px 10px", marginBottom: 8 }
      }, h("span", null, "ⓘ"), h("span", null, w))),
      h("div", { style: { fontSize: 12, color: "var(--fg-2)", marginBottom: 14 } }, "Esta ação não pode ser desfeita."),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
        h("button", { className: "px-btn px-btn--ghost px-btn--sm", onClick: onCancel, autoFocus: true }, "Cancelar"),
        h("button", {
          className: "px-btn px-btn--danger px-btn--sm",
          onClick: onConfirm,
          style: { minWidth: 90 }
        }, "Excluir")
      )
    )
  );
}

function MonthNav({ monthly, monthSel, onPick }) {
  if (!monthly.length || !monthSel) return null;
  const idx = monthly.findIndex(m => m.year === monthSel.year && m.month === monthSel.month);
  const now = new Date();
  const isCalCurrent = monthSel.year === now.getFullYear() && monthSel.month === now.getMonth() + 1;
  const isLatest = idx === monthly.length - 1;
  const pick = i => { const m = monthly[i]; if (m) onPick({ year: m.year, month: m.month }); };
  const jump = d => pick(window.BS.jumpYearIndex(monthly, monthSel, d));
  const canJump = d => window.BS.canJumpYear(monthly, monthSel, d);

  return h("div", { className: "month-nav", role: "group", "aria-label": "Mês analisado" },
    h("button", { className: "month-nav-btn", disabled: !canJump(-1), onClick: () => jump(-1), title: "Um ano atrás", "aria-label": "Um ano atrás" }, "«"),
    h("button", { className: "month-nav-btn", disabled: idx <= 0, onClick: () => pick(idx - 1), title: "Mês anterior", "aria-label": "Mês anterior" }, "‹"),
    h("span", { className: "month-nav-label" },
      `${PT_MONTHS[monthSel.month]} ${monthSel.year}`,
      isCalCurrent && h("span", { style: { marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--info)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "atual")),
    h("button", { className: "month-nav-btn", disabled: idx < 0 || isLatest, onClick: () => pick(idx + 1), title: "Próximo mês", "aria-label": "Próximo mês" }, "›"),
    h("button", { className: "month-nav-btn", disabled: !canJump(+1), onClick: () => jump(+1), title: "Um ano à frente", "aria-label": "Um ano à frente" }, "»"),
    !isLatest && h("button", { className: "month-nav-today", onClick: () => pick(monthly.length - 1) }, "Hoje")
  );
}

// Estado do ledger na barra superior: até onde os dados vão e quando foi o
// último backup. Moravam no widget do mês, que é sobre dinheiro — e ali
// competiam com os números por atenção sem nunca mudar de mês pra mês. Aqui são
// dois chips de canto: verde some da consciência, âmbar chama.
function LedgerHud({ status }) {
  if (!status) return null;

  const dias = status.exists ? Math.floor((status.age_seconds || 0) / 86400) : null;
  const backup = !status.exists
    ? { tone: "var(--warn)", text: "sem backup", title: "Nenhum snapshot na pasta de backup." }
    : dias > 40
      ? { tone: "var(--warn)", text: `backup há ${dias} dias`, title: status.name }
      : { tone: "var(--pos)", text: "backup em dia", title: `${status.name} · ${dias <= 0 ? "hoje" : dias === 1 ? "ontem" : `há ${dias} dias`}` };

  const chip = (tone, text, title) => h("span", { className: "hud-chip", title },
    h("span", { className: "hud-led", style: { background: tone } }),
    text);

  return h("div", { className: "hud" },
    status.last_tx_date && chip("var(--fg-faint)",
      `dados até ${fmtDateBR(status.last_tx_date)}`,
      "Data do lançamento mais recente no ledger."),
    chip(backup.tone, backup.text, backup.title),
  );
}

function App() {
  const [editTx, setEditTx] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [monthly, setMonthly] = useState([]);
  const [monthSel, setMonthSel] = useState(null);
  const [ledgerStatus, setLedgerStatus] = useState(null);
  //> As cores vivem fora do React (domain/bank.js): este tick repinta quando chegam.
  const [, setColorTick] = useState(0);
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
      const colors = Object.fromEntries(
        accs.filter(a => a.bank_color).map(a => [a.bank, a.bank_color])
      );
      window.BS.setBankColors(colors);
      if (Object.keys(colors).length) setColorTick(t => t + 1);
    }).catch(() => {});
  }, [refreshKey]);

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

  useEffect(() => {
    fetchBackupStatus().then(setLedgerStatus).catch(() => {});
  }, [refreshKey]);

  //> O chip informa quem olha; o toast alcança quem não olhou.
  const backupWarned = useRef(false);
  useEffect(() => {
    if (!ledgerStatus || backupWarned.current) return;
    const dias = Math.floor((ledgerStatus.age_seconds || 0) / 86400);
    if (!ledgerStatus.exists) {
      backupWarned.current = true;
      push("Nenhum backup encontrado. Seu ledger existe num arquivo só.", "error");
    } else if (dias > 40) {
      backupWarned.current = true;
      push(`Último backup há ${dias} dias.`, "info");
    }
  }, [ledgerStatus, push]);

  useEffect(() => { window.BS.juice.boot(document.getElementById("app")); }, []);

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
      h(LedgerHud, { status: ledgerStatus }),
      h("button", { className: "px-btn px-btn--primary", onClick: () => setImportOpen(true) },
        h(window.BS.IconImport, { size: 14 }), "Importar"
      ),
    ),

    h(DashboardView, {
      monthSel, monthly, onPickMonth: setMonthSel, refreshKey,
      onEditCategory: setEditTx,
      onImport: () => setImportOpen(true),
      onManageCategories: () => setCategoriesOpen(true),
      onManageAccounts: () => setAccountsOpen(true),
      onOpenPosition: (ids, name) => setPosition({ ids, name }),
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
    categoriesOpen && h(window.BS.CategoriesPanel, {
      refreshKey, onRefresh: () => setRefreshKey(k => k + 1), onClose: () => setCategoriesOpen(false),
    }),

    position && h(window.BS.Overlay, {
      open: true, onClose: () => setPosition(null), width: 1080
    }, h(window.BS.InvestmentPanel, { ids: position.ids, title: position.name, onClose: () => setPosition(null) })),

    accountsOpen && h(window.BS.AccountsPanel, {
      onRefresh: () => setRefreshKey(k => k + 1), onClose: () => setAccountsOpen(false),
    }),

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
          if ("is_third_party" in (result || {})) parts.push(result.is_third_party ? "Marcado em nome de terceiros" : "De volta aos seus totais");
          if ("recurring" in (result || {})) parts.push(result.recurring ? "Marcado como recorrente" : "Não é mais recorrente");
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
