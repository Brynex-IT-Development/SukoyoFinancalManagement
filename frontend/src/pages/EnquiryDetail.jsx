import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, X } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { StoreSelect, useStoreChoice, todayIST } from "../components/payables/VendorReportKit";
import { ENQUIRY_STATUS, followUpStyle } from "./Enquiries";
import { api, formatDate, formatDateTime, ui } from "../utils/retailApi";

const EMPTY = { customerName: "", phone: "", itemWanted: "", itemId: "", itemName: "", itemSku: "", staffId: "", followUpDate: "", notes: "" };

/** Item link: search items and pick one (optional — the free-text "item wanted" is what counts). */
const ItemLink = ({ value, onChange }) => {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return undefined; }
    let active = true;
    const t = setTimeout(() => api("/enquiries/items", { query: { search: q } }).then((d) => active && setItems(d.items)).catch(() => active && setItems([])), 250);
    return () => { active = false; clearTimeout(t); };
  }, [q]);
  if (value.itemId) {
    return (
      <div className="flex items-center gap-2 h-9 text-xs">
        <span className="font-semibold">{value.itemName}</span>{value.itemSku && <span className="text-[#6B7280]">{value.itemSku}</span>}
        <button type="button" onClick={() => onChange({ itemId: "", itemName: "", itemSku: "" })} className="text-[#6B7280] hover:text-[#111827]" aria-label="Remove item link"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or SKU (optional)" className={ui.input} />
      {items.length > 0 && (
        <div className="absolute z-20 mt-1 w-full border border-[#E5E7EB] bg-white shadow-lg max-h-60 overflow-auto">
          {items.map((i) => (
            <button key={i.id} type="button" onClick={() => { onChange({ itemId: i.id, itemName: i.group ? `${i.group} · ${i.name}` : i.name, itemSku: i.sku }); setQ(""); setItems([]); }}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-[#F6FCE6]">{i.group ? `${i.group} · ` : ""}{i.name}{i.sku && <span className="text-[#6B7280]"> · {i.sku}</span>}</button>
          ))}
        </div>
      )}
    </div>
  );
};

const EnquiryForm = ({ initial, locCode, store, onSubmit, onCancel, saving, submitLabel }) => {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const [staff, setStaff] = useState([]);
  const loc = locCode || store?.locCode;
  useEffect(() => {
    if (!loc) { setStaff([]); return; }
    api("/attendance/staff-list", { query: { locCode: loc } }).then((d) => setStaff(d.staff)).catch(() => setStaff([]));
  }, [loc]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(f); }} className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl`}>
      {store && store.canChoose && <div className="md:col-span-2"><label className={ui.label}>Store <span className="text-red-500">*</span></label><StoreSelect store={store} /></div>}
      <div><label className={ui.label}>Customer name <span className="text-red-500">*</span></label><input value={f.customerName} onChange={set("customerName")} className={ui.input} required /></div>
      <div><label className={ui.label}>Phone <span className="text-red-500">*</span></label><input value={f.phone} onChange={set("phone")} inputMode="tel" className={ui.input} required /></div>
      <div className="md:col-span-2"><label className={ui.label}>Item wanted <span className="text-red-500">*</span></label><input value={f.itemWanted} onChange={set("itemWanted")} placeholder="e.g. 22K gold ring, size 14, under 8 grams" className={ui.input} required /></div>
      <div><label className={ui.label}>Link to an item</label><ItemLink value={f} onChange={(v) => setF((x) => ({ ...x, ...v }))} /></div>
      <div>
        <label className={ui.label}>Staff who took it</label>
        <select value={f.staffId || ""} onChange={set("staffId")} className={ui.input}>
          <option value="">—</option>
          {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
      </div>
      <div><label className={ui.label}>Follow up on</label><input type="date" value={f.followUpDate || ""} min={initial?.followUpDate ? undefined : todayIST()} onChange={set("followUpDate")} className={ui.input} /></div>
      <div className="md:col-span-2"><label className={ui.label}>Notes</label><textarea value={f.notes} onChange={set("notes")} rows={3} className={`${ui.input} h-auto py-2`} /></div>
      <div className="md:col-span-2 flex justify-end gap-2.5">
        {onCancel && <button type="button" onClick={onCancel} className={ui.btn}>Cancel</button>}
        <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
};

const StatusPanel = ({ enquiry, onChanged }) => {
  const [status, setStatus] = useState(enquiry.status);
  const [note, setNote] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [followUpDate, setFollowUpDate] = useState(enquiry.followUpDate || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setStatus(enquiry.status); setFollowUpDate(enquiry.followUpDate || ""); }, [enquiry]);
  const open = status === "new" || status === "contacted";
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { status, note, ...(status === "converted" ? { invoiceNumber } : {}), ...(open ? { followUpDate } : {}) };
      onChanged(await api(`/enquiries/${enquiry._id}/status`, { method: "POST", body }));
      setNote("");
      setInvoiceNumber("");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className={`${ui.card} p-5 space-y-3`}>
      <p className={ui.sectionTitle}>Update status</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(ENQUIRY_STATUS).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={`h-8 px-3 text-xs font-bold border ${status === k ? `${v.style} ring-2 ring-offset-1 ring-[#1C1F26]` : "bg-white text-[#374151] border-[#E5E7EB]"}`}>{v.label}</button>
        ))}
      </div>
      {status === "converted" && <div><label className={ui.label}>Invoice number (optional)</label><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-…" className={ui.input} /></div>}
      {open && <div><label className={ui.label}>Next follow-up</label><input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className={ui.input} /></div>}
      <div><label className={ui.label}>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={status === enquiry.status ? "What happened on this follow-up?" : "Optional"} className={ui.input} /></div>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving…" : status === enquiry.status ? "Log follow-up" : `Mark ${ENQUIRY_STATUS[status].label.toLowerCase()}`}</button></div>
    </form>
  );
};

// F16: one enquiry (or a new one at /sales/enquiries/new).
const EnquiryDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === "new";
  const store = useStoreChoice({ allowAll: false });
  const [e, setE] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => { if (!isNew) api(`/enquiries/${id}`).then(setE).catch((err) => setError(err.message)); }, [id, isNew]);
  useEffect(load, [load]);

  const create = async (f) => {
    setSaving(true);
    setError("");
    try {
      const doc = await api("/enquiries", { method: "POST", body: { ...f, locCode: store.locCode } });
      navigate(`/sales/enquiries/${doc._id}`, { replace: true });
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const update = async (f) => {
    setSaving(true);
    setError("");
    try {
      const { customerName, phone, itemWanted, itemId, itemName, itemSku, staffId, followUpDate, notes } = f;
      setE(await api(`/enquiries/${id}`, { method: "PUT", body: { customerName, phone, itemWanted, itemId, itemName, itemSku, staffId: staffId || "", followUpDate, notes } }));
      setEditing(false);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const today = todayIST();
  const fu = e?.followUpDate && ["new", "contacted"].includes(e.status) ? (e.followUpDate < today ? "overdue" : e.followUpDate === today ? "today" : "later") : "";

  return (
    <>
      <Header title={isNew ? "New Enquiry" : "Enquiry"} />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>{isNew ? "New Enquiry" : e?.number || "Enquiry"}</h1>
              <p className={ui.sub}>{isNew ? "A customer asked for an item. Note who, what and when to follow up." : e ? `${e.customerName} · ${e.phone} · Store ${e.locCode}` : ""}</p>
            </div>
            <div className="flex items-center gap-2.5">
              <Link to="/sales/enquiries" className={ui.btn}><ArrowLeft size={14} /> Enquiries</Link>
              {e && !editing && <button type="button" onClick={() => setEditing(true)} className={ui.btn}><Pencil size={14} /> Edit details</button>}
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          {isNew ? (
            <EnquiryForm initial={EMPTY} store={store} onSubmit={create} saving={saving} submitLabel="Save enquiry" />
          ) : !e ? (!error && <p className="text-xs text-[#6B7280]">Loading…</p>) : editing ? (
            <EnquiryForm initial={{ ...e, staffId: e.staffId ? String(e.staffId) : "" }} locCode={e.locCode} onSubmit={update} onCancel={() => setEditing(false)} saving={saving} submitLabel="Save changes" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className={`${ui.card} p-5 space-y-3 text-xs`}>
                <div className="flex justify-between"><span className="text-[#6B7280]">Status</span><span className={`${ui.badge} ${ENQUIRY_STATUS[e.status]?.style}`}>{ENQUIRY_STATUS[e.status]?.label}</span></div>
                <div><span className="text-[#6B7280]">Item wanted</span><p className="mt-0.5 font-semibold text-sm">{e.itemWanted}</p></div>
                {e.itemId && <div className="flex justify-between"><span className="text-[#6B7280]">Linked item</span><span>{e.itemName}{e.itemSku ? ` · ${e.itemSku}` : ""}</span></div>}
                <div className="flex justify-between"><span className="text-[#6B7280]">Customer</span><span className="font-semibold">{e.customerName}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Phone</span><a href={`tel:${e.phone}`} className="hover:underline">{e.phone}</a></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Staff</span><span>{e.staffName || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Follow up on</span><span className={followUpStyle[fu] || ""}>{e.followUpDate ? `${formatDate(e.followUpDate)}${fu === "overdue" ? " · overdue" : fu === "today" ? " · today" : ""}` : "—"}</span></div>
                {e.convertedInvoiceNumber && <div className="flex justify-between"><span className="text-[#6B7280]">Invoice</span><span className="font-semibold">{e.convertedInvoiceNumber}</span></div>}
                <div className="flex justify-between"><span className="text-[#6B7280]">Taken</span><span>{formatDateTime(e.createdAt)}</span></div>
                {e.notes && <div><span className="text-[#6B7280]">Notes</span><p className="mt-0.5 whitespace-pre-wrap">{e.notes}</p></div>}
              </div>
              <StatusPanel enquiry={e} onChanged={setE} />
              <section className={`${ui.card} p-5`}>
                <p className={ui.sectionTitle}>History</p>
                <ol className="space-y-3">
                  {[...e.history].reverse().map((h, i) => (
                    <li key={i} className="border-l-2 border-[#E5E7EB] pl-3 text-xs">
                      <div className="flex items-center gap-2"><span className={`${ui.badge} ${ENQUIRY_STATUS[h.status]?.style}`}>{ENQUIRY_STATUS[h.status]?.label}</span><span className="text-[#6B7280]">{formatDateTime(h.at)}</span></div>
                      {h.note && <p className="mt-1">{h.note}</p>}
                      <p className="text-[10px] text-[#9CA3AF]">{h.by}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default EnquiryDetail;
