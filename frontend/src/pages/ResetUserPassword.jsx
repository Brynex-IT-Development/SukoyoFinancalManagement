import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Users, Search, X, Check, Store as StoreIcon, ShieldCheck, RotateCcw, Info } from "lucide-react";
import baseUrl from "../api/api";
import * as ui from "../components/docDetailStyles";
import {
  PageShell, Card, Field, PasswordInput, Notice, fetchJson, roleLabel, isStoreAccount, inputCls,
} from "../components/userAdminUI.jsx";

const typeOf = (u) => (isStoreAccount(u) ? `Store · ${u.locCode}` : roleLabel(u.role) || (u.power === "admin" ? "Admin" : "User"));

const ResetUserPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    fetchJson(`${baseUrl.baseUrl}user/getAllUsers`)
      .then(({ ok, data }) => {
        if (!ok) return;
        const list = data.users || [];
        setUsers(list);
        // Opened from the Existing Users drawer: preselect that user.
        const pre = location.state?.userId && list.find((u) => u._id === location.state.userId);
        if (pre) setSelected(pre);
      })
      .catch(() => setNotice({ type: "error", text: "Could not load users." }))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = useMemo(() => {
    const t = term.trim().toLowerCase();
    return users
      .filter((u) => !t || [u.username, u.email, u.locCode].some((v) => String(v || "").toLowerCase().includes(t)))
      .slice(0, 50);
  }, [users, term]);

  const choose = (u) => {
    setSelected(u);
    setTerm("");
    setOpen(false);
    setErrors((e) => ({ ...e, user: undefined }));
  };

  const clearAll = () => {
    setSelected(null); setTerm(""); setPassword(""); setConfirm(""); setErrors({});
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setNotice(null);
    const e = {};
    if (!selected) e.user = "Choose whose password to reset.";
    if (!password) e.password = "Enter a new password.";
    else if (password.length < 6) e.password = "Use at least 6 characters.";
    if (confirm !== password) e.confirm = "Passwords do not match.";
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    try {
      const { ok, data } = await fetchJson(`${baseUrl.baseUrl}user/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selected.email, newPassword: password }),
      });
      if (!ok) { setNotice({ type: "error", text: data.message || "Could not reset the password." }); return; }
      setNotice({ type: "success", text: `Password updated for ${selected.username} (${selected.email}). Share the new password with them securely.` });
      clearAll();
    } catch {
      setNotice({ type: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Reset User Password"
      subtitle="Set a new password for any store account or staff login"
      icon={KeyRound}
      actions={
        <button type="button" onClick={() => navigate("/manage-users/existing-users")} className={`${ui.btnOutline} h-10 px-4 text-sm`}>
          <Users size={15} /> Existing Users
        </button>
      }
    >
      <form onSubmit={handleSubmit} autoComplete="off" noValidate className="max-w-2xl space-y-5">
        <Notice notice={notice} onClose={() => setNotice(null)} />

        <Card step={1} title="Choose the account" description="Search by name, email or Loc Code.">
          {selected ? (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-[#DEF39A] bg-[#F6FCE6]">
              <span className="grid place-items-center w-10 h-10 rounded-full bg-[#15171D] text-[#C6F135] text-sm font-bold uppercase shrink-0">
                {isStoreAccount(selected) ? <StoreIcon size={16} /> : (selected.username || "?").charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#15171D] truncate">{selected.username}</p>
                <p className="text-xs text-gray-600 truncate">{selected.email} · {typeOf(selected)}</p>
              </div>
              {selected.power === "admin" && <span className={ui.chip.brand}><ShieldCheck size={10} /> Admin</span>}
              <button type="button" onClick={() => setSelected(null)} className={`${ui.btnOutline} h-8`}>Change</button>
            </div>
          ) : (
            <div ref={boxRef} className="relative">
              <Search size={15} className="absolute left-3.5 top-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={term}
                onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder={loading ? "Loading users..." : "Type a name, email or Loc Code..."}
                autoComplete="off"
                name="reset-user-search"
                className={`${inputCls(errors.user)} pl-10 pr-9`}
              />
              {term && (
                <button type="button" onClick={() => setTerm("")} className="no-hover-anim absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"><X size={15} /></button>
              )}
              {open && !loading && (
                <div className="absolute z-30 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-y-auto py-1">
                  {results.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No account matches "{term}".</p>}
                  {results.map((u) => (
                    <button
                      type="button"
                      key={u._id}
                      onClick={() => choose(u)}
                      className="no-hover-anim w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition"
                    >
                      <span className="grid place-items-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-xs font-bold uppercase shrink-0">
                        {isStoreAccount(u) ? <StoreIcon size={14} /> : (u.username || "?").charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[#15171D] truncate">{u.username}</span>
                        <span className="block text-xs text-gray-500 truncate">{u.email}</span>
                      </span>
                      <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">{typeOf(u)}</span>
                    </button>
                  ))}
                </div>
              )}
              {errors.user && <p className="mt-1.5 text-xs font-medium text-red-600">{errors.user}</p>}
            </div>
          )}
        </Card>

        <Card step={2} title="New password" description="The old password stops working immediately.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="New password" required error={errors.password}>
              <PasswordInput value={password} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }} placeholder="At least 6 characters" error={errors.password} showStrength />
            </Field>
            <Field label="Confirm password" required error={errors.confirm}>
              <PasswordInput value={confirm} onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }} placeholder="Re-enter password" error={errors.confirm} />
            </Field>
          </div>
          {confirm && password && confirm === password && password.length >= 6 && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><Check size={13} /> Passwords match</p>
          )}
          <div className="mt-5 flex items-start gap-2 p-3 rounded-xl bg-gray-50 text-xs text-gray-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            Only admins can open this page. Tell the user their new password in person or over a private channel.
          </div>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={clearAll} className={`${ui.btnOutline} h-11 px-5 text-sm`}>
            <RotateCcw size={15} /> Clear
          </button>
          <button type="submit" disabled={saving} className={`${ui.btnPrimary} h-11 px-6 text-sm`}>
            <KeyRound size={15} /> {saving ? "Updating..." : "Reset Password"}
          </button>
        </div>
      </form>
    </PageShell>
  );
};

export default ResetUserPassword;
