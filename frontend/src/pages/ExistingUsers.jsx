import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Users, UserPlus, Store as StoreIcon, Search, X, ChevronDown, ChevronRight, Pencil, Trash2, Eye,
  Mail, Phone, MapPin, ShieldCheck, Hash, KeyRound, AlertTriangle, Save,
} from "lucide-react";
import baseUrl from "../api/api";
import { useActiveStores } from "../utils/storeService.js";
import * as ui from "../components/docDetailStyles";
import {
  PageShell, Field, TextInput, TextArea, SelectInput, StorePicker, Notice, fetchJson,
  ROLES, SINGLE_STORE_ROLES, ADMIN_ROLES, powerForRole, isStoreAccount, EMAIL_RE, GST_RE, validPhone,
} from "../components/userAdminUI.jsx";

// Every user belongs to exactly one group.
const GROUPS = [
  { key: "store",           label: "Store Accounts",   desc: "Store sign-ins created from Add New Store" },
  { key: "superadmin",      label: "Super Admins" },
  { key: "admin",           label: "Admins" },
  { key: "cluster_manager", label: "Cluster Managers" },
  { key: "store_manager",   label: "Store Managers" },
  { key: "store_user",      label: "Store Users" },
];

const groupOf = (u) => {
  const role = (u.role || "").toLowerCase().trim();
  if (role && GROUPS.some((g) => g.key === role)) return role;
  if (isStoreAccount(u)) return "store";
  if ((u.power || "").toLowerCase() === "admin") return "admin";
  return "store_user";
};

const currentUser = (() => {
  try { return JSON.parse(localStorage.getItem("rootfinuser")) || {}; } catch { return {}; }
})();

const Avatar = ({ name, store }) => (
  <span className={`grid place-items-center w-8 h-8 rounded-full text-xs font-bold uppercase shrink-0 ${store ? "bg-[#F6FCE6] text-[#15171D] border border-[#DEF39A]" : "bg-[#15171D] text-[#C6F135]"}`}>
    {store ? <StoreIcon size={14} /> : (name || "?").trim().charAt(0)}
  </span>
);

const AccessChip = ({ power }) =>
  power === "admin"
    ? <span className={ui.chip.brand}><ShieldCheck size={10} /> Admin</span>
    : <span className={ui.chip.neutral}>Normal</span>;

const ExistingUsers = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { stores } = useActiveStores();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [collapsed, setCollapsed] = useState({});
  const [notice, setNotice] = useState(null);

  const [viewUser, setViewUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteUser, setDeleteUser] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { ok, data } = await fetchJson(`${baseUrl.baseUrl}user/getAllUsers`);
      if (ok) setUsers(data.users || []);
      else setLoadError(data.message || "Could not load users.");
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadUsers(); }, []);

  // /manage-users/edit-user/:id redirects here with the user id to open.
  useEffect(() => {
    const id = location.state?.editId;
    if (id && users.length) {
      const u = users.find((x) => x._id === id);
      if (u) openEdit(u);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  const storeName = (code) =>
    stores.find((s) => String(s.locCode) === String(code))?.locName ||
    users.find((u) => isStoreAccount(u) && String(u.locCode) === String(code))?.username ||
    code;

  const storesOf = (u) => {
    if (u.role === "cluster_manager") return (u.allowedLocCodes || []).map(storeName);
    if (ADMIN_ROLES.includes(u.role) || (u.power === "admin" && !u.locCode)) return ["All stores"];
    return u.locCode ? [storeName(u.locCode)] : [];
  };

  const term = search.trim().toLowerCase();
  const matches = (u) =>
    !term ||
    [u.username, u.email, u.phone, u.locCode, ...storesOf(u)].some((v) => String(v || "").toLowerCase().includes(term));

  const grouped = useMemo(() => {
    const m = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
    users.forEach((u) => m[groupOf(u)].push(u));
    return m;
  }, [users]);

  const adminCount = users.filter((u) => u.power === "admin").length;
  const isSelf = (u) => !!currentUser.email && u.email === currentUser.email;
  const deleteBlockReason = (u) => {
    if (isSelf(u)) return "You can't delete the account you're signed in with.";
    if (u.power === "admin" && adminCount <= 1) return "This is the only admin. Make another admin first.";
    return "";
  };

  // ── Edit ──
  const openEdit = (u) => {
    setViewUser(null);
    setEditUser(u);
    setErrors({});
    setForm({
      kind: isStoreAccount(u) || (!u.role && !u.power) ? "store" : "user",
      role: u.role || "",
      username: u.username || "",
      email: u.email || "",
      phone: u.phone || "",
      gst: u.gst || "",
      address: u.address || "",
      locCode: u.locCode || "",
      power: u.power || "normal",
      allowedLocCodes: u.allowedLocCodes || [],
    });
  };
  const upd = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((er) => { const n = { ...er }; Object.keys(patch).forEach((k) => delete n[k]); return n; });
  };

  const clusterTaken = useMemo(() => {
    const m = new Map();
    users.forEach((u) => {
      if (u._id !== editUser?._id && u.role === "cluster_manager")
        (u.allowedLocCodes || []).forEach((c) => m.set(c, `Assigned to ${u.username}`));
    });
    return m;
  }, [users, editUser]);

  const isStoreForm = form.kind === "store";
  const formRole = isStoreForm ? "" : form.role;

  const validateEdit = () => {
    const e = {};
    const email = (form.email || "").trim();
    if (!form.username?.trim()) e.username = isStoreForm ? "Store name is required." : "Name is required.";
    if (!email) e.email = "Email is required.";
    else if (!EMAIL_RE.test(email)) e.email = "Enter a valid email address.";
    else if (users.some((u) => u._id !== editUser._id && (u.email || "").toLowerCase() === email.toLowerCase()))
      e.email = "This email is already used by another login.";
    if (form.phone?.trim() && form.phone !== editUser.phone && !validPhone(form.phone)) e.phone = "Enter a 10-digit mobile number.";
    if (isStoreForm) {
      const code = (form.locCode || "").trim();
      if (!code) e.locCode = "Loc Code is required.";
      else if (users.some((u) => u._id !== editUser._id && isStoreAccount(u) && String(u.locCode).trim() === code))
        e.locCode = "Another store already uses this Loc Code.";
      if (form.gst?.trim() && form.gst !== editUser.gst && !GST_RE.test(form.gst.trim())) e.gst = "GSTIN must be 15 characters, e.g. 32ABCDE1234F1Z5.";
    } else {
      if (!formRole) e.role = "Choose a role.";
      if (SINGLE_STORE_ROLES.includes(formRole) && !form.locCode) e.locCode = "Choose the user's store.";
      if (formRole === "cluster_manager" && form.allowedLocCodes.length === 0) e.allowedLocCodes = "Assign at least one store.";
    }
    const newPower = powerForRole(formRole, form.power);
    if (editUser.power === "admin" && newPower !== "admin") {
      if (isSelf(editUser)) e.power = "You can't remove your own admin access.";
      else if (adminCount <= 1) e.power = "This is the only admin. Make another admin first.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveEdit = async () => {
    if (!validateEdit()) return;
    const payload = {
      username: form.username.trim(),
      email: form.email.trim(),
      phone: (form.phone || "").trim(),
      gst: isStoreForm ? (form.gst || "").trim() : editUser.gst || "",
      address: isStoreForm ? (form.address || "").trim() : editUser.address || "",
      // Admins keep whatever default store they had; store roles use the picked store.
      locCode: isStoreForm
        ? form.locCode.trim()
        : SINGLE_STORE_ROLES.includes(formRole)
          ? form.locCode
          : ADMIN_ROLES.includes(formRole) ? editUser.locCode || "" : "",
      role: formRole || null,
      power: powerForRole(formRole, form.power),
      allowedLocCodes: formRole === "cluster_manager" ? form.allowedLocCodes : [],
    };
    setSaving(true);
    try {
      const { ok, data } = await fetchJson(`${baseUrl.baseUrl}user/updateUser/${editUser._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) { setErrors({ _form: data.message || "Could not save changes." }); return; }
      setNotice({ type: "success", text: `"${payload.username}" updated.` });
      setEditUser(null);
      loadUsers();
    } catch {
      setErrors({ _form: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const { ok, data } = await fetchJson(`${baseUrl.baseUrl}user/deleteUser/${deleteUser._id}`, { method: "DELETE" });
      if (!ok) { setNotice({ type: "error", text: data.message || "Could not delete the user." }); }
      else { setNotice({ type: "success", text: `"${deleteUser.username}" deleted.` }); loadUsers(); }
    } catch {
      setNotice({ type: "error", text: "Could not reach the server." });
    } finally {
      setDeleting(false);
      setDeleteUser(null);
      setEditUser(null);
      setViewUser(null);
    }
  };

  const visibleGroups = GROUPS.filter((g) => groupFilter === "all" || groupFilter === g.key);
  const totalVisible = visibleGroups.reduce((n, g) => n + grouped[g.key].filter(matches).length, 0);

  return (
    <PageShell
      title="Manage Existing Users"
      subtitle="View, edit and remove store accounts and staff logins"
      icon={Users}
      actions={
        <>
          <button type="button" onClick={() => navigate("/manage-users/add-store")} className={`${ui.btnOutline} h-10 px-4 text-sm`}>
            <StoreIcon size={15} /> Add Store
          </button>
          <button type="button" onClick={() => navigate("/manage-users/add-user")} className={`${ui.btnPrimary} h-10 px-5 text-sm`}>
            <UserPlus size={15} /> Add User
          </button>
        </>
      }
    >
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {/* Group filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {[{ key: "all", label: "All" }, ...GROUPS].map((g) => {
          const count = g.key === "all" ? users.length : grouped[g.key].length;
          const active = groupFilter === g.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroupFilter(g.key)}
              className={`no-hover-anim inline-flex items-center gap-2 h-9 px-3.5 rounded-full border text-xs font-semibold transition ${
                active ? "bg-[#15171D] border-[#15171D] text-white" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {g.label}
              <span className={`px-1.5 rounded-full text-[10px] font-bold ${active ? "bg-[#C6F135] text-[#15171D]" : "bg-gray-100 text-gray-500"}`}>{count}</span>
            </button>
          );
        })}
        <div className="relative flex items-center w-full sm:w-auto sm:ml-auto">
          <Search size={15} className="absolute left-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            autoComplete="off"
            placeholder="Search name, email, phone or store..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="no-focus-ring h-10 pl-10 pr-9 w-full sm:w-80 rounded-full border border-gray-200 bg-white text-sm text-[#15171D] placeholder:text-gray-400 outline-none transition focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="no-hover-anim absolute right-3 text-gray-400 hover:text-gray-600" title="Clear">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#15171D] border-t-transparent" />
            <p className="text-sm font-medium text-gray-500">Loading users...</p>
          </div>
        ) : loadError ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-red-600">{loadError}</p>
            <button onClick={loadUsers} className={`${ui.btnOutline} mt-4`}>Try again</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={`${ui.th} text-left`}>Name</th>
                  <th className={`${ui.th} text-left`}>Email</th>
                  <th className={`${ui.th} text-left`}>Store</th>
                  <th className={`${ui.th} text-left`}>Phone</th>
                  <th className={`${ui.th} text-left`}>Access</th>
                  <th className={`${ui.th} text-right`}>Actions</th>
                </tr>
              </thead>
              {visibleGroups.map((g) => {
                const rows = grouped[g.key].filter(matches);
                if (term && rows.length === 0) return null;
                const isOpen = !collapsed[g.key] || !!term;
                return (
                  <tbody key={g.key}>
                    <tr
                      onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                      className="cursor-pointer bg-gray-50/80 hover:bg-gray-100/70 border-t border-gray-200 select-none"
                    >
                      <td colSpan={6} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {isOpen ? <ChevronDown size={15} className="text-gray-500" /> : <ChevronRight size={15} className="text-gray-500" />}
                          <span className="text-[13px] font-bold text-[#15171D]">{g.label}</span>
                          <span className="px-1.5 rounded-full bg-white border border-gray-200 text-[10px] font-bold text-gray-500">{rows.length}</span>
                          {g.desc && <span className="text-xs text-gray-400 hidden md:inline">· {g.desc}</span>}
                        </div>
                      </td>
                    </tr>
                    {isOpen && rows.length === 0 && (
                      <tr className="border-t border-gray-100">
                        <td colSpan={6} className="px-4 py-4 pl-11 text-sm text-gray-400">No one in this group yet.</td>
                      </tr>
                    )}
                    {isOpen && rows.map((u) => {
                      const store = isStoreAccount(u);
                      const storeList = storesOf(u);
                      return (
                        <tr key={u._id} onClick={() => setViewUser(u)} className="group border-t border-gray-100 hover:bg-[#F6FCE6]/60 cursor-pointer transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={u.username} store={store} />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[#15171D] truncate">
                                  {u.username}
                                  {isSelf(u) && <span className="ml-1.5 text-[10px] font-bold uppercase text-gray-400">You</span>}
                                </p>
                                {store && <p className="text-xs text-gray-400">Loc {u.locCode}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-[240px] truncate">{u.email}</td>
                          <td className="px-4 py-3">
                            {store ? <span className="text-sm text-gray-400">—</span> : storeList.length ? (
                              <div className="flex flex-wrap gap-1">
                                {storeList.slice(0, 2).map((s) => (
                                  <span key={s} className="px-2 py-0.5 rounded-md bg-gray-100 text-xs font-semibold text-gray-700">{s}</span>
                                ))}
                                {storeList.length > 2 && <span className="text-xs font-semibold text-gray-400">+{storeList.length - 2}</span>}
                              </div>
                            ) : <span className="text-xs font-medium text-amber-600">No store</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{u.phone || "—"}</td>
                          <td className="px-4 py-3"><AccessChip power={u.power} /></td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => setViewUser(u)} className="no-hover-anim grid place-items-center w-8 h-8 rounded-lg text-gray-400 hover:text-[#15171D] hover:bg-gray-100" title="View">
                                <Eye size={15} />
                              </button>
                              <button onClick={() => openEdit(u)} className="no-hover-anim grid place-items-center w-8 h-8 rounded-lg text-gray-400 hover:text-[#15171D] hover:bg-gray-100" title="Edit">
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => setDeleteUser(u)}
                                disabled={!!deleteBlockReason(u)}
                                className="no-hover-anim grid place-items-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                                title={deleteBlockReason(u) || "Delete"}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
            {term && totalVisible === 0 && (
              <p className="py-12 text-center text-sm text-gray-400">No users match "{search}".</p>
            )}
          </div>
        )}
      </div>

      {/* ── View drawer ── */}
      {viewUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setViewUser(null)} />
          <div className="relative bg-white w-full max-w-[420px] h-full shadow-2xl flex flex-col">
            <div className="bg-[#15171D] px-6 pt-6 pb-6 text-white">
              <div className="flex items-start justify-between">
                <span className="grid place-items-center w-12 h-12 rounded-full bg-[#C6F135] text-[#15171D] text-lg font-extrabold uppercase">
                  {isStoreAccount(viewUser) ? <StoreIcon size={20} /> : (viewUser.username || "?").charAt(0)}
                </span>
                <button onClick={() => setViewUser(null)} className="no-hover-anim grid place-items-center w-8 h-8 rounded-full hover:bg-white/10 text-white/70">
                  <X size={18} />
                </button>
              </div>
              <h2 className="mt-4 text-xl font-extrabold tracking-tight">{viewUser.username}</h2>
              <p className="mt-1 text-sm text-white/60">
                {GROUPS.find((g) => g.key === groupOf(viewUser))?.label.replace(/s$/, "")}
                {" · "}{viewUser.power === "admin" ? "Admin access" : "Normal access"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {[
                [Mail, "Login email", viewUser.email],
                [Phone, "Phone", viewUser.phone],
                ...(isStoreAccount(viewUser)
                  ? [[Hash, "Loc Code", viewUser.locCode], [MapPin, "Address", viewUser.address], [ShieldCheck, "GST number", viewUser.gst]]
                  : []),
              ].map(([Icon, label, val]) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="grid place-items-center w-9 h-9 rounded-xl bg-[#F6FCE6] text-[#15171D] shrink-0"><Icon size={15} /></span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                    <p className="text-sm font-medium text-[#15171D] break-words">{val || "—"}</p>
                  </div>
                </div>
              ))}
              {!isStoreAccount(viewUser) && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Stores</p>
                  <div className="flex flex-wrap gap-1.5">
                    {storesOf(viewUser).length
                      ? storesOf(viewUser).map((s) => <span key={s} className="px-2.5 py-1 rounded-lg bg-gray-100 text-xs font-semibold text-gray-700">{s}</span>)
                      : <span className="text-sm text-amber-600">No store assigned. Edit the user to assign one.</span>}
                  </div>
                </div>
              )}
              {viewUser.createdAt && (
                <p className="text-xs text-gray-400 pt-2">Created {new Date(viewUser.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
              <button onClick={() => openEdit(viewUser)} className={`${ui.btnPrimary} h-10 flex-1 text-sm`}>
                <Pencil size={14} /> Edit
              </button>
              <button
                onClick={() => navigate("/manage-users/reset-password", { state: { userId: viewUser._id } })}
                className={`${ui.btnOutline} h-10 px-4 text-sm`}
              >
                <KeyRound size={14} /> Reset password
              </button>
              <button
                onClick={() => setDeleteUser(viewUser)}
                disabled={!!deleteBlockReason(viewUser)}
                title={deleteBlockReason(viewUser) || "Delete"}
                className={`${ui.btnDanger} h-10 w-10 px-0`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight text-[#15171D]">{isStoreForm ? "Edit store" : "Edit user"}</h2>
                <p className="text-xs text-gray-500">{editUser.email}</p>
              </div>
              <button onClick={() => setEditUser(null)} className={ui.closeBtn}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {errors._form && <Notice notice={{ type: "error", text: errors._form }} onClose={() => setErrors((e) => ({ ...e, _form: undefined }))} />}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Account type" error={errors.role}>
                  <SelectInput
                    value={isStoreForm ? "__store" : form.role}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__store") upd({ kind: "store", role: "", power: "normal", allowedLocCodes: [] });
                      else upd({
                        kind: "user",
                        role: v,
                        power: powerForRole(v, ADMIN_ROLES.includes(form.role) ? "normal" : form.power),
                        locCode: SINGLE_STORE_ROLES.includes(v) ? (stores.some((s) => s.locCode === form.locCode) ? form.locCode : "") : "",
                        allowedLocCodes: v === "cluster_manager" ? form.allowedLocCodes : [],
                      });
                    }}
                    error={errors.role}
                  >
                    {!isStoreForm && !form.role && <option value="">Select role</option>}
                    <option value="__store">Store account</option>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </SelectInput>
                </Field>
                <Field label="Access level" error={errors.power} hint={ADMIN_ROLES.includes(formRole) ? "Admin roles always have admin access." : ""}>
                  <SelectInput value={powerForRole(formRole, form.power)} onChange={(e) => upd({ power: e.target.value })} disabled={ADMIN_ROLES.includes(formRole)} error={errors.power}>
                    <option value="normal">Normal</option>
                    <option value="admin">Admin</option>
                  </SelectInput>
                </Field>
                <Field label={isStoreForm ? "Store name" : "Full name"} required error={errors.username}>
                  <TextInput value={form.username} onChange={(e) => upd({ username: e.target.value })} error={errors.username} />
                </Field>
                <Field label="Phone number" error={errors.phone}>
                  <TextInput type="tel" value={form.phone} onChange={(e) => upd({ phone: e.target.value })} placeholder="98765 43210" error={errors.phone} />
                </Field>
                <Field label="Login email" required error={errors.email} className="md:col-span-2">
                  <TextInput type="email" value={form.email} onChange={(e) => upd({ email: e.target.value })} error={errors.email} />
                </Field>

                {isStoreForm && (
                  <>
                    <Field label="Loc Code" required error={errors.locCode}>
                      <TextInput value={form.locCode} onChange={(e) => upd({ locCode: e.target.value })} error={errors.locCode} />
                    </Field>
                    <Field label="GST number" error={errors.gst}>
                      <TextInput value={form.gst} onChange={(e) => upd({ gst: e.target.value.toUpperCase() })} maxLength={15} error={errors.gst} />
                    </Field>
                    <Field label="Store address" className="md:col-span-2">
                      <TextArea rows={2} value={form.address} onChange={(e) => upd({ address: e.target.value })} />
                    </Field>
                  </>
                )}

                {SINGLE_STORE_ROLES.includes(formRole) && (
                  <Field label="Store" required error={errors.locCode} className="md:col-span-2">
                    <StorePicker stores={stores} value={form.locCode} onChange={(v) => upd({ locCode: v })} error={errors.locCode} />
                  </Field>
                )}
                {formRole === "cluster_manager" && (
                  <Field label="Assigned stores" required error={errors.allowedLocCodes} className="md:col-span-2">
                    <StorePicker multiple stores={stores} value={form.allowedLocCodes} onChange={(v) => upd({ allowedLocCodes: v })} disabledCodes={clusterTaken} error={errors.allowedLocCodes} />
                  </Field>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setDeleteUser(editUser)}
                disabled={!!deleteBlockReason(editUser)}
                title={deleteBlockReason(editUser) || "Delete"}
                className={`${ui.btnDanger} h-10 px-4 text-sm`}
              >
                <Trash2 size={14} /> Delete
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditUser(null)} className={`${ui.btnOutline} h-10 px-5 text-sm`}>Cancel</button>
                <button onClick={saveEdit} disabled={saving} className={`${ui.btnPrimary} h-10 px-5 text-sm`}>
                  <Save size={14} /> {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <span className="mx-auto grid place-items-center w-12 h-12 rounded-full bg-red-50 text-red-600"><AlertTriangle size={22} /></span>
            <h2 className="mt-4 text-lg font-extrabold tracking-tight text-[#15171D]">Delete {isStoreAccount(deleteUser) ? "store account" : "user"}?</h2>
            <p className="mt-2 text-sm text-gray-500">
              <span className="font-semibold text-[#15171D]">{deleteUser.username}</span> ({deleteUser.email}) will no longer be able to sign in. This can't be undone.
              {isStoreAccount(deleteUser) && " The store's records and stock are kept."}
            </p>
            <div className="mt-6 flex gap-2">
              <button onClick={() => setDeleteUser(null)} className={`${ui.btnOutline} h-10 flex-1 text-sm`}>Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="no-hover-anim inline-flex items-center justify-center gap-1.5 h-10 flex-1 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50">
                <Trash2 size={14} /> {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default ExistingUsers;
