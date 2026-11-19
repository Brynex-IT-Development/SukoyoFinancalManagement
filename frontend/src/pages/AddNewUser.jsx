import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, Users, Save, RotateCcw, ShieldCheck, Store as StoreIcon, Check } from "lucide-react";
import baseUrl from "../api/api";
import { useActiveStores } from "../utils/storeService.js";
import * as ui from "../components/docDetailStyles";
import {
  PageShell, Card, Field, TextInput, SelectInput, PasswordInput, StorePicker, Notice, fetchJson,
  ROLES, SINGLE_STORE_ROLES, ADMIN_ROLES, powerForRole, roleLabel, EMAIL_RE, validPhone,
} from "../components/userAdminUI.jsx";

const EMPTY = { role: "", username: "", email: "", phone: "", power: "normal", locCode: "", allowedLocCodes: [], password: "", confirm: "" };

const AddNewUser = () => {
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

  // A store can belong to only one cluster manager.
  const clusterTaken = useMemo(() => {
    const m = new Map();
    users.forEach((u) => {
      if ((u.role || "").toLowerCase() === "cluster_manager")
        (u.allowedLocCodes || []).forEach((c) => m.set(c, `Assigned to ${u.username}`));
    });
    return m;
  }, [users]);

  const update = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((er) => {
      const next = { ...er };
      Object.keys(patch).forEach((k) => delete next[k]);
      return next;
    });
  };
  const set = (key) => (e) => update({ [key]: e.target.value });

  const changeRole = (role) =>
    update({
      role,
      power: powerForRole(role, ADMIN_ROLES.includes(form.role) ? "normal" : form.power),
      locCode: SINGLE_STORE_ROLES.includes(role) ? form.locCode : "",
      allowedLocCodes: role === "cluster_manager" ? form.allowedLocCodes : [],
    });

  const needsStore = SINGLE_STORE_ROLES.includes(form.role);
  const isCluster = form.role === "cluster_manager";
  const isAdminRole = ADMIN_ROLES.includes(form.role);

  const validate = () => {
    const e = {};
    if (!form.role) e.role = "Choose a role.";
    if (!form.username.trim()) e.username = "Name is required.";
    if (!form.email.trim()) e.email = "Email is required. It is used to sign in.";
    else if (!EMAIL_RE.test(form.email.trim())) e.email = "Enter a valid email address.";
    else if (users.some((u) => (u.email || "").toLowerCase() === form.email.trim().toLowerCase()))
      e.email = "This email is already used by another login.";
    if (form.phone.trim() && !validPhone(form.phone)) e.phone = "Enter a 10-digit mobile number.";
    if (needsStore && !form.locCode) e.locCode = "Choose the store this user works in.";
    if (isCluster && form.allowedLocCodes.length === 0) e.allowedLocCodes = "Assign at least one store.";
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
      username: form.username.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
      power: powerForRole(form.role, form.power),
      locCode: needsStore ? form.locCode : "",
      allowedLocCodes: isCluster ? form.allowedLocCodes : [],
      password: form.password,
    };

    setSaving(true);
    try {
      const { ok, data } = await fetchJson(`${baseUrl.baseUrl}user/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) {
        setNotice({ type: "error", text: data.message || "Could not create the user." });
        return;
      }
      setNotice({ type: "success", text: `${roleLabel(payload.role)} "${payload.username}" created. They can sign in with ${payload.email}.` });
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
  const storeName = (code) => stores.find((s) => s.locCode === code)?.locName || code;

  return (
    <PageShell
      title="Add New User"
      subtitle="Create a staff login and choose what they can access"
      icon={UserPlus}
      actions={
        <button type="button" onClick={() => navigate("/manage-users/existing-users")} className={`${ui.btnOutline} h-10 px-4 text-sm`}>
          <Users size={15} /> Existing Users
        </button>
      }
    >
      <form onSubmit={handleSubmit} autoComplete="off" noValidate className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Notice notice={notice} onClose={() => setNotice(null)} />

          <Card step={1} title="Role" description="The role decides which pages and stores this user can open.">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ROLES.map((r) => {
                const active = form.role === r.value;
                return (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => changeRole(r.value)}
                    className={`no-hover-anim flex flex-col items-stretch justify-start text-left p-4 rounded-xl border transition ${
                      active ? "border-[#15171D] bg-[#F6FCE6] ring-2 ring-[#C6F135]/60" : "border-gray-200 hover:border-gray-300 bg-white"
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#15171D]">{r.label}</span>
                      <span className={`grid place-items-center w-5 h-5 rounded-full border ${active ? "bg-[#15171D] border-[#15171D] text-[#C6F135]" : "border-gray-300"}`}>
                        {active && <Check size={12} />}
                      </span>
                    </span>
                    <span className="mt-1 text-xs text-gray-500">{r.hint}</span>
                  </button>
                );
              })}
            </div>
            {errors.role && <p className="mt-3 text-xs font-medium text-red-600">{errors.role}</p>}

            {(needsStore || isCluster) && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                {needsStore ? (
                  <Field label="Store" required error={errors.locCode} hint="The user only sees this store's data.">
                    <StorePicker stores={stores} value={form.locCode} onChange={(v) => update({ locCode: v })} error={errors.locCode} placeholder="Select the user's store" />
                  </Field>
                ) : (
                  <Field label="Assigned stores" required error={errors.allowedLocCodes} hint="Each store can have one cluster manager.">
                    <StorePicker multiple stores={stores} value={form.allowedLocCodes} onChange={(v) => update({ allowedLocCodes: v })} disabledCodes={clusterTaken} error={errors.allowedLocCodes} placeholder="Select stores" />
                  </Field>
                )}
              </div>
            )}
          </Card>

          <Card step={2} title="Profile" description="Basic details shown in user lists.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Full name" required error={errors.username}>
                <TextInput value={form.username} onChange={set("username")} placeholder="e.g. Anjali Nair" error={errors.username} />
              </Field>
              <Field label="Phone number" error={errors.phone} hint="Optional">
                <TextInput type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} placeholder="98765 43210" error={errors.phone} />
              </Field>
              <Field
                label="Access level"
                className="md:col-span-2"
                hint={isAdminRole ? "Admin roles always have admin access." : "Admin access opens Manage Users and the settings pages."}
              >
                <SelectInput value={powerForRole(form.role, form.power)} onChange={set("power")} disabled={isAdminRole}>
                  <option value="normal">Normal</option>
                  <option value="admin">Admin</option>
                </SelectInput>
              </Field>
            </div>
          </Card>

          <Card step={3} title="Sign-in" description="The user signs in with this email and password.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Login email" required error={errors.email} className="md:col-span-2">
                <TextInput type="email" name="new-user-email" value={form.email} onChange={set("email")} placeholder="e.g. anjali@yourstore.com" error={errors.email} />
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
              <Save size={15} /> {saving ? "Creating user..." : "Create User"}
            </button>
          </div>
        </div>

        {/* Summary */}
        <aside className="xl:sticky xl:top-20">
          <div className="bg-[#15171D] rounded-2xl p-5 text-white">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#C6F135]">Summary</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid place-items-center w-11 h-11 rounded-full bg-[#C6F135] text-[#15171D] text-base font-extrabold uppercase">
                {(form.username.trim() || "?").charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="font-bold truncate">{form.username.trim() || "New user"}</p>
                <p className="text-xs text-white/60 truncate">{form.email.trim() || "No email yet"}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Role</span>
                <span className="font-semibold">{roleLabel(form.role) || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60 inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Access</span>
                <span className="font-semibold capitalize">{powerForRole(form.role, form.power)}</span>
              </div>
              <div>
                <span className="text-white/60 inline-flex items-center gap-1.5"><StoreIcon size={13} /> Stores</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {isAdminRole && <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-semibold">All stores</span>}
                  {needsStore && form.locCode && <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-semibold">{storeName(form.locCode)}</span>}
                  {isCluster && form.allowedLocCodes.map((c) => (
                    <span key={c} className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-semibold">{storeName(c)}</span>
                  ))}
                  {!isAdminRole && !form.locCode && form.allowedLocCodes.length === 0 && <span className="text-xs text-white/40">None selected</span>}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </form>
    </PageShell>
  );
};

export default AddNewUser;
