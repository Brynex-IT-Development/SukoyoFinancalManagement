// Shared building blocks for the Manage Users pages (Add Store, Add User, Existing Users,
// Edit User, Reset Password). Ink + lime styling, same as the purchase pages.
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, X, Check, ChevronDown, Search } from "lucide-react";
import Header from "./Header";
import { useSidebar } from "../hooks/useSidebar.js";

// ── Roles ─────────────────────────────────────────────────────────────
export const ROLES = [
  { value: "store_user",      label: "Store User",      hint: "Works in one store: billing and day book." },
  { value: "store_manager",   label: "Store Manager",   hint: "Runs one store, including its reports." },
  { value: "cluster_manager", label: "Cluster Manager", hint: "Oversees several assigned stores." },
  { value: "admin",           label: "Admin",           hint: "Full access to every store and setting." },
  { value: "superadmin",      label: "Super Admin",     hint: "Full access, including approvals." },
];
export const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label || "";

// Roles that need one home store / several assigned stores.
export const SINGLE_STORE_ROLES = ["store_user", "store_manager"];
export const ADMIN_ROLES = ["admin", "superadmin"];

// Admin pages are gated on `power === "admin"`, so admin roles must always carry admin power.
export const powerForRole = (role, current = "normal") => (ADMIN_ROLES.includes(role) ? "admin" : current);

// A "store account" is the login created from Add New Store: no role, but a Loc Code.
export const isStoreAccount = (u) =>
  !u?.role && u?.power !== "admin" && !!(u?.locCode || "").toString().trim();

// ── Validation ────────────────────────────────────────────────────────
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const digitsOnly = (s) => (s || "").replace(/\D/g, "");
export const validPhone = (s) => {
  const d = digitsOnly(s);
  return d.length === 10 || (d.length === 12 && d.startsWith("91"));
};

export const passwordStrength = (pw) => {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 6) return { score: 1, label: "Too short", color: "bg-red-500" };
  const map = [
    null,
    { label: "Weak", color: "bg-red-500" },
    { label: "Fair", color: "bg-amber-500" },
    { label: "Good", color: "bg-[#A8D11E]" },
    { label: "Strong", color: "bg-emerald-500" },
  ];
  return { score, ...map[Math.max(1, score)] };
};

// ── Layout ────────────────────────────────────────────────────────────
export const PageShell = ({ title, subtitle, icon: Icon, actions, children }) => {
  const isSidebarOpen = useSidebar();
  return (
    <>
      <Header title={title} />
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className="p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[#15171D] text-[#C6F135] shrink-0">
                <Icon size={22} />
              </span>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-[#15171D]">{title}</h1>
                <p className="text-sm text-gray-500">{subtitle}</p>
              </div>
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </div>
    </>
  );
};

export const Card = ({ title, description, step, children, className = "" }) => (
  <section className={`bg-white rounded-2xl border border-gray-200/80 shadow-sm ${className}`}>
    {title && (
      <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-gray-100">
        {step != null && (
          <span className="grid place-items-center w-6 h-6 mt-0.5 rounded-full bg-[#15171D] text-[11px] font-bold text-[#C6F135] shrink-0">
            {step}
          </span>
        )}
        <div>
          <h2 className="text-[15px] font-bold tracking-tight text-[#15171D]">{title}</h2>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
    )}
    <div className="p-6">{children}</div>
  </section>
);

// ── Form fields ───────────────────────────────────────────────────────
export const inputCls = (error) =>
  `no-focus-ring w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-[#15171D] placeholder:text-gray-400 outline-none transition disabled:bg-gray-50 disabled:text-gray-500 ${
    error
      ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
      : "border-gray-200 hover:border-gray-300 focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30"
  }`;

export const Field = ({ label, required, hint, error, children, className = "" }) => (
  <div className={className}>
    <label className="block mb-1.5 text-[13px] font-semibold text-gray-700">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {children}
    {error ? (
      <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
    ) : hint ? (
      <p className="mt-1.5 text-xs text-gray-400">{hint}</p>
    ) : null}
  </div>
);

export const TextInput = ({ error, className = "", ...props }) => (
  <input autoComplete="off" {...props} className={`${inputCls(error)} ${className}`} />
);

export const TextArea = ({ error, className = "", ...props }) => (
  <textarea
    autoComplete="off"
    {...props}
    className={`${inputCls(error)} h-auto py-2.5 resize-none ${className}`}
  />
);

export const SelectInput = ({ error, children, className = "", ...props }) => (
  <div className="relative">
    <select {...props} className={`${inputCls(error)} appearance-none pr-10 cursor-pointer ${className}`}>
      {children}
    </select>
    <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
  </div>
);

export const PasswordInput = ({ value, onChange, error, placeholder, showStrength }) => {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  return (
    <>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete="new-password"
          className={`${inputCls(error)} pr-11`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="no-hover-anim absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-8 h-8 rounded-lg text-gray-400 hover:text-[#15171D] hover:bg-gray-100 transition"
          title={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showStrength && value && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 rounded-full ${i <= strength.score ? strength.color : "bg-gray-200"}`} />
            ))}
          </div>
          <span className="text-[11px] font-semibold text-gray-500 w-16 text-right">{strength.label}</span>
        </div>
      )}
    </>
  );
};

// ── Store picker (single or multi) ────────────────────────────────────
// stores: [{ locCode, locName }]; disabledCodes: Map(code -> reason)
export const StorePicker = ({ stores, value, onChange, multiple, disabledCodes, error, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selected = multiple ? value || [] : value ? [value] : [];
  const nameOf = (code) => stores.find((s) => s.locCode === code)?.locName || code;
  const t = term.trim().toLowerCase();
  const options = stores.filter(
    (s) => !t || s.locName.toLowerCase().includes(t) || String(s.locCode).includes(t)
  );

  const pick = (code) => {
    if (disabledCodes?.has(code)) return;
    if (multiple) {
      onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
    } else {
      onChange(code);
      setOpen(false);
    }
    setTerm("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls(error)} no-hover-anim flex items-center justify-between text-left h-auto min-h-11 py-1.5`}
      >
        <span className="flex flex-wrap gap-1.5 min-w-0">
          {selected.length === 0 && <span className="text-gray-400 py-1">{placeholder || "Select store"}</span>}
          {!multiple && selected[0] && (
            <span className="py-1 font-medium">
              {nameOf(selected[0])} <span className="text-gray-400 font-normal">· {selected[0]}</span>
            </span>
          )}
          {multiple &&
            selected.map((code) => (
              <span
                key={code}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-[#F6FCE6] border border-[#DEF39A] text-xs font-semibold text-[#15171D]"
              >
                {nameOf(code)}
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onChange(selected.filter((c) => c !== code)); }}
                  className="grid place-items-center w-4 h-4 rounded-full hover:bg-[#DEF39A]"
                >
                  <X size={10} />
                </span>
              </span>
            ))}
        </span>
        <ChevronDown size={16} className="text-gray-400 shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="relative border-b border-gray-100">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search store name or code..."
              className="no-focus-ring w-full h-10 pl-9 pr-3 text-sm outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {options.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No stores found.</p>}
            {options.map((s) => {
              const reason = disabledCodes?.get(s.locCode);
              const isSel = selected.includes(s.locCode);
              return (
                <button
                  type="button"
                  key={s.locCode}
                  disabled={!!reason}
                  onClick={() => pick(s.locCode)}
                  className={`no-hover-anim w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left transition ${
                    reason ? "text-gray-400 cursor-not-allowed" : isSel ? "bg-[#F6FCE6] text-[#15171D]" : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>
                    <span className="font-medium">{s.locName}</span>
                    <span className="ml-1.5 text-xs text-gray-400">{s.locCode}</span>
                  </span>
                  {reason ? (
                    <span className="text-[11px] font-medium text-amber-600">{reason}</span>
                  ) : isSel ? (
                    <Check size={15} className="text-[#15171D]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Feedback banner (replaces alert()) ────────────────────────────────
export const Notice = ({ notice, onClose }) => {
  if (!notice) return null;
  const tone =
    notice.type === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : "bg-red-50 border-red-200 text-red-700";
  return (
    <div className={`flex items-start justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${tone}`}>
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} className="no-hover-anim opacity-60 hover:opacity-100">
        <X size={15} />
      </button>
    </div>
  );
};

export const fetchJson = async (url, options) => {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, data };
};
