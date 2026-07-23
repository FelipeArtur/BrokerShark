/* IIFE-wrapped */
(function () {
/**
 * @file import.js
 * @brief ImportModal (drop → detect → preview editável → confirm) e a célula
 *        editável do preview. Extratos CSV por conta + relatório B3 xlsx.
 */
/* modal-import.js — Modal de importação e célula editável */

const { useState, useEffect, useRef } = React;

/**
 * @brief Renderiza um valor que vira input ao clicar, com commit no blur/Enter.
 * @param props.value valor atual — em REAIS quando kind="amount"
 * @param props.kind "amount" (teclado decimal, fonte mono) ou "text"
 * @param props.render formata o valor no modo leitura
 * @param props.onCommit grava o rascunho; só é chamado se o valor mudou
 * @param props.onError recebe a mensagem quando onCommit rejeita
 * @param props.align alinhamento do texto (padrão "left")
 * @param props.color cor do texto no modo leitura
 * @return elemento React — <input> editando, <span> caso contrário
 */
function EditableCell({ value, kind, render, onCommit, onError, align = "left", color }) {
  const h = React.createElement;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  /** @brief Entra no modo edição, semeando o rascunho com o valor atual. */
  function start() { setDraft(value == null ? "" : String(value)); setEditing(true); }
  /**
   * @brief Sai do modo edição e grava o rascunho, se ele mudou.
   */
  async function commit() {
    setEditing(false);
    const same = String(draft) === String(value == null ? "" : value);
    if (same) return;
    setSaving(true);
    try {
      await onCommit(draft);
      setFlash(true); setTimeout(() => setFlash(false), 600);
    } catch (e) {
      if (onError) onError(e.message || "não salvou");
    } finally { setSaving(false); }
  }

  if (editing) {
    return h("input", {
      ref: inputRef, value: draft,
      onChange: e => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: e => {
        if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
      },
      inputMode: kind === "amount" ? "decimal" : "text",
      "aria-label": kind === "amount" ? "Editar valor" : "Editar apelido",
      style: {
        width: "100%", boxSizing: "border-box", font: "inherit",
        textAlign: align, color: "var(--fg-0)", background: "var(--bg-2)",
        border: "1px solid var(--pos)", padding: "1px 5px",
        fontFamily: kind === "amount" ? "var(--ff-mono)" : "inherit",
      },
    });
  }
  return h("span", {
    tabIndex: 0, role: "button", title: "Clique para editar",
    onClick: start,
    onKeyDown: e => { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); start(); } },
    onFocus: e => { e.currentTarget.style.borderBottomColor = "var(--line-2)"; },
    onBlur: e => { e.currentTarget.style.borderBottomColor = "transparent"; },
    onMouseEnter: e => { e.currentTarget.style.borderBottomColor = "var(--line-2)"; },
    onMouseLeave: e => { e.currentTarget.style.borderBottomColor = "transparent"; },
    style: {
      cursor: "text", display: "inline-block", maxWidth: "100%",
      color: color || "var(--fg-1)", outline: "none", borderBottom: "1px dashed transparent",
      background: flash ? "color-mix(in oklch, var(--pos) 20%, transparent)" : "transparent",
      transition: "background 0.4s",
      fontFamily: kind === "amount" ? "var(--ff-mono)" : "inherit",
    },
  }, saving ? "…" : render(value));
}

/**
 * @brief Lê um valor digitado à mão no preview, em pt-BR ou en-US.
 * @param raw texto do input ("R$ 1.234,56", "1234.56"); com vírgula, o ponto é
 *        separador de milhar
 * @return valor em REAIS arredondado ao centavo, ou null se não for um número
 *         positivo — o ledger não aceita valor negativo (o sinal é o `flow`)
 */
function _parseAmountInput(raw) {
  let s = String(raw).trim().replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return (isFinite(n) && n > 0) ? Math.round(n * 100) / 100 : null;
}

/**
 * @brief Renderiza o modal de importação incremental (extratos CSV + B3 xlsx).
 * @param props.onClose fecha o modal sem importar
 * @param props.onDone chamado no sucesso com {inserted, kind, importBatchId, b3};
 *        `importBatchId` é o id de sessão que permite reverter o lote inteiro
 * @return elemento React do modal
 */
function ImportModal({ onClose, onDone }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const { Modal, BankChip, isSelf, isInvest, fmtDateBR, fmtBRL, fmtBRLCompact, IconImport } = window.BS;
  const names = (window.BS && window.BS.accountNames) || {};
  const BANKS = [
    { id: "nu-db",    label: names["nu-db"]    || "Nubank" },
    { id: "inter-db", label: names["inter-db"] || "Inter" },
  ];
  /**
   * @brief Devolve o nome legível de uma conta.
   * @param id account_id ("nu-db"/"inter-db")
   * @return rótulo da conta, ou o próprio id quando desconhecida
   */
  const accLabel = id => (BANKS.find(b => b.id === id) || {}).label || id;
  /**
   * @brief Gera um id único para arquivo solto ou sessão de import.
   * @return uuid v4 do browser, ou um id de fallback baseado em tempo + aleatório
   */
  const uuid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "imp-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  /**
   * @brief Dispara um toast global.
   * @param msg texto exibido
   * @param kind "error" (padrão), "success" ou "info"
   */
  const toast = (msg, kind = "error") =>
    window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg, kind } }));

  const [files, setFiles]         = useState([]);
  const [groups, setGroups]       = useState(null);
  const [b3s, setB3s]             = useState([]);
  const [faturas, setFaturas]     = useState([]);
  const [dueDates, setDueDates]   = useState({}); // key → dd/mm/aaaa digitado
  const [rowsByGroup, setRowsByGroup] = useState({});
  const [excluded, setExcluded]   = useState(() => new Set());
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState(null);
  const [results, setResults]     = useState(null);
  const [cats, setCats]           = useState({ expense: [], income: [] });
  const triedRef = useRef("");

  /** @brief Converte dd/mm/aaaa em ISO (YYYY-MM-DD), ou null se não casar. */
  const brToIso = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };

  const step = (groups || b3s.length || faturas.length) ? 2 : 1;

  /**
   * @brief Aceita os arquivos soltos e dispara a detecção de conta dos CSVs.
   * @param fileList FileList do drop ou do <input type=file>; só .csv (extrato)
   *        e .xlsx (relatório B3) entram — o resto vira erro na tela
   */
  function addFiles(fileList) {
    setErr(null);
    const incoming = Array.from(fileList || []).map(f => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ext !== "csv" && ext !== "xlsx") return null;
      return { key: uuid(), file: f, account: null, b3: ext === "xlsx", detecting: ext === "csv" };
    }).filter(Boolean);
    if (!incoming.length) { setErr("Envie .csv (extratos) ou .xlsx (relatório B3)."); return; }
    setFiles(prev => [...prev, ...incoming]);
    incoming.filter(f => !f.b3).forEach(f => {
      window.importDetect(f.file).then(acc => {
        setFiles(prev => prev.map(x => x.key === f.key
          ? (acc === "inter-cc"
              // Fatura Inter (inter-cc) é um terceiro tipo: fluxo próprio + due_date.
              ? { ...x, account: "inter-cc", fatura: true, auto: true, detecting: false }
              : { ...x, account: acc || x.account, auto: !!acc, detecting: false })
          : x));
      });
    });
  }
  /**
   * @brief Tira um arquivo da lista.
   * @param key chave local do arquivo
   */
  const removeFile = key => setFiles(prev => prev.filter(f => f.key !== key));
  /**
   * @brief Atribui a conta de um arquivo à mão (derruba a marca "auto").
   * @param key chave local do arquivo
   * @param account account_id escolhido, ou null pra limpar
   */
  const setFileAccount = (key, account) =>
    setFiles(prev => prev.map(f => f.key === key ? { ...f, account, auto: false, detecting: false } : f));

  const canAnalyze = files.length > 0 && !busy && files.every(f => f.b3 || f.account);

  /**
   * @brief Manda os arquivos ao backend e monta o preview (passo 2).
   *
   * Os CSVs vão agrupados POR CONTA num único POST: é assim que o backend
   * deduplica o conjunto todo (ver importPreview). Falha de uma conta ou de um
   * B3 não derruba as outras — o erro fica no card do grupo.
   */
  async function analyze() {
    setBusy(true); setErr(null);
    try {
      const byAccount = {};
      files.filter(f => !f.b3 && !f.fatura).forEach(f => {
        (byAccount[f.account] = byAccount[f.account] || []).push(f.file);
      });
      const [txGroups, b3Previews, faturaPreviews] = await Promise.all([
        Promise.all(Object.keys(byAccount).map(async account => {
          try {
            const res = await window.importPreview(byAccount[account], account);
            return { account, ...res, err: null };
          } catch (e) {
            return { account, batch_id: null, counts: { new: 0, duplicate: 0, skipped: 0, total: 0 }, rows: [], amount_divergence: 0, err: e.message || "Falha ao analisar." };
          }
        })),
        Promise.all(files.filter(f => f.b3).map(async f => {
          try { return { key: f.key, file: f.file, preview: await window.importB3(f.file), err: null }; }
          catch (e) { return { key: f.key, file: f.file, preview: null, err: e.message || "Falha ao ler B3." }; }
        })),
        Promise.all(files.filter(f => f.fatura).map(async f => {
          try { return { key: f.key, file: f.file, preview: await window.importFaturaPreview(f.file), err: null }; }
          catch (e) { return { key: f.key, file: f.file, preview: null, err: e.message || "Falha ao ler fatura." }; }
        })),
      ]);
      const rmap = {};
      txGroups.forEach(g => { rmap[g.account] = g.rows || []; });
      setRowsByGroup(rmap);
      setExcluded(new Set());
      setGroups(txGroups.length ? txGroups : null);
      setB3s(b3Previews);
      setFaturas(faturaPreviews);
      if (!txGroups.length && !b3Previews.length && !faturaPreviews.length) setErr("Nada para importar.");
    } catch (e) { setErr(e.message || "Falha ao analisar."); }
    finally { setBusy(false); }
  }

  const _fileSig = files.map(f => `${f.key}:${f.account || ""}:${f.b3 ? "b3" : ""}:${f.fatura ? "fat" : ""}`).sort().join("|");
  useEffect(() => {
    if (step === 2 || busy || results) return;
    if (!files.length) return;
    if (files.some(f => !f.b3 && f.detecting)) return;
    if (!files.every(f => f.b3 || f.account)) return;
    if (triedRef.current === _fileSig) return;
    triedRef.current = _fileSig;
    analyze();
  }, [_fileSig, files, busy, step, results]);

  useEffect(() => {
    if (step !== 2) return;
    if (cats.expense.length || cats.income.length) return;
    Promise.all([window.fetchCategoriesFull("expense"), window.fetchCategoriesFull("income")])
      .then(([e, i]) => setCats({ expense: e || [], income: i || [] }))
      .catch(() => {});
  }, [step]);

  /**
   * @brief Inclui/exclui uma linha do preview na importação.
   * @param id id da linha em staging
   */
  function toggle(id) {
    setExcluded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  /**
   * @brief Inclui ou exclui todas as linhas NOVAS de uma conta de uma vez.
   * @param account account_id do grupo
   * @param include true marca todas; false desmarca todas
   */
  function setGroupAll(account, include) {
    const ids = (rowsByGroup[account] || []).filter(r => r.status === "new").map(r => r.id);
    setExcluded(prev => {
      const n = new Set(prev);
      ids.forEach(id => include ? n.delete(id) : n.add(id));
      return n;
    });
  }

  /**
   * @brief Edita uma linha do staging e reflete a resposta no preview.
   * @param account account_id do grupo dono da linha
   * @param batchId batch_id do preview daquela conta
   * @param rowId id da linha em staging
   * @param fields campos a alterar — `amount` em REAIS, category_id, display_name
   * @return Promise que rejeita quando o backend recusa (o caller mostra o toast)
   */
  async function editRow(account, batchId, rowId, fields) {
    const res = await window.patchStagingRow(batchId, rowId, fields);
    setRowsByGroup(prev => ({
      ...prev,
      [account]: (prev[account] || []).map(r => r.id === rowId ? { ...r, ...res.row } : r),
    }));
    setGroups(prev => (prev || []).map(g =>
      g.account === account ? { ...g, amount_divergence: res.amount_divergence } : g));
  }

  /**
   * @brief Lista as linhas que serão de fato inseridas para uma conta.
   * @param account account_id do grupo
   * @return linhas com status "new" que não foram desmarcadas
   */
  function groupNew(account) {
    return (rowsByGroup[account] || []).filter(r => r.status === "new" && !excluded.has(r.id));
  }
  const txWillImport = (groups || []).reduce((s, g) => s + groupNew(g.account).length, 0);
  const b3Count = b3s.filter(b => b.preview && b.preview.total > 0).length;
  const faturaCount = faturas.filter(fa => fa.preview && !fa.preview.already_paid).length;

  /**
   * @brief Confirma a importação de todas as contas e relatórios B3 do drop.
   *
   * Antes de inserir, grava as sugestões de categoria que o usuário não trocou
   * (suggest-only: só viram categoria de verdade neste passo). Todas as contas
   * compartilham o MESMO id de sessão, pra que a importação reverta como um
   * bloco no Histórico. Se alguma conta falhar, mostra o resumo em vez de
   * fechar — o que entrou continua no ledger.
   */
  async function confirm() {
    const badDue = faturas.filter(fa => fa.preview && !fa.err && !fa.preview.already_paid)
      .find(fa => { const raw = dueDates[fa.key]; return raw && !brToIso(raw); });
    if (badDue) { setErr("Vencimento inválido — use dd/mm/aaaa."); return; }
    setBusy(true); setErr(null);
    const sessionId = uuid();
    let totalInserted = 0, b3Created = 0, b3Updated = 0;
    const status = [];
    try {
      await Promise.all((groups || []).filter(g => g.batch_id && !g.err).flatMap(g =>
        groupNew(g.account)
          .filter(r => r.category_id == null && r.suggested_category_id != null)
          .map(r => window.patchStagingRow(g.batch_id, r.id, { category_id: r.suggested_category_id }).catch(() => {}))
      ));
      const txStatus = await Promise.all((groups || [])
        .filter(g => g.batch_id && !g.err)
        .map(async g => {
          const excl = (rowsByGroup[g.account] || []).filter(r => excluded.has(r.id)).map(r => r.id);
          try { const res = await window.importConfirm(g.batch_id, excl, sessionId); return { account: g.account, ok: true, inserted: res.inserted || 0 }; }
          catch (e) { return { account: g.account, ok: false, msg: e.message || "falhou" }; }
        }));
      const b3Status = await Promise.all(b3s
        .filter(b => b.preview && !b.err)
        .map(async b => {
          try { const res = await window.importB3(b.file, { confirm: true }); return { b3: true, created: res.created || 0, updated: res.updated || 0 }; }
          catch (e) { return { account: "b3", ok: false, msg: e.message || "falhou" }; }
        }));
      const faturaStatus = await Promise.all(faturas
        .filter(fa => fa.preview && !fa.err && !fa.preview.already_paid)
        .map(async fa => {
          try { const res = await window.importFaturaConfirm(fa.file, brToIso(dueDates[fa.key]), sessionId); return { fatura: true, inserted: res.inserted || 0 }; }
          catch (e) { return { account: "fatura", ok: false, msg: e.message || "falhou" }; }
        }));
      txStatus.forEach(s => { if (s.ok) totalInserted += s.inserted || 0; status.push(s); });
      b3Status.forEach(s => { if (s.b3) { b3Created += s.created; b3Updated += s.updated; } else status.push(s); });
      faturaStatus.forEach(s => { if (s.fatura) totalInserted += s.inserted || 0; else status.push(s); });
      if (status.some(s => !s.ok)) {
        setResults(status);
      } else {
        onDone({ inserted: totalInserted, kind: "tx", importBatchId: sessionId,
                 b3: { created: b3Created, updated: b3Updated } });
      }
    } catch (e) { setErr(e.message || "Falha ao confirmar."); }
    finally { setBusy(false); }
  }

  const DropZone = h("label", {
    className: "px-dropzone",
    style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--s-4)", cursor: busy ? "wait" : "pointer" },
    onDragOver: e => { e.preventDefault(); e.currentTarget.classList.add("px-dropzone--over"); },
    onDragLeave: e => { e.preventDefault(); e.currentTarget.classList.remove("px-dropzone--over"); },
    onDrop: e => { e.preventDefault(); e.currentTarget.classList.remove("px-dropzone--over"); addFiles(e.dataTransfer.files); },
  },
    h(IconImport, { size: 28 }),
    h("div", { style: { fontFamily: "var(--ff-sans)", fontSize: "var(--fz-6)", letterSpacing: "1px", color: "var(--fg-0)" } },
      "ARRASTE OS ARQUIVOS AQUI, OU CLIQUE PARA ESCOLHER"),
    h("div", { style: { fontSize: "var(--fz-8)", color: "var(--fg-3)" } }, "Extratos e faturas em .csv, ou relatórios B3 em .xlsx"),
    h("input", { type: "file", accept: ".csv,.xlsx,text/csv", multiple: true, style: { display: "none" },
      onChange: e => { addFiles(e.target.files); e.target.value = null; } })
  );

  const fileList = files.length > 0 && h("div", { className: "px-list", style: { marginTop: "var(--s-4)" } },
    files.map(f => h("div", { className: "px-row", key: f.key },
      h("div", { style: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 } },
        h("span", { style: { fontSize: "var(--fz-7)", fontWeight: 700, color: "var(--fg-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.file.name),
        h("span", { className: "mono", style: { color: "var(--fg-3)", fontSize: "var(--fz-9)" } }, `${(f.file.size / 1024).toFixed(1)} KB`)
      ),
      f.b3
        ? h("span", { className: "px-chip" }, "B3")
        : f.fatura
        ? h("span", { className: "px-chip", title: "fatura de cartão Inter (aberta)", style: { color: "var(--warn)" } }, "FATURA")
        : h("div", { style: { display: "flex", alignItems: "center", gap: "var(--s-4)" } },
            f.auto && h("span", { className: "px-chip", title: "conta detectada automaticamente — confira", style: { color: "var(--info)" } }, "AUTO"),
            h("select", {
              className: "px-field", value: f.account || "", onChange: e => setFileAccount(f.key, e.target.value || null),
              "aria-label": "Conta de origem",
            },
              h("option", { value: "" }, "Atribuir conta…"),
              BANKS.map(b => h("option", { key: b.id, value: b.id }, b.label))
            )
          ),
      h("button", { className: "px-btn px-btn--danger", onClick: () => removeFile(f.key), title: "Remover arquivo", "aria-label": "Remover arquivo" }, "×")
    ))
  );

  const detecting = files.some(f => !f.b3 && f.detecting);
  const needsAccount = files.length > 0 && !detecting && !canAnalyze;
  const step1View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: "var(--s-6)" } },
    h("div", { className: "label", style: { color: "var(--fg-2)" } }, "Solte os arquivos do mês — a conta é detectada e a revisão abre sozinha."),
    DropZone,
    fileList,
    err && h("div", { style: { color: "var(--neg)", fontSize: "var(--fz-8)", padding: "var(--s-4) var(--s-5)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", border: "2px solid var(--neg)" } }, err),
    (busy || detecting)
      ? h("div", { className: "label", style: { textAlign: "right", color: "var(--fg-2)" } }, busy ? "Analisando…" : "Detectando conta…")
      : err
        ? h("div", { style: { display: "flex", justifyContent: "flex-end" } },
            h("button", { className: "px-btn px-btn--primary", disabled: !canAnalyze, onClick: () => { triedRef.current = ""; analyze(); } }, "TENTAR DE NOVO"))
        : needsAccount
          ? h("div", { className: "label", style: { textAlign: "right", color: "var(--reserve)" } }, "Atribua a conta dos arquivos acima")
          : null
  );

  /**
   * @brief Diz como a linha do preview será classificada ao entrar no ledger.
   * @param r linha do staging (`amount` em REAIS)
   * @return {tag, color, categorizable} — transferência e investimento não são
   *         categorizáveis: não têm category_id (ver money.js)
   */
  const classifyRow = r => {
    if (isSelf(r))   return { tag: "transferência", color: "var(--info)", categorizable: false };
    if (isInvest(r)) return { tag: "investimento", color: "var(--reserve)", categorizable: false };
    if (r.method === "credit") return { tag: "crédito", color: "var(--warn)", categorizable: true };
    if (r.flow === "income") return { tag: "receita", color: "var(--pos)", categorizable: true };
    return { tag: "despesa", color: "var(--neg)", categorizable: true };
  };
  /**
   * @brief Devolve cor e sinal do valor de uma linha do preview.
   * @param r linha do staging
   * @return {color, sign} — sinal segue o `flow`, cor segue a espécie
   */
  const amtMeta = r => {
    const _self = isSelf(r);
    const _invest = isInvest(r);
    return {
      color: _self ? "var(--info)" : _invest ? "var(--reserve)" : (r.flow === "expense" ? "var(--neg)" : "var(--pos)"),
      sign: r.flow === "expense" ? "−" : "+",
    };
  };
  /**
   * @brief Monta o chip que anuncia a classificação da linha.
   * @param cls resultado de classifyRow
   * @return elemento React <span>
   */
  const TagChip = (cls) => h("span", {
    className: "px-chip",
    title: `Será classificado como ${cls.tag}`,
    style: { color: cls.color, borderColor: `color-mix(in oklch, ${cls.color} 45%, var(--line-1))` },
  }, cls.tag.toUpperCase());

  /**
   * @brief Monta o select de categoria de uma linha do preview.
   *
   * Com sugestão pendente, o select já a EXIBE mas `category_id` segue null —
   * quem grava é o confirm (suggest-only); o selo "sugerido" marca a diferença.
   *
   * @param g grupo (dá account e batch_id do PATCH)
   * @param r linha do staging
   * @return elemento React com o select e o selo de sugestão
   */
  const CategorySelect = (g, r) => {
    const list = cats[r.flow] || [];
    const showingSuggestion = r.category_id == null && r.suggested_category_id != null;
    const value = r.category_id != null ? String(r.category_id)
      : (showingSuggestion ? String(r.suggested_category_id) : "");
    return h("div", { style: { display: "flex", alignItems: "center", gap: "var(--s-3)", minWidth: 0 } },
      h("select", {
        className: "px-field", value,
        "aria-label": "Categoria",
        onChange: e => editRow(g.account, g.batch_id, r.id, { category_id: e.target.value ? parseInt(e.target.value) : null })
          .catch(() => toast("Não salvou a categoria")),
        style: {
          height: 22, maxWidth: 180, fontSize: "var(--fz-8)",
          borderColor: showingSuggestion ? "var(--accent)" : "var(--line-2)",
        },
      },
        h("option", { value: "" }, "Sem categoria"),
        list.map(c => h("option", { key: c.id, value: c.id }, c.name))
      ),
      showingSuggestion && h("span", {
        className: "px-chip",
        title: "Sugerido pelo histórico — confirme ou troque",
        style: { color: "var(--accent)" },
      }, "SUGERIDO")
    );
  };

  /**
   * @brief Renderiza o card de preview de uma conta.
   *
   * Só as linhas novas são listadas; as duplicadas ficam ocultas e viram
   * contagem. A "Ajuste de Saldo" aparece quando os valores editados divergem
   * do extrato original — editar valor é permitido, mas nunca silencioso.
   *
   * @param g grupo {account, batch_id, counts, rows, amount_divergence, err} —
   *        `amount_divergence` em REAIS
   * @return elemento React do card
   */
  const renderTxGroup = (g) => {
    const rows = rowsByGroup[g.account] || g.rows || [];
    const newRows = groupNew(g.account);
    const allNew = rows.filter(r => r.status === "new");
    const allIncluded = allNew.length > 0 && allNew.every(r => !excluded.has(r.id));
    const subtotal = newRows.reduce((s, r) => s + (r.flow === "expense" ? -r.amount : r.amount), 0);
    const div = g.amount_divergence || 0;
    return h("div", { key: g.account, style: { border: "2px solid var(--line-1)", boxShadow: "2px 2px 0 #05060d" } },
      h("div", { style: { padding: "var(--s-5) var(--s-6)", background: "var(--bg-1)", borderBottom: "2px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s-5)", flexWrap: "wrap" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: "var(--s-5)" } },
          h(BankChip, { accountId: g.account }),
          h("span", { className: "widget-title" }, accLabel(g.account))
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: "var(--s-5)", fontSize: "var(--fz-7)", color: "var(--fg-2)" } },
          allNew.length > 0 && h("button", { className: "px-btn", onClick: () => setGroupAll(g.account, !allIncluded) }, allIncluded ? "DESMARCAR" : "MARCAR TODAS"),
          h("span", { className: "px-chip" }, `${newRows.length} ${newRows.length === 1 ? "nova" : "novas"}`),
          g.counts.duplicate > 0 && h("span", { className: "px-chip", style: { color: "var(--fg-3)" } }, `${g.counts.duplicate} já importados`),
          h("span", { className: "mono", style: { fontSize: "var(--fz-5)", color: subtotal < 0 ? "var(--neg)" : "var(--pos)" } }, `${subtotal < 0 ? "−" : "+"}${fmtBRL(Math.abs(subtotal))}`)
        )
      ),
      g.err && h("div", { style: { padding: "var(--s-4) var(--s-6)", display: "flex", flexDirection: "column", gap: "var(--s-2)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } },
        h("div", { style: { fontSize: "var(--fz-7)", fontWeight: 700, color: "var(--neg)" } }, g.err),
        h("div", { style: { fontSize: "var(--fz-8)", color: "var(--fg-2)" } }, "Confira se a conta atribuída (Nubank/Inter) corresponde ao arquivo, ou se é mesmo um extrato desse banco.")),
      Math.abs(div) >= 0.01 && h("div", { style: { padding: "var(--s-4) var(--s-6)", fontSize: "var(--fz-7)", fontWeight: 600, color: "var(--reserve)", background: "color-mix(in oklch, var(--reserve) 12%, transparent)", borderBottom: "2px solid var(--line-1)" } },
        `Ajuste de Saldo: ${div > 0 ? "+" : "−"}${fmtBRL(Math.abs(div))} vs extrato original`),
      !g.err && (allNew.length === 0
        ? h("div", { className: "px-empty" },
            g.counts.duplicate > 0
              ? `TUDO JÁ IMPORTADO — ${g.counts.duplicate} LANÇAMENTO${g.counts.duplicate === 1 ? "" : "S"} JÁ CONSTA${g.counts.duplicate === 1 ? "" : "M"}, NADA NOVO`
              : "NADA NOVO NESTE ARQUIVO")
        : h("div", { style: { maxHeight: 320, overflowY: "auto", background: "var(--bg-0)" } },
            g.counts.duplicate > 0 && h("div", { style: { padding: "var(--s-3) var(--s-6)", fontSize: "var(--fz-8)", color: "var(--fg-3)", background: "var(--bg-1)", borderBottom: "1px dashed var(--line-2)" } },
              `${g.counts.duplicate} já importado${g.counts.duplicate === 1 ? "" : "s"} (ocultos) · ${allNew.length} novo${allNew.length === 1 ? "" : "s"} abaixo`),
            h("table", { style: { width: "100%", borderCollapse: "collapse" } },
              h("tbody", null, allNew.map((r, i) => {
                const checked = !excluded.has(r.id);
                const { color, sign } = amtMeta(r);
                const cls = classifyRow(r);
                return h("tr", { key: r.id, style: { borderBottom: i < allNew.length - 1 ? "1px solid var(--line-2)" : "none", opacity: checked ? 1 : 0.45, fontSize: "var(--fz-6)", transition: "background 0.1s" }, onMouseEnter: e => e.currentTarget.style.background = "var(--bg-1)", onMouseLeave: e => e.currentTarget.style.background = "transparent" },
                  h("td", { style: { padding: "var(--s-4)", width: 36, textAlign: "center" } },
                    h("input", { type: "checkbox", checked, onChange: () => toggle(r.id), "aria-label": "Incluir", style: { cursor: "pointer", accentColor: "var(--fg-0)" } })),
                  h("td", { className: "mono", style: { padding: "var(--s-4) 0", color: "var(--fg-3)", whiteSpace: "nowrap", fontSize: "var(--fz-8)" } }, fmtDateBR(r.date)),
                  h("td", { style: { padding: "var(--s-3) var(--s-6)", width: "100%" } },
                    h("div", { style: { display: "flex", alignItems: "center", gap: "var(--s-4)" } },
                      h("span", { style: { color: "var(--fg-0)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, window.BS.prettifyDesc(r.description)),
                      TagChip(cls)
                    ),
                    h("div", { style: { fontSize: "var(--fz-8)", color: "var(--fg-3)", marginTop: "var(--s-2)", display: "flex", gap: "var(--s-5)", alignItems: "center", flexWrap: "wrap" } },
                      cls.categorizable && CategorySelect(g, r),
                      h(EditableCell, {
                        value: r.display_name || "", kind: "text",
                        color: r.display_name ? "var(--info)" : "var(--fg-3)",
                        render: v => v || "+ apelido",
                        onCommit: v => editRow(g.account, g.batch_id, r.id, { display_name: v }),
                        onError: m => toast(m),
                      })
                    )
                  ),
                  h("td", { style: { padding: "var(--s-4) var(--s-6)", textAlign: "right", whiteSpace: "nowrap" } },
                    h(EditableCell, {
                      value: r.amount, kind: "amount", align: "right", color,
                      render: v => `${sign}${fmtBRL(v)}`,
                      onCommit: v => {
                        const n = _parseAmountInput(v);
                        if (n == null) throw new Error("Valor inválido");
                        return editRow(g.account, g.batch_id, r.id, { amount: n });
                      },
                      onError: m => toast(m),
                    }))
                );
              }))
            )
          )
      )
    );
  };

  /**
   * @brief Renderiza o card de preview de um relatório B3.
   * @param b {key, file, preview, err} — `preview.positions[].balance` em REAIS
   * @return elemento React do card, com as posições novas e as atualizadas
   */
  const renderB3 = (b) => h("div", { key: b.key, style: { border: "2px solid var(--line-1)", boxShadow: "2px 2px 0 #05060d" } },
    h("div", { style: { padding: "var(--s-5) var(--s-6)", background: "var(--bg-1)", borderBottom: "2px solid var(--line-1)", display: "flex", justifyContent: "space-between", fontSize: "var(--fz-7)", color: "var(--fg-2)" } },
      h("span", { className: "widget-title" }, "Relatório B3 — posições"),
      b.preview && h("span", { className: "mono" }, `${b.preview.created} novas · ${b.preview.updated} atualizadas`)),
    b.err && h("div", { style: { padding: "var(--s-4) var(--s-6)", fontSize: "var(--fz-7)", fontWeight: 600, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } }, b.err),
    b.preview && h("div", { style: { maxHeight: 280, overflowY: "auto", background: "var(--bg-0)" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse" } },
        h("tbody", null, b.preview.positions.map((p, i) => h("tr", { key: i, style: { borderBottom: i < b.preview.positions.length - 1 ? "1px solid var(--line-2)" : "none", fontSize: "var(--fz-6)", transition: "background 0.1s" }, onMouseEnter: e => e.currentTarget.style.background = "var(--bg-1)", onMouseLeave: e => e.currentTarget.style.background = "transparent" },
          h("td", { style: { padding: "var(--s-4) var(--s-6)", color: p.status === "new" ? "var(--pos)" : "var(--info)", fontWeight: 700, fontSize: "var(--fz-8)" } }, p.status === "new" ? "NOVA" : "ATUALIZA"),
          h("td", { style: { padding: "var(--s-4) var(--s-6)", color: "var(--fg-0)", width: "100%", fontWeight: 600 } }, p.name),
          h("td", { className: "mono", style: { padding: "var(--s-4) var(--s-6)", textAlign: "right", fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(p.balance))
        ))))
    )
  );

  /**
   * @brief Renderiza o card de preview de uma fatura Inter aberta.
   *
   * Mostra ref_month, total e os itens; um campo de vencimento (dd/mm/aaaa) que
   * ancora o abatimento do "Disponível" (P2). Reimport mescla; fatura já paga é
   * bloqueada.
   *
   * @param fa {key, file, preview, err} — `preview.total`/`rows[].amount` em REAIS
   * @return elemento React do card
   */
  const renderFatura = (fa) => {
    const p = fa.preview;
    const paid = p && p.already_paid;
    const rawDue = dueDates[fa.key] || "";
    const dueInvalid = rawDue && !brToIso(rawDue);
    return h("div", { key: fa.key, style: { border: "2px solid var(--warn)", boxShadow: "2px 2px 0 #05060d" } },
      h("div", { style: { padding: "var(--s-5) var(--s-6)", background: "var(--bg-1)", borderBottom: "2px solid var(--warn)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s-5)", flexWrap: "wrap" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: "var(--s-5)" } },
          h("span", { className: "px-chip", style: { color: "var(--warn)" } }, "FATURA"),
          h("span", { className: "widget-title" }, p ? `Fatura Inter — ${p.ref_month}` : "Fatura Inter")),
        p && h("span", { className: "mono", style: { fontSize: "var(--fz-5)", color: "var(--warn)" } }, `−${fmtBRL(p.total)}`)),
      fa.err && h("div", { style: { padding: "var(--s-4) var(--s-6)", fontSize: "var(--fz-7)", fontWeight: 600, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } }, fa.err),
      paid && h("div", { style: { padding: "var(--s-4) var(--s-6)", fontSize: "var(--fz-7)", fontWeight: 600, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } },
        "Essa fatura já foi paga/reconciliada — não dá pra reabrir."),
      p && !paid && p.reimport && h("div", { style: { padding: "var(--s-4) var(--s-6)", fontSize: "var(--fz-8)", color: "var(--info)", background: "color-mix(in oklch, var(--info) 10%, transparent)" } },
        "Reimport — vai mesclar com a fatura aberta existente (itens repetidos não duplicam)."),
      p && !paid && h("div", { style: { padding: "var(--s-4) var(--s-6)", display: "flex", alignItems: "center", gap: "var(--s-5)", flexWrap: "wrap", borderBottom: "1px dashed var(--line-2)" } },
        h("span", { className: "label", style: { color: "var(--fg-2)" } }, "Vencimento"),
        h("input", {
          className: "px-field", value: rawDue, placeholder: "dd/mm/aaaa", inputMode: "numeric",
          "aria-label": "Data de vencimento da fatura",
          onChange: e => setDueDates(prev => ({ ...prev, [fa.key]: e.target.value })),
          style: { width: 120, borderColor: dueInvalid ? "var(--neg)" : "var(--line-2)" },
        }),
        h("span", { style: { fontSize: "var(--fz-9)", color: dueInvalid ? "var(--neg)" : "var(--fg-3)" } },
          dueInvalid ? "formato dd/mm/aaaa" : "ancora o abatimento do Disponível")),
      p && !paid && h("div", { style: { maxHeight: 260, overflowY: "auto", background: "var(--bg-0)" } },
        h("table", { style: { width: "100%", borderCollapse: "collapse" } },
          h("tbody", null, p.rows.map((r, i) => h("tr", { key: i, style: { borderBottom: i < p.rows.length - 1 ? "1px solid var(--line-2)" : "none", fontSize: "var(--fz-6)" } },
            h("td", { className: "mono", style: { padding: "var(--s-4)", color: "var(--fg-3)", whiteSpace: "nowrap", fontSize: "var(--fz-8)" } }, fmtDateBR(r.date)),
            h("td", { style: { padding: "var(--s-4) var(--s-6)", color: "var(--fg-0)", width: "100%", fontWeight: 600 } },
              window.BS.prettifyDesc(r.description),
              r.installment && h("span", { className: "px-chip", style: { marginLeft: "var(--s-4)", color: "var(--fg-3)" } }, r.installment)),
            h("td", { className: "mono", style: { padding: "var(--s-4) var(--s-6)", textAlign: "right", fontWeight: 700, color: r.amount < 0 ? "var(--pos)" : "var(--fg-0)" } },
              `${r.amount < 0 ? "+" : "−"}${fmtBRL(Math.abs(r.amount))}`)
          )))))
    );
  };

  const resultsView = results && h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: "var(--s-5)" } },
    h("div", { className: "label", style: { color: "var(--fg-1)" } }, "Resultado da importação (algumas contas falharam):"),
    h("div", { className: "px-list" },
      results.map((s, i) => h("div", { className: "px-row", key: i },
        h("span", { style: { flex: 1 } }, s.account === "b3" ? "Relatório B3" : s.account === "fatura" ? "Fatura Inter" : accLabel(s.account)),
        h("span", { className: "mono", style: { color: s.ok ? "var(--pos)" : "var(--neg)", fontWeight: 600 } },
          s.ok ? `${s.inserted} importadas` : (s.msg || "falhou"))))),
    h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "var(--s-4)" } },
      h("button", { className: "px-btn px-btn--primary", onClick: () => onDone({ inserted: results.filter(s => s.ok).reduce((a, s) => a + (s.inserted || 0), 0), kind: "tx" }) }, "FECHAR"))
  );

  const _willRows = (groups || []).flatMap(g => groupNew(g.account));
  const _typeCounts = _willRows.reduce((acc, r) => { const t = classifyRow(r).tag; acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  const _breakdown = ["despesa", "receita", "crédito", "transferência", "investimento"]
    .filter(t => _typeCounts[t])
    .map(t => `${_typeCounts[t]} ${_typeCounts[t] > 1 ? t + "s" : t}`)
    .join(" · ");

  const step2View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: "var(--s-6)" } },
    h("div", { style: { display: "flex", flexDirection: "column", gap: "var(--s-5)", maxHeight: "62vh", overflowY: "auto", paddingRight: "var(--s-2)" } },
      (groups || []).map(renderTxGroup),
      faturas.map(renderFatura),
      b3s.map(renderB3)
    ),
    err && h("div", { style: { color: "var(--neg)", fontSize: "var(--fz-8)", padding: "var(--s-4) var(--s-5)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", border: "2px solid var(--neg)" } }, err),
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s-5)", borderTop: "2px solid var(--line-1)", paddingTop: "var(--s-5)" } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: "var(--s-1)" } },
        h("div", { style: { fontSize: "var(--fz-6)", color: "var(--fg-2)" } },
          h("strong", { style: { color: "var(--pos)" } }, txWillImport),
          ` ${txWillImport === 1 ? "transação pronta" : "transações prontas"}`,
          faturaCount > 0 && h("span", { style: { color: "var(--warn)" } }, ` · ${faturaCount} fatura${faturaCount === 1 ? "" : "s"}`),
          b3Count > 0 && h("span", { style: { color: "var(--fg-3)" } }, ` · ${b3Count} B3`)),
        _breakdown && h("div", { style: { fontSize: "var(--fz-8)", color: "var(--fg-3)" } }, _breakdown)),
      h("div", { style: { display: "flex", gap: "var(--s-4)" } },
        h("button", { className: "px-btn", disabled: busy, onClick: () => { setGroups(null); setB3s([]); setFaturas([]); setRowsByGroup({}); setResults(null); } }, "‹ VOLTAR"),
        h("button", { className: "px-btn px-btn--primary", disabled: busy || (txWillImport <= 0 && b3Count <= 0 && faturaCount <= 0), onClick: confirm },
          busy ? "IMPORTANDO…" : "CONFIRMAR IMPORTAÇÃO"))
    )
  );

  return h(Modal, {
    open: true, onClose,
    title: `Importar Dados${step === 2 ? " — Revisão" : ""}`,
    width: step === 2 ? 820 : 560,
  },
    h("div", { className: "px-steps", style: { marginBottom: "var(--s-5)" } },
      h("div", { className: `px-step ${step === 1 ? "px-step--active" : "px-step--done"}` }, "1"),
      h("div", { className: "px-step-bar" }),
      h("div", { className: `px-step ${step === 2 ? "px-step--active" : ""}` }, "2")
    ),
    results ? resultsView : (step === 1 ? step1View : step2View)
  );
}

window.BS = window.BS || {};
window.BS.ImportModal = ImportModal;
window.BS.EditableCell = EditableCell;

})();
