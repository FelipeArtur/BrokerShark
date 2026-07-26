(function () {

const { useState: _acSt, useEffect: _acEf } = React;

const BANK_PRESETS = ["nubank", "inter", "c6", "itau", "bradesco", "santander", "bb", "caixa"];

function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

function AccountsPanel({ onRefresh, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const { fmtBRL, fmtDateBR } = window.BS;

  const [accounts, setAccounts] = _acSt([]);
  const [err, setErr] = _acSt("");
  const [busy, setBusy] = _acSt(false);
  const [creating, setCreating] = _acSt(false);
  const [editingId, setEditingId] = _acSt(null);
  const [editName, setEditName] = _acSt("");
  const [closeTarget, setCloseTarget] = _acSt(null);
  const [closeDate, setCloseDate] = _acSt("");
  const [form, setForm] = _acSt({ bank: "", name: "", type: "checking", initial: "" });

  const reload = () => fetchAllAccounts().then(setAccounts).catch(e => setErr(e.message));
  _acEf(() => { reload(); }, []);

  function refreshAll() {
    reload();
    onRefresh && onRefresh();
  }

  async function run(fn) {
    setBusy(true); setErr("");
    try { await fn(); refreshAll(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const bank = form.bank.trim();
    const name = form.name.trim();
    if (!bank || !name) return;
    const cents = form.initial === "" ? 0 : Math.round(parseFloat(String(form.initial).replace(",", ".")) * 100);
    if (!Number.isFinite(cents)) { setErr("Saldo inicial inválido."); return; }
    await run(async () => {
      await postAccount({
        id: slugify(`${bank}-${form.type === "checking" ? "db" : "cc"}`),
        bank, name, type: form.type, initial_balance_cents: cents,
      });
      setForm({ bank: "", name: "", type: "checking", initial: "" });
      setCreating(false);
    });
  }

  async function commitRename(acc) {
    const name = editName.trim();
    setEditingId(null);
    if (name && name !== acc.name) await run(() => patchAccount(acc.id, { name }));
  }

  const abertas = accounts.filter(a => !a.closed_at);
  const encerradas = accounts.filter(a => a.closed_at);
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  function row(acc) {
    const fechada = !!acc.closed_at;
    return h("div", {
      key: acc.id, className: "cat-row",
      style: fechada ? { opacity: 0.6 } : null,
    },
      h("div", { className: "px-swatch", style: { background: window.BS.bankColor(acc.bank, acc.id) } }),

      editingId === acc.id
        ? h("input", {
            className: "px-field", autoFocus: true, value: editName,
            onChange: e => setEditName(e.target.value),
            onKeyDown: e => {
              if (e.key === "Escape") setEditingId(null);
              if (e.key === "Enter") commitRename(acc);
            },
            onBlur: () => commitRename(acc),
            style: { flex: 1 },
          })
        : h("button", {
            className: "cat-name",
            onClick: () => { setEditingId(acc.id); setEditName(acc.name); },
            title: "Clique para renomear",
          },
            acc.name,
            h("span", { style: { marginLeft: 8, fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.05em" } },
              acc.type === "checking" ? "conta" : "cartão"),
          ),

      h("span", { className: "cat-count mono" },
        fechada
          ? `encerrada em ${fmtDateBR(acc.closed_at)}`
          : fmtBRL(acc.balance || 0)),

      editingId !== acc.id && h("div", { className: "cat-actions" },
        fechada
          ? h("button", {
              className: "px-btn px-btn--ghost px-btn--sm", disabled: busy,
              title: "Reabrir conta", "aria-label": "Reabrir conta",
              onClick: () => run(() => patchAccount(acc.id, { closed_at: null })),
            }, "↺")
          : h("button", {
              className: "px-btn px-btn--ghost px-btn--sm", disabled: busy,
              title: "Encerrar conta (mantém o histórico)", "aria-label": "Encerrar conta",
              onClick: () => { setCloseTarget(acc); setCloseDate(hojeIso); setErr(""); },
            }, "⏻"),
        h("button", {
          className: "px-btn px-btn--ghost px-btn--sm cat-del", disabled: busy,
          title: "Apagar — só funciona em conta sem nenhum lançamento",
          "aria-label": "Apagar conta",
          onClick: () => run(() => deleteAccount(acc.id)),
        }, "×"),
      ),
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" } },

    h("div", { style: { padding: "20px 28px", borderBottom: "1px solid var(--line-1)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 } },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("h2", { style: { margin: 0, fontFamily: "var(--ff-sans)", fontSize: 15, letterSpacing: "1px", textTransform: "uppercase", color: "var(--fg-0)" } }, "Contas"),
        onClose && h("button", { className: "px-btn px-btn--ghost px-btn--sm", onClick: onClose, title: "Fechar (Esc)", "aria-label": "Fechar" }, "✕"),
      ),

      h("p", { style: { margin: 0, fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5 } },
        "Encerrar tira a conta do ", h("strong", null, "disponível"),
        " e das opções de import, mas o histórico dela fica inteiro — os meses passados continuam contando o que ela movimentou."),

      creating
        ? h("form", { onSubmit: handleCreate, style: { display: "flex", flexDirection: "column", gap: 8 } },
            h("div", { style: { display: "flex", gap: 8 } },
              h("input", {
                className: "px-field", list: "bs-bank-presets", placeholder: "Banco (ex: c6)",
                value: form.bank, onChange: e => setForm({ ...form, bank: e.target.value }),
                style: { flex: 1 }, autoFocus: true,
              }),
              h("datalist", { id: "bs-bank-presets" },
                BANK_PRESETS.map(b => h("option", { key: b, value: b }))),
              h("input", {
                className: "px-field", placeholder: "Nome (ex: C6 Conta)",
                value: form.name, onChange: e => setForm({ ...form, name: e.target.value }),
                style: { flex: 1.4 },
              }),
            ),
            h("div", { style: { display: "flex", gap: 8 } },
              h(window.BS.SegmentControl, {
                options: [{ value: "checking", label: "Conta" }, { value: "credit_card", label: "Cartão" }],
                value: form.type, onChange: v => setForm({ ...form, type: v }), columns: 2, fill: true,
              }),
              h("input", {
                className: "px-field mono", placeholder: "Saldo inicial (opcional)", inputMode: "decimal",
                value: form.initial, onChange: e => setForm({ ...form, initial: e.target.value }),
                style: { flex: 1 },
              }),
            ),
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
              h("button", { className: "px-btn", type: "button", onClick: () => { setCreating(false); setErr(""); } }, "CANCELAR"),
              h("button", {
                className: "px-btn px-btn--primary", type: "submit",
                disabled: busy || !form.bank.trim() || !form.name.trim(),
              }, busy ? "CRIANDO…" : "CRIAR CONTA"),
            ),
          )
        : h("button", {
            className: "px-btn px-btn--primary", onClick: () => { setCreating(true); setErr(""); },
          }, "+ NOVA CONTA"),

      err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
    ),

    h("div", { style: { flex: 1, overflowY: "auto" } },
      h("div", { className: "px-list", style: { padding: "0 12px" } }, abertas.map(row)),

      encerradas.length > 0 && h(React.Fragment, null,
        h("div", { style: { padding: "16px 18px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--fg-3)", fontFamily: "var(--ff-sans)" } },
          "Encerradas — histórico preservado"),
        h("div", { className: "px-list", style: { padding: "0 12px" } }, encerradas.map(row)),
      ),
    ),

    h(window.BS.Modal, {
      open: !!closeTarget, onClose: () => setCloseTarget(null),
      title: "Encerrar conta", width: 420,
    },
      closeTarget && h("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
        h("p", { style: { fontSize: 14, color: "var(--fg-0)", margin: 0, lineHeight: 1.5 } },
          "Encerrar ", h("strong", null, closeTarget.name), "? O saldo de ",
          h("span", { className: "mono" }, fmtBRL(closeTarget.balance || 0)),
          " sai do disponível — é dinheiro que não está mais lá."),
        h("p", { style: { fontSize: 12, color: "var(--fg-2)", margin: 0, lineHeight: 1.5 } },
          "Nenhum lançamento é apagado. A conta some dos widgets e das opções de import, e volta a qualquer momento pelo botão de reabrir."),
        h("label", { style: { fontSize: 11, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 } },
          "Data do encerramento",
          h("input", {
            className: "px-field mono", type: "date", value: closeDate,
            onChange: e => setCloseDate(e.target.value),
            style: { width: "100%", marginTop: 6 },
          }),
        ),
        h("p", { style: { fontSize: 11, color: "var(--fg-3)", margin: 0, lineHeight: 1.4 } },
          "Precisa ser igual ou posterior ao último lançamento da conta."),
        h("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end" } },
          h("button", { className: "px-btn", onClick: () => setCloseTarget(null) }, "CANCELAR"),
          h("button", {
            className: "px-btn px-btn--danger", disabled: busy || !closeDate,
            onClick: async () => {
              const acc = closeTarget;
              setBusy(true); setErr("");
              try {
                await patchAccount(acc.id, { closed_at: closeDate });
                setCloseTarget(null);
                refreshAll();
              } catch (ex) { setErr(ex.message); }
              finally { setBusy(false); }
            },
          }, busy ? "ENCERRANDO…" : "ENCERRAR"),
        ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
      ),
    ),
  );
}

window.BS = window.BS || {};
window.BS.AccountsPanel = AccountsPanel;

})();
