import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, X } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { StoreSelect, useStoreChoice, todayIST } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Search items (standalone and variants) with their stock and cost at the chosen store. */
const ItemSearch = ({ locCode, value, onPick, placeholder }) => {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return undefined; }
    let active = true;
    const t = setTimeout(() => api("/repacks/items", { query: { search: q, locCode } }).then((d) => active && setItems(d.items)).catch(() => active && setItems([])), 250);
    return () => { active = false; clearTimeout(t); };
  }, [q, locCode]);
  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 text-xs">
        <span className="font-semibold">{value.name}</span><span className="text-[#6B7280]">{value.sku} · {value.stock} in stock · {formatCurrency(value.cost)}</span>
        <button type="button" onClick={() => onPick(null)} className="text-[#6B7280] hover:text-[#111827]" aria-label="Change item"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={ui.input} />
      {items.length > 0 && (
        <div className="absolute z-20 mt-1 w-full border border-[#E5E7EB] bg-white shadow-lg max-h-64 overflow-auto">
          {items.map((i) => (
            <button key={`${i.itemGroupId}:${i.itemId}`} type="button" onClick={() => { onPick(i); setQ(""); setItems([]); }} className="block w-full text-left px-3 py-2 text-xs hover:bg-[#F6FCE6]">
              <span className="font-semibold">{i.name}</span><span className="text-[#6B7280]"> · {i.sku || "no SKU"} · {i.stock} in stock · {formatCurrency(i.cost)}{i.manageBatch ? " · batches" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const NewRepack = () => {
  const navigate = useNavigate();
  const store = useStoreChoice({ allowAll: false });
  const [sources, setSources] = useState([{ item: null, qty: "" }]);
  const [target, setTarget] = useState(null);
  const [packs, setPacks] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expDate, setExpDate] = useState("");
  const [charges, setCharges] = useState("");
  const [date, setDate] = useState(todayIST());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Preview at item cost price (the server uses batch costs where they are recorded)
  const preview = useMemo(() => {
    const consumed = sources.reduce((s, x) => s + (x.item ? (Number(x.qty) || 0) * x.item.cost : 0), 0);
    const total = consumed + (Number(charges) || 0);
    return { consumed: round2(consumed), total: round2(total), unit: Number(packs) > 0 ? round2(total / Number(packs)) : 0 };
  }, [sources, charges, packs]);
  const setSource = (i, patch) => setSources((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const over = sources.filter((s) => s.item && Number(s.qty) > s.item.stock);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const doc = await api("/repacks", { method: "POST", body: {
        locCode: store.locCode, date, notes, charges: charges || 0,
        sources: sources.filter((s) => s.item).map((s) => ({ itemId: s.item.itemId, itemGroupId: s.item.itemGroupId || undefined, qty: Number(s.qty) })),
        target: target ? { itemId: target.itemId, itemGroupId: target.itemGroupId || undefined, packs: Number(packs), batchNo, expDate } : null,
      } });
      navigate(`/inventory/repacks/${doc._id}`, { replace: true });
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={save} className="px-6 py-5 space-y-5 max-w-5xl">
      <div className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-4 gap-4`}>
        <div><label className={ui.label}>Store / warehouse</label><StoreSelect store={store} /></div>
        <div><label className={ui.label}>Date</label><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className={ui.input} /></div>
        <div className="md:col-span-2"><label className={ui.label}>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={ui.input} /></div>
      </div>

      <section className={`${ui.card} p-5 space-y-3`}>
        <p className={ui.sectionTitle}>Repack from</p>
        {sources.map((s, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_32px] gap-3 items-end">
            <div><label className={ui.label}>Item</label><ItemSearch locCode={store.locCode} value={s.item} onPick={(item) => setSource(i, { item })} placeholder="Search by name or SKU" /></div>
            <div><label className={ui.label}>Quantity used</label><input type="number" min="0" step="any" value={s.qty} onChange={(e) => setSource(i, { qty: e.target.value })} className={`${ui.input} ${s.item && Number(s.qty) > s.item.stock ? "border-red-400" : ""}`} /></div>
            <div className="text-xs text-right h-9 flex items-center justify-end tabular-nums">{s.item && Number(s.qty) > 0 ? formatCurrency((Number(s.qty) || 0) * s.item.cost) : ""}</div>
            <button type="button" onClick={() => setSources((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ item: null, qty: "" }]))} className="h-9 text-[#6B7280] hover:text-[#B91C1C]" aria-label="Remove line"><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setSources((list) => [...list, { item: null, qty: "" }])} className={ui.btn}><Plus size={14} /> Add item</button>
        {over.length > 0 && <p className="text-xs font-semibold text-red-600">More than in stock: {over.map((s) => s.item.name).join(", ")}.</p>}
      </section>

      <section className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-4 gap-4`}>
        <p className={`${ui.sectionTitle} md:col-span-4`}>Packed into</p>
        <div className="md:col-span-2"><label className={ui.label}>Item</label><ItemSearch locCode={store.locCode} value={target} onPick={setTarget} placeholder="The packed item" /></div>
        <div><label className={ui.label}>Packs produced</label><input type="number" min="0" step="any" value={packs} onChange={(e) => setPacks(e.target.value)} className={ui.input} /></div>
        <div><label className={ui.label}>Repacking charges (₹)</label><input type="number" min="0" step="0.01" value={charges} onChange={(e) => setCharges(e.target.value)} className={ui.input} /></div>
        {target?.manageBatch && (
          <>
            <div><label className={ui.label}>Batch number</label><input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Repack number" className={`${ui.input} uppercase`} /></div>
            <div><label className={ui.label}>Expiry date</label><input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className={ui.input} /></div>
            <p className="md:col-span-2 text-[11px] text-[#6B7280] self-end pb-2">Blank expiry = the earliest expiry among the batches used.</p>
          </>
        )}
      </section>

      <div className={`${ui.card} p-5 flex flex-wrap items-center justify-between gap-4 text-xs`}>
        <div className="space-y-1">
          <p>Items used {formatCurrency(preview.consumed)} + charges {formatCurrency(Number(charges) || 0)} = <b>{formatCurrency(preview.total)}</b></p>
          <p className="text-sm">Cost per pack: <b>{formatCurrency(preview.unit)}</b> <span className="text-[11px] text-[#6B7280]">(preview at cost price; batch costs are used where recorded)</span></p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link to="/inventory/repacks" className={ui.btn}>Cancel</Link>
          <button type="submit" disabled={saving || !target || !(Number(packs) > 0) || !sources.some((s) => s.item && Number(s.qty) > 0)} className={ui.btnDark}>{saving ? "Saving…" : "Repack"}</button>
        </div>
      </div>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
    </form>
  );
};

const ViewRepack = ({ id }) => {
  const navigate = useNavigate();
  const [rp, setRp] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api(`/repacks/${id}`).then(setRp).catch((e) => setError(e.message)); }, [id]);
  const remove = async () => {
    if (!window.confirm(`Reverse ${rp.number}? ${rp.target.packs} × ${rp.target.name} leave stock and the source items go back.`)) return;
    try { const r = await api(`/repacks/${id}`, { method: "DELETE" }); window.alert(r.message); navigate("/inventory/repacks"); }
    catch (e) { window.alert(e.message); }
  };
  if (error) return <p className="p-6 text-xs font-semibold text-red-600">{error}</p>;
  if (!rp) return <p className="p-6 text-xs text-[#6B7280]">Loading…</p>;
  return (
    <div className="px-6 py-5 space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#4B5563]">{formatDate(rp.date)} · {rp.warehouse} · by {rp.createdBy}{rp.notes ? ` · ${rp.notes}` : ""}</p>
        {rp.canDelete && <button type="button" onClick={remove} className={ui.btn}><Trash2 size={14} /> Reverse repack</button>}
      </div>
      <section className={`${ui.card} overflow-x-auto`}>
        <table className="min-w-full border-collapse">
          <thead><tr className={ui.theadRow}><th className={ui.th}>Used</th><th className={ui.th}>SKU</th><th className={ui.th}>Batches</th><th className={ui.thRight}>Qty</th><th className={ui.thRight}>Unit cost</th><th className="px-3 py-3 text-right">Cost</th></tr></thead>
          <tbody className="divide-y divide-[#F3F4F6] text-xs">
            {rp.sources.map((s, i) => (
              <tr key={i}><td className={`${ui.td} font-semibold`}>{s.name}</td><td className={ui.td}>{s.sku || "—"}</td><td className={`${ui.td} font-mono`}>{s.batchAllocations.map((a) => `${a.batchNo} × ${a.qty}`).join(", ") || "—"}</td>
                <td className={`${ui.td} text-right tabular-nums`}>{s.qty}</td><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(s.unitCost)}</td><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(s.cost)}</td></tr>
            ))}
            <tr><td className={ui.td} colSpan={5}>Repacking charges</td><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(rp.charges)}</td></tr>
            <tr className="bg-[#F3F4F6] font-bold"><td className={ui.td} colSpan={5}>Total cost</td><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(rp.totalCost)}</td></tr>
          </tbody>
        </table>
      </section>
      <section className={`${ui.card} p-5 text-xs grid grid-cols-2 md:grid-cols-4 gap-4`}>
        <div><p className="text-[#6B7280]">Packed into</p><p className="font-semibold text-sm">{rp.target.name}</p><p className="text-[#6B7280]">{rp.target.sku}</p></div>
        <div><p className="text-[#6B7280]">Packs produced</p><p className="font-bold text-sm">{rp.target.packs}</p></div>
        <div><p className="text-[#6B7280]">Cost per pack</p><p className="font-bold text-sm">{formatCurrency(rp.unitCost)}</p></div>
        <div><p className="text-[#6B7280]">Batch</p><p className="font-mono">{rp.target.batchNo || "—"}{rp.target.expDate ? ` · exp ${formatDate(rp.target.expDate)}` : ""}</p></div>
      </section>
    </div>
  );
};

// F19: new repack (/inventory/repacks/new) or one repack.
const RepackDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const isNew = id === "new";
  return (
    <>
      <Header title={isNew ? "New Repack" : "Repack"} />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>{isNew ? "New Repack" : "Repack"}</h1>
              <p className={ui.sub}>{isNew ? "Choose what is used up and what it is packed into. Cost per pack = (items used + charges) ÷ packs." : "Source items used and packs produced."}</p>
            </div>
            <Link to="/inventory/repacks" className={ui.btn}><ArrowLeft size={14} /> Repacking</Link>
          </div>
        </div>
        {isNew ? <NewRepack /> : <ViewRepack id={id} />}
      </div>
    </>
  );
};

export default RepackDetail;
