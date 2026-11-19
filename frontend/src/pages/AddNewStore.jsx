import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store, Users, Save, RotateCcw, MapPin, Mail, Phone, Hash, KeyRound } from "lucide-react";
import baseUrl from "../api/api";
import { useActiveStores, fetchActiveStores, saveCustomStore } from "../utils/storeService.js";
import * as ui from "../components/docDetailStyles";
import {
  PageShell, Card, Field, TextInput, TextArea, PasswordInput, Notice, fetchJson,
  EMAIL_RE, GST_RE, validPhone, isStoreAccount,
} from "../components/userAdminUI.jsx";

const EMPTY = { name: "", email: "", phone: "", gst: "", locCode: "", address: "", password: "", confirm: "" };

const AddNewStore = () => {
  const navigate = useNavigate();
  const { stores } = useActiveStores();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadUsers = () =>
    fetchJson(`${baseUrl.baseUrl}user/getAllUsers`).then(({ ok, data }) => ok && setUsers(data.users || []));
  useEffect(() => { loadUsers(); }, []);

  const set = (key) => (e) => {
    const v = key === "gst" ? e.target.value.toUpperCase() : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  // Loc Codes already used by another store (store list + existing store logins)
  const usedCodes = new Map();
  stores.forEach((s) => usedCodes.set(String(s.locCode).trim(), s.locName));
  users.filter(isStoreAccount).forEach((u) => usedCodes.set(String(u.locCode).trim(), u.username));

  const validate = () => {
    const e = {};
    const code = form.locCode.trim();
    if (!form.name.trim()) e.name = "Store name is required.";
    if (!code) e.locCode = "Loc Code is required.";
    else if (!/^[A-Za-z0-9-]+$/.test(code)) e.locCode = "Use letters, numbers or '-' only.";
    else if (usedCodes.has(code)) e.locCode = `Already used by "${usedCodes.get(code)}".`;
    if (!form.email.trim()) e.email = "Email is required. It is the store's login.";
    else if (!EMAIL_RE.test(form.email.trim())) e.email = "Enter a valid email address.";
    else if (users.some((u) => (u.email || "").toLowerCase() === form.email.trim().toLowerCase()))
      e.email = "This email is already used by another login.";
    if (form.phone.trim() && !validPhone(form.phone)) e.phone = "Enter a 10-digit mobile number.";
    if (form.gst.trim() && !GST_RE.test(form.gst.trim())) e.gst = "GSTIN must be 15 characters, e.g. 32ABCDE1234F1Z5.";
    if (!form.password) e.password = "Password is required.";
    else if (form.password.length < 6) e.password = "Use at least 6 characters.";
    if (form.confirm !== form.password) e.confirm = "Passwords do not match.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setNotice(null);
    if (!validate()) return;

    const payload = {
      username: form.name.trim(),
      email: form.email.trim(),
      locCode: form.locCode.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      gst: form.gst.trim(),
      power: "normal",
      password: form.password,
    };

    setSaving(true);
    try {
      // The backend creates the store login AND the Store record in one call.
      const { ok, data } = await fetchJson(`${baseUrl.baseUrl}user/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) {
        setNotice({ type: "error", text: data.message || "Could not create the store." });
        return;
      }
      saveCustomStore({
        locName: payload.username, locCode: payload.locCode, name: payload.username,
        address: payload.address, phone: payload.phone, email: payload.email,
      });
      try { await fetchActiveStores(); } catch { /* list refreshes on next load */ }
      setNotice({ type: "success", text: `Store "${payload.username}" (${payload.locCode}) created. It can now sign in with ${payload.email}.` });
      setForm(EMPTY);
      setErrors({});
      loadUsers();
    } catch {
      setNotice({ type: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => { setForm(EMPTY); setErrors({}); setNotice(null); };

  return (
    <PageShell
      title="Add New Store"
      subtitle="Create a store location and its sign-in account"
      icon={Store}
      actions={
        <button type="button" onClick={() => navigate("/manage-users/existing-users")} className={`${ui.btnOutline} h-10 px-4 text-sm`}>
          <Users size={15} /> Existing Users
        </button>
      }
    >
      <form onSubmit={handleSubmit} autoComplete="off" noValidate className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Notice notice={notice} onClose={() => setNotice(null)} />

          <Card step={1} title="Store details" description="How the store appears across reports, bills and stock.">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field label="Store name" required error={errors.name} className="md:col-span-2">
                <TextInput value={form.name} onChange={set("name")} placeholder="e.g. Kakkanad Branch" error={errors.name} />
              </Field>
              <Field label="Loc Code" required error={errors.locCode} hint="Unique code used for stock and reports.">
                <TextInput value={form.locCode} onChange={set("locCode")} placeholder="e.g. 105" error={errors.locCode} />
              </Field>
              <Field label="Store address" error={errors.address} className="md:col-span-3">
                <TextArea rows={2} value={form.address} onChange={set("address")} placeholder="Building, street, city, PIN code" />
              </Field>
              <Field label="Phone number" error={errors.phone}>
                <TextInput type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} placeholder="98765 43210" error={errors.phone} />
              </Field>
              <Field label="GST number" error={errors.gst} hint="Optional" className="md:col-span-2">
                <TextInput value={form.gst} onChange={set("gst")} placeholder="e.g. 32ABCDE1234F1Z5" maxLength={15} error={errors.gst} />
              </Field>
            </div>
          </Card>

          <Card step={2} title="Store sign-in" description="Staff at this store sign in with this email and password.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Login email" required error={errors.email} className="md:col-span-2">
                <TextInput type="email" name="store-login-email" value={form.email} onChange={set("email")} placeholder="e.g. kakkanad@yourstore.com" error={errors.email} />
              </Field>
              <Field label="Password" required error={errors.password}>
                <PasswordInput value={form.password} onChange={set("password")} placeholder="At least 6 characters" error={errors.password} showStrength />
              </Field>
              <Field label="Confirm password" required error={errors.confirm}>
                <PasswordInput value={form.confirm} onChange={set("confirm")} placeholder="Re-enter password" error={errors.confirm} />
              </Field>
            </div>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={reset} className={`${ui.btnOutline} h-11 px-5 text-sm`}>
              <RotateCcw size={15} /> Clear
            </button>
            <button type="submit" disabled={saving} className={`${ui.btnPrimary} h-11 px-6 text-sm`}>
              <Save size={15} /> {saving ? "Creating store..." : "Create Store"}
            </button>
          </div>
        </div>

        {/* Summary */}
        <aside className="xl:sticky xl:top-20 space-y-4">
          <div className="bg-[#15171D] rounded-2xl p-5 text-white">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#C6F135]">Preview</p>
            <p className="mt-2 text-lg font-extrabold tracking-tight truncate">{form.name.trim() || "New store"}</p>
            <div className="mt-4 space-y-2.5 text-sm">
              {[
                [Hash, form.locCode.trim() || "—"],
                [Mail, form.email.trim() || "—"],
                [Phone, form.phone.trim() || "—"],
                [MapPin, form.address.trim() || "—"],
              ].map(([Icon, text], i) => (
                <div key={i} className="flex items-start gap-2.5 text-white/80">
                  <Icon size={14} className="mt-0.5 text-[#C6F135] shrink-0" />
                  <span className="break-words min-w-0">{text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={15} className="text-[#15171D]" />
              <p className="text-sm font-bold text-[#15171D]">Existing stores</p>
              <span className="ml-auto text-xs font-semibold text-gray-400">{usedCodes.size}</span>
            </div>
            <div className="max-h-56 overflow-y-auto -mx-1">
              {[...usedCodes.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => (
                <div key={code} className="flex items-center justify-between px-1 py-1.5 text-sm">
                  <span className="text-gray-700 truncate">{name}</span>
                  <span className="text-xs font-semibold text-gray-400">{code}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </form>
    </PageShell>
  );
};

export default AddNewStore;
