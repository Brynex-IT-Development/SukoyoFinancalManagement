import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Plus, Pencil, X, Download, Search } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { StoreSelect, useStoreChoice, todayIST } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, getCurrentUser, isAdminUser, ui } from "../utils/retailApi";

// F20: classes, tutors and bookings.
const VIEWS = [{ key: "classes", label: "Classes" }, { key: "bookings", label: "Bookings" }, { key: "tutors", label: "Tutors" }];
const PRICING = { free: "Free", per_session: "Per session", membership: "Membership" };
const REPEAT = { none: "Once", daily: "Daily", weekly: "Weekly" };
const STATUS_STYLE = {
  booked: "bg-[#E0E7FF] text-[#3730A3] border-[#C7D2FE]",
  attended: "bg-[#DCFCE7] text-[#15803d] border-[#BBF7D0]",
  cancelled: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]",
};
const canManageHere = (locCode) => { const u = getCurrentUser(); return isAdminUser(u) || (u.role === "store_manager" && String(u.locCode) === String(locCode)); };
const Field = ({ label, children, span = 1 }) => <div className={span === 2 ? "md:col-span-2" : ""}><label className={ui.label}>{label}</label>{children}</div>;

// ─── Tutors ────────────────────────────────────────────────────────────────
const TutorForm = ({ initial, store, onSaved, onCancel }) => {
  const [f, setF] = useState({ name: "", expertise: "", phone: "", email: "", internalOrExternal: "internal", address: "", active: true, ...initial });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const { name, expertise, phone, email, internalOrExternal, address, active } = f;
      const body = { name, expertise, phone, email, internalOrExternal, address };
      if (f._id) await api(`/tutors/${f._id}`, { method: "PUT", body: { ...body, active } });
      else await api("/tutors", { method: "POST", body: { ...body, locCode: store.locCode } });
      onSaved();
    } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={save} className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-4 gap-4`}>
      <p className={`${ui.sectionTitle} md:col-span-4 flex justify-between`}>{f._id ? `Edit ${initial.name}` : "Add tutor"}<button type="button" onClick={onCancel} aria-label="Close"><X size={14} /></button></p>
      {!f._id && store.canChoose && <Field label="Store"><StoreSelect store={store} /></Field>}
      <Field label="Name *"><input value={f.name} onChange={set("name")} className={ui.input} required /></Field>
      <Field label="Expertise"><input value={f.expertise} onChange={set("expertise")} className={ui.input} /></Field>
      <Field label="Phone"><input value={f.phone} onChange={set("phone")} className={ui.input} /></Field>
      <Field label="Email"><input value={f.email} onChange={set("email")} className={ui.input} /></Field>
      <Field label="Internal / external"><select value={f.internalOrExternal} onChange={set("internalOrExternal")} className={ui.input}><option value="internal">Internal</option><option value="external">External</option></select></Field>
      <Field label="Address" span={2}><input value={f.address} onChange={set("address")} className={ui.input} /></Field>
      {f._id && <label className="flex items-end gap-2 pb-2 text-xs font-semibold"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Active</label>}
      {error && <p className="md:col-span-4 text-xs font-semibold text-red-600">{error}</p>}
      <div className="md:col-span-4 flex justify-end gap-2.5"><button type="button" onClick={onCancel} className={ui.btn}>Cancel</button><button type="submit" className={ui.btnDark}>Save tutor</button></div>
    </form>
  );
};

const TutorsView = ({ store }) => {
  const [tutors, setTutors] = useState(null);
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { api("/tutors", { query: store.query }).then((d) => setTutors(d.tutors)).catch((e) => setError(e.message)); }, [store.query.locCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return (
    <div className="px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        <button type="button" onClick={() => setPanel({})} className={ui.btnDark}><Plus size={14} /> Add Tutor</button>
      </div>
      {panel && <TutorForm initial={panel} store={store} onSaved={() => { setPanel(null); load(); }} onCancel={() => setPanel(null)} />}
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      <section className={`${ui.card} overflow-x-auto`}>
        {!tutors ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">Loading…</p> : !tutors.length ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">No tutors yet.</p> : (
          <table className="min-w-full border-collapse">
            <thead><tr className={ui.theadRow}><th className={ui.th}>Name</th><th className={ui.th}>Expertise</th><th className={ui.th}>Phone</th><th className={ui.th}>Email</th><th className={ui.th}>Type</th><th className={ui.th}>Store</th><th className={ui.th}>Status</th><th className="px-3 py-3" /></tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {tutors.map((t) => (
                <tr key={t._id} className={t.active ? "" : "text-[#9CA3AF]"}>
                  <td className={`${ui.td} font-semibold`}>{t.name}</td><td className={ui.td}>{t.expertise || "—"}</td><td className={ui.td}>{t.phone || "—"}</td><td className={ui.td}>{t.email || "—"}</td>
                  <td className={ui.td}>{t.internalOrExternal === "external" ? "External" : "Internal"}</td><td className={ui.td}>{t.locCode}</td><td className={ui.td}>{t.active ? "Active" : "Inactive"}</td>
                  <td className={`${ui.td} text-right`}>{canManageHere(t.locCode) && <button type="button" onClick={() => setPanel(t)} aria-label={`Edit ${t.name}`}><Pencil size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

// ─── Classes ───────────────────────────────────────────────────────────────
const ClassForm = ({ initial, store, onSaved, onCancel }) => {
  const [f, setF] = useState({ name: "", type: "", maxParticipants: 10, pricingType: "per_session", price: "", date: todayIST(), time: "16:00", durationMinutes: 60, recurring: "none", endDate: "", ...initial, tutorId: initial?.tutorId ? String(initial.tutorId) : "" });
  const [tutors, setTutors] = useState([]);
  const [error, setError] = useState("");
  const loc = f._id ? f.locCode : store.locCode;
  useEffect(() => { if (loc) api("/tutors", { query: { locCode: loc, active: "1" } }).then((d) => setTutors(d.tutors)).catch(() => setTutors([])); }, [loc]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const { name, type, maxParticipants, pricingType, price, date, time, durationMinutes, recurring, endDate, tutorId, active } = f;
      const body = { name, type, maxParticipants: Number(maxParticipants), pricingType, price: pricingType === "free" ? 0 : Number(price) || 0, date, time, durationMinutes: Number(durationMinutes), recurring, endDate: recurring === "none" ? "" : endDate, tutorId };
      if (f._id) await api(`/classes/${f._id}`, { method: "PUT", body: { ...body, active } });
      else await api("/classes", { method: "POST", body: { ...body, locCode: store.locCode } });
      onSaved();
    } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={save} className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-4 gap-4`}>
      <p className={`${ui.sectionTitle} md:col-span-4 flex justify-between`}>{f._id ? `Edit ${initial.name}` : "Add class"}<button type="button" onClick={onCancel} aria-label="Close"><X size={14} /></button></p>
      {!f._id && store.canChoose && <Field label="Store"><StoreSelect store={store} /></Field>}
      <Field label="Name *"><input value={f.name} onChange={set("name")} className={ui.input} required /></Field>
      <Field label="Type"><input value={f.type} onChange={set("type")} placeholder="Workshop, course, demo…" className={ui.input} /></Field>
      <Field label="Tutor"><select value={f.tutorId} onChange={set("tutorId")} className={ui.input}><option value="">—</option>{tutors.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select></Field>
      <Field label="Date *"><input type="date" value={f.date} onChange={set("date")} className={ui.input} required /></Field>
      <Field label="Time *"><input type="time" value={f.time} onChange={set("time")} className={ui.input} required /></Field>
      <Field label="Duration (minutes)"><input type="number" min="1" value={f.durationMinutes} onChange={set("durationMinutes")} className={ui.input} /></Field>
      <Field label="Repeats"><select value={f.recurring} onChange={set("recurring")} className={ui.input}>{Object.entries(REPEAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {f.recurring !== "none" && <Field label="Until (optional)"><input type="date" value={f.endDate} min={f.date} onChange={set("endDate")} className={ui.input} /></Field>}
      <Field label="Maximum participants *"><input type="number" min="1" step="1" value={f.maxParticipants} onChange={set("maxParticipants")} className={ui.input} required /></Field>
      <Field label="Pricing"><select value={f.pricingType} onChange={set("pricingType")} className={ui.input}>{Object.entries(PRICING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {f.pricingType !== "free" && <Field label={f.pricingType === "membership" ? "Price without membership (₹)" : "Price per session (₹)"}><input type="number" min="0" step="0.01" value={f.price} onChange={set("price")} className={ui.input} /></Field>}
      {f._id && <label className="flex items-end gap-2 pb-2 text-xs font-semibold"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Running</label>}
      {error && <p className="md:col-span-4 text-xs font-semibold text-red-600">{error}</p>}
      <div className="md:col-span-4 flex justify-end gap-2.5"><button type="button" onClick={onCancel} className={ui.btn}>Cancel</button><button type="submit" className={ui.btnDark}>Save class</button></div>
    </form>
  );
};

const ClassesView = ({ store }) => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [panel, setPanel] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => { api("/classes", { query: { ...store.query, search } }).then(setData).catch((e) => setError(e.message)); }, [store.query.locCode, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const canAdd = isAdminUser() || getCurrentUser().role === "store_manager";
  return (
    <div className="px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px]"><label className={ui.label}>Search</label><Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Class, type or tutor" className={`${ui.input} pl-9`} /></div>
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        </div>
        {canAdd && <button type="button" onClick={() => setPanel({})} className={ui.btnDark}><Plus size={14} /> Add Class</button>}
      </div>
      {panel && <ClassForm initial={panel} store={store} onSaved={() => { setPanel(null); load(); }} onCancel={() => setPanel(null)} />}
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      <section className={`${ui.card} overflow-x-auto`}>
        {!data ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">Loading…</p> : !data.classes.length ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">No classes yet.</p> : (
          <table className="min-w-full border-collapse">
            <thead><tr className={ui.theadRow}>
              <th className={ui.th}>Class</th><th className={ui.th}>Tutor</th><th className={ui.th}>Schedule</th><th className={ui.thRight}>Max</th><th className={ui.th}>Next</th><th className={ui.thRight}>Seats left</th><th className={ui.th}>Price</th><th className="px-3 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {data.classes.map((c) => (
                <tr key={c._id} className={c.active ? "" : "text-[#9CA3AF]"}>
                  <td className={`${ui.td} font-semibold`}>{c.name}{c.type && <span className="block text-[10px] font-normal text-[#6B7280]">{c.type} · {c.durationMinutes} min</span>}</td>
                  <td className={ui.td}>{c.tutorName || "—"}</td>
                  <td className={`${ui.td} whitespace-nowrap`}>{REPEAT[c.recurring]} from {formatDate(c.date)} · {c.time}{c.endDate ? ` until ${formatDate(c.endDate)}` : ""}</td>
                  <td className={`${ui.td} text-right tabular-nums`}>{c.maxParticipants}</td>
                  <td className={`${ui.td} whitespace-nowrap`}>{c.next ? formatDate(c.next.date) : c.active ? "No more dates" : "Not running"}</td>
                  <td className={`${ui.td} text-right tabular-nums font-semibold ${c.next && !c.next.left ? "text-[#B91C1C]" : ""}`}>{c.next ? (c.next.left || "Full") : "—"}</td>
                  <td className={ui.td}>{c.pricingType === "free" ? "Free" : `${formatCurrency(c.price)}${c.pricingType === "membership" ? " (members free)" : ""}`}</td>
                  <td className={`${ui.td} text-right whitespace-nowrap`}>
                    {c.next && c.active && <button type="button" onClick={() => navigate(`/classes/bookings?class=${c._id}&date=${c.next.date}`)} className={`${ui.btn} h-8`}>Book</button>}
                    {canManageHere(c.locCode) && <button type="button" onClick={() => setPanel(c)} className="ml-2" aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

// ─── Bookings ──────────────────────────────────────────────────────────────
const BookingsView = ({ store }) => {
  const [params, setParams] = useSearchParams();
  const classId = params.get("class") || "";
  const date = params.get("date") || "";
  const [classes, setClasses] = useState([]);
  const [cls, setCls] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ phone: "", name: "", membership: "", notes: "" });
  const [found, setFound] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k === "class") n.delete("date"); return n; }, { replace: true });

  useEffect(() => { api("/classes", { query: { ...store.query, active: "1" } }).then((d) => setClasses(d.classes)).catch(() => setClasses([])); }, [store.query.locCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!classId) { setCls(null); return; } api(`/classes/${classId}`).then(setCls).catch((e) => setError(e.message)); }, [classId, reload]);
  useEffect(() => { if (cls && !date && cls.occurrences[0]) setParam("date", cls.occurrences[0].date); }, [cls]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      api("/bookings", { query: { ...store.query, classId, date: classId ? date : "", status, search, ...(classId ? {} : { fromDate: todayIST() }) } })
        .then((d) => active && setBookings(d.bookings)).catch((e) => active && setError(e.message));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [store.query.locCode, classId, date, status, search, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autofill the customer's name from their phone number
  const lookup = async () => {
    setFound(null);
    if (String(form.phone).replace(/\D/g, "").length < 10) return;
    try { const d = await api("/customers/lookup", { query: { phone: form.phone } }); if (d.customer) { setFound(d.customer); setForm((f) => ({ ...f, name: d.customer.name || f.name })); } } catch { /* not found */ }
  };
  const book = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api("/bookings", { method: "POST", body: { classId, date, ...form } });
      setForm({ phone: "", name: "", membership: "", notes: "" });
      setFound(null);
      setReload((k) => k + 1);
    } catch (err) { setError(err.message); }
  };
  const setBookingStatus = async (b, s) => {
    setError("");
    try { await api(`/bookings/${b._id}/status`, { method: "POST", body: { status: s } }); setReload((k) => k + 1); } catch (err) { setError(err.message); }
  };
  const occ = cls?.occurrences?.find((o) => o.date === date);
  const price = cls ? (cls.pricingType === "free" ? 0 : cls.pricingType === "membership" && form.membership.trim() ? 0 : cls.price) : 0;
  const csvData = useMemo(() => (bookings || []).map((b) => ({ Number: b.number, Class: b.className, Date: b.date, Time: b.time, Customer: b.customerName, Phone: b.customerPhone, Membership: b.membership, Price: b.price, Status: b.status })), [bookings]);

  return (
    <div className="px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        <div><label className={ui.label}>Class</label>
          <select value={classId} onChange={(e) => setParam("class", e.target.value)} className={`${ui.input} w-64`}>
            <option value="">All upcoming bookings</option>{classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select></div>
        {cls && (
          <div><label className={ui.label}>Class day</label>
            <select value={date} onChange={(e) => setParam("date", e.target.value)} className={`${ui.input} w-56`}>
              {cls.occurrences.map((o) => <option key={o.date} value={o.date}>{formatDate(o.date)} · {o.left ? `${o.left} seat(s) left` : "Full"}</option>)}
            </select></div>
        )}
        <div><label className={ui.label}>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)} className={`${ui.input} w-32`}><option value="">All</option><option value="booked">Booked</option><option value="attended">Attended</option><option value="cancelled">Cancelled</option></select></div>
        <div className="relative min-w-[200px]"><label className={ui.label}>Search</label><Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, booking #" className={`${ui.input} pl-9`} /></div>
        <CSVLink data={csvData} filename={`bookings-${todayIST()}.csv`} className={`${ui.btn} ${csvData.length ? "" : "pointer-events-none opacity-50"}`}><Download size={14} /> Export CSV</CSVLink>
      </div>

      {cls && occ && (
        <form onSubmit={book} className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-5 gap-4 items-end`}>
          <p className={`${ui.sectionTitle} md:col-span-5`}>Book {cls.name} · {formatDate(date)} {cls.time} · {occ.booked}/{cls.maxParticipants} booked</p>
          <Field label="Phone *"><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} onBlur={lookup} className={ui.input} required /></Field>
          <Field label={found ? "Name (existing customer)" : "Name *"}><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={ui.input} required /></Field>
          {cls.pricingType === "membership" && <Field label="Membership"><input value={form.membership} onChange={(e) => setForm((f) => ({ ...f, membership: e.target.value }))} placeholder="Membership no." className={ui.input} /></Field>}
          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={ui.input} /></Field>
          <div className="flex items-center justify-end gap-3 md:col-start-5"><span className="text-xs">Price <b>{formatCurrency(price)}</b></span><button type="submit" disabled={!occ.left} className={ui.btnDark}>{occ.left ? "Book" : "Full"}</button></div>
          <p className="md:col-span-5 text-[11px] text-[#6B7280]">The price is recorded on the booking; collect payment on a sales invoice. Bookings do not post to the daybook.</p>
        </form>
      )}
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      <section className={`${ui.card} overflow-x-auto`}>
        {!bookings ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">Loading…</p> : !bookings.length ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">No bookings.</p> : (
          <table className="min-w-full border-collapse">
            <thead><tr className={ui.theadRow}><th className={ui.th}>Booking</th><th className={ui.th}>Class</th><th className={ui.th}>Day</th><th className={ui.th}>Customer</th><th className={ui.th}>Phone</th><th className={ui.thRight}>Price</th><th className={ui.th}>Status</th><th className="px-3 py-3" /></tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {bookings.map((b) => (
                <tr key={b._id}>
                  <td className={`${ui.td} font-semibold`}>{b.number}</td><td className={ui.td}>{b.className}</td><td className={`${ui.td} whitespace-nowrap`}>{formatDate(b.date)} {b.time}</td>
                  <td className={ui.td}>{b.customerName}{b.membership && <span className="block text-[10px] text-[#6B7280]">{b.membership}</span>}</td><td className={ui.td}>{b.customerPhone}</td>
                  <td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(b.price)}</td>
                  <td className={ui.td}><span className={`${ui.badge} ${STATUS_STYLE[b.status]}`}>{b.status}</span></td>
                  <td className={`${ui.td} text-right whitespace-nowrap space-x-1.5`}>
                    {b.status === "booked" && b.date <= todayIST() && <button type="button" onClick={() => setBookingStatus(b, "attended")} className={`${ui.btn} h-7`}>Attended</button>}
                    {b.status !== "cancelled" && <button type="button" onClick={() => setBookingStatus(b, "cancelled")} className={`${ui.btn} h-7`}>Cancel</button>}
                    {b.status === "cancelled" && b.date >= todayIST() && <button type="button" onClick={() => setBookingStatus(b, "booked")} className={`${ui.btn} h-7`}>Rebook</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

const Classes = () => {
  const isSidebarOpen = useSidebar();
  const { view } = useParams();
  const navigate = useNavigate();
  const store = useStoreChoice();
  if (!VIEWS.some((v) => v.key === view)) return <Navigate to="/classes/classes" replace />;
  return (
    <>
      <Header title="Classes" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div>
            <h1 className={ui.h1}>Classes</h1>
            <p className={ui.sub}>Classes and workshops, their tutors, and customer bookings. A class never takes more bookings than its maximum.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" onClick={() => navigate(`/classes/${v.key}`)}
                className={`h-8 px-3.5 text-xs font-bold uppercase tracking-wider border ${v.key === view ? "bg-[#1C1F26] text-white border-[#1C1F26]" : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F3F4F6]"}`}>{v.label}</button>
            ))}
          </div>
        </div>
        {view === "classes" && <ClassesView store={store} />}
        {view === "bookings" && <BookingsView store={store} />}
        {view === "tutors" && <TutorsView store={store} />}
      </div>
    </>
  );
};

export default Classes;
