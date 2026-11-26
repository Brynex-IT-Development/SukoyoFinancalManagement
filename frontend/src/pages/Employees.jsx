import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, UserX, UserCheck, X, Search } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { StoreSelect, useStoreChoice } from "../components/payables/VendorReportKit";
import { api, formatDate, ui } from "../utils/retailApi";

// Staff: add / edit / deactivate employees. Employees are SalesPerson records,
// so they appear in the billing salesperson list and on the attendance screens.

// The billing screen stores dummy values for fields it does not ask for; show them as blank.
const clean = (sp) => ({
  name: [sp.firstName, sp.lastName && sp.lastName !== "-" ? sp.lastName : ""].filter(Boolean).join(" "),
  phone: sp.phone && sp.phone !== "0000000000" ? sp.phone : "",
  email: sp.email && !/@placeholder\.com$/i.test(sp.email) ? sp.email : "",
});

const EMPTY = { name: "", employeeId: "", position: "Sales Person", phone: "", email: "", hireDate: "", locCode: "" };
const POSITIONS = ["Sales Person", "Store Manager", "Cashier", "Accountant", "Helper", "Other"];

const Msg = ({ children, tone = "muted" }) => (
  <p className={`px-8 py-16 text-center text-xs ${tone === "error" ? "font-semibold text-red-500" : "text-[#6B7280]"}`}>{children}</p>
);

const EmployeeForm = ({ initial, editing, store, onClose, onSaved }) => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const employeeId = form.employeeId.trim();
    if (!name || !employeeId) { setError("Name and employee ID are required."); return; }
    if (form.phone && !/^\d{10}$/.test(form.phone.trim())) { setError("Phone must be 10 digits."); return; }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError("Enter a valid email address."); return; }
    const storeOpt = store.options.find((o) => o.value === form.locCode);
    const body = {
      firstName: name,
      lastName: "-",
      employeeId,
      position: form.position.trim() || "Sales Person",
      phone: form.phone.trim() || "0000000000",
      email: form.email.trim() || `${employeeId}@placeholder.com`,
      locCode: form.locCode,
      storeName: storeOpt?.label || form.locCode,
      ...(form.hireDate ? { hireDate: form.hireDate } : {}),
    };
    setSaving(true);
    setError("");
    try {
      if (editing) await api(`/sales-persons/${editing}`, { method: "PUT", body });
      else await api("/sales-persons", { method: "POST", body });
      onSaved(editing ? `${name} updated.` : `${name} added.`);
    } catch (err) {
      setError(err.data?.errors || err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className={`${ui.card} w-full max-w-lg`}>
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#111827]">{editing ? "Edit employee" : "Add employee"}</h2>
          <button type="button" onClick={onClose} className="text-[#6B7280] hover:text-[#111827]"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className={ui.label}>Full name *</label><input autoFocus value={form.name} onChange={set("name")} className={ui.input} placeholder="e.g. Anjali Menon" /></div>
          <div><label className={ui.label}>Employee ID *</label><input value={form.employeeId} onChange={set("employeeId")} className={ui.input} placeholder="e.g. EMP001" /></div>
          <div>
            <label className={ui.label}>Position</label>
            <input list="employee-positions" value={form.position} onChange={set("position")} className={ui.input} />
            <datalist id="employee-positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div><label className={ui.label}>Phone</label><input value={form.phone} onChange={set("phone")} inputMode="numeric" maxLength={10} className={ui.input} placeholder="10-digit mobile" /></div>
          <div><label className={ui.label}>Email</label><input type="email" value={form.email} onChange={set("email")} className={ui.input} /></div>
          <div>
            <label className={ui.label}>Store *</label>
            <select value={form.locCode} onChange={set("locCode")} disabled={!store.canChoose} className={ui.input}>
              {store.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div><label className={ui.label}>Joining date</label><input type="date" value={form.hireDate} onChange={set("hireDate")} className={ui.input} /></div>
        </div>
        {error && <p className="px-5 pb-2 text-xs font-semibold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-3">
          <button type="button" onClick={onClose} className={ui.btn}>Cancel</button>
          <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving…" : editing ? "Save changes" : "Add employee"}</button>
        </div>
      </form>
    </div>
  );
};

const Employees = () => {
  const isSidebarOpen = useSidebar();
  const store = useStoreChoice({ allowAll: false });
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(null); // { initial, editing }

  const load = useCallback(async () => {
    if (!store.locCode) return;
    setError("");
    try {
      const d = await api("/sales-persons", { query: { locCode: store.locCode } });
      setList(d.salesPersons || []);
    } catch (e) { setError(e.message); setList([]); }
  }, [store.locCode]);
  useEffect(() => { setList(null); setNotice(""); load(); }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list || [])
      .filter((sp) => showInactive || sp.isActive !== false)
      .filter((sp) => !q || [clean(sp).name, sp.employeeId, sp.position, clean(sp).phone].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [list, search, showInactive]);
  const inactiveCount = (list || []).filter((sp) => sp.isActive === false).length;

  const openAdd = () => setForm({ initial: { ...EMPTY, locCode: store.locCode }, editing: null });
  const openEdit = (sp) => {
    const c = clean(sp);
    setForm({
      editing: sp._id,
      initial: {
        name: c.name, employeeId: sp.employeeId || "", position: sp.position || "", phone: c.phone, email: c.email,
        hireDate: sp.hireDate ? new Date(sp.hireDate).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "",
        locCode: sp.locCode || store.locCode,
      },
    });
  };

  const setActive = async (sp, active) => {
    const name = clean(sp).name;
    if (!active && !confirm(`Deactivate ${name}? They will disappear from billing and attendance marking. Past records are kept.`)) return;
    setError("");
    try {
      if (active) await api(`/sales-persons/${sp._id}`, { method: "PUT", body: { isActive: true } });
      else await api(`/sales-persons/${sp._id}`, { method: "DELETE" });
      setNotice(active ? `${name} reactivated.` : `${name} deactivated.`);
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <Header title="Employees" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Employees</h1>
              <p className={ui.sub}>Employees added here appear in the billing salesperson list and on <Link to="/staff/attendance/mark" className="underline">attendance</Link>.</p>
            </div>
            <button type="button" onClick={openAdd} disabled={!store.locCode} className={ui.btnDark}><Plus size={14} /> Add employee</button>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div className="relative">
            <label className={ui.label}>Search</label>
            <Search size={13} className="absolute left-2.5 bottom-3 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, ID, position, phone" className={`${ui.input} w-60 pl-7`} />
          </div>
          <label className="flex h-9 items-center gap-2 text-xs text-[#374151]">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive{inactiveCount ? ` (${inactiveCount})` : ""}
          </label>
        </div>

        <div className="px-6 pb-8 pt-2 space-y-3">
          {notice && <p className="text-xs font-semibold text-[#15803d]">{notice}</p>}
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          <section className={`${ui.card} overflow-x-auto`}>
            {!store.locCode ? <Msg>Choose a store.</Msg> : list === null ? <Msg>Loading…</Msg> : !rows.length ? (
              <Msg>{list.length ? "No employees match." : "No employees in this store yet. Click “Add employee” to add one."}</Msg>
            ) : (
              <table className="min-w-full border-collapse">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Name</th><th className={ui.th}>Employee ID</th><th className={ui.th}>Position</th>
                  <th className={ui.th}>Phone</th><th className={ui.th}>Email</th><th className={ui.th}>Joined</th>
                  <th className={ui.th}>Status</th><th className="px-3 py-3 text-right">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {rows.map((sp) => {
                    const c = clean(sp);
                    const active = sp.isActive !== false;
                    return (
                      <tr key={sp._id} className={active ? "" : "bg-[#F9FAFB] text-[#6B7280]"}>
                        <td className={`${ui.td} font-semibold whitespace-nowrap`}>{c.name}</td>
                        <td className={ui.td}>{sp.employeeId}</td>
                        <td className={ui.td}>{sp.position || ""}</td>
                        <td className={`${ui.td} tabular-nums`}>{c.phone}</td>
                        <td className={ui.td}>{c.email}</td>
                        <td className={`${ui.td} whitespace-nowrap`}>{sp.hireDate ? formatDate(sp.hireDate) : ""}</td>
                        <td className={ui.td}>
                          <span className={`${ui.badge} ${active ? "bg-[#DCFCE7] text-[#15803d] border-[#BBF7D0]" : "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]"}`}>{active ? "Active" : "Inactive"}</span>
                        </td>
                        <td className={`${ui.td} text-right whitespace-nowrap`}>
                          <button type="button" onClick={() => openEdit(sp)} className="inline-flex items-center gap-1 px-2 text-[#374151] hover:text-[#111827]"><Pencil size={13} /> Edit</button>
                          {active
                            ? <button type="button" onClick={() => setActive(sp, false)} className="inline-flex items-center gap-1 px-2 text-red-600 hover:text-red-700"><UserX size={13} /> Deactivate</button>
                            : <button type="button" onClick={() => setActive(sp, true)} className="inline-flex items-center gap-1 px-2 text-[#15803d] hover:text-[#166534]"><UserCheck size={13} /> Reactivate</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      {form && (
        <EmployeeForm
          initial={form.initial}
          editing={form.editing}
          store={store}
          onClose={() => setForm(null)}
          onSaved={(msg) => { setForm(null); setNotice(msg); load(); }}
        />
      )}
    </>
  );
};

export default Employees;
