// Shared "record a transaction" form used by the Income and Expenses pages.
// Ink + lime styling; a sticky summary on the right shows exactly what will be saved.
import { useRef, useState } from "react";
import { Helmet } from "react-helmet";
import {
  Banknote, Landmark, Smartphone, SplitSquareHorizontal, Check, Loader2, RotateCcw, ImagePlus, X,
  Store as StoreIcon, CalendarDays, Paperclip, Search, ChevronDown,
} from "lucide-react";
import baseUrl from "../api/api";
import * as ui from "./docDetailStyles";
import { PageShell, Card, Field, TextArea, Notice, inputCls } from "./userAdminUI.jsx";
import {
  IMAGE_CONFIG, validateImageFile, validateImageDimensions, fileToBase64, getFilesFromDragEvent,
} from "../utils/imageUpload";

const METHODS = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "bank", label: "Bank", icon: Landmark },
  { id: "upi", label: "UPI", icon: Smartphone },
  { id: "split", label: "Split", icon: SplitSquareHorizontal },
];

const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Local calendar date (toISOString would give yesterday's date before 5:30 AM IST).
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── Receipt drop zone ─────────────────────────────────────────────────
const ReceiptUpload = ({ file, onChange, error }) => {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const handle = async (f) => {
    if (!f) return;
    setBusy(true);
    setMsg("");
    try {
      const v = validateImageFile(f);
      if (!v.valid) return setMsg(v.error);
      const d = await validateImageDimensions(f);
      if (!d.valid) return setMsg(d.error);
      const base64 = await fileToBase64(f);
      onChange({ base64, name: f.name, size: f.size, type: f.type });
    } catch {
      setMsg("Could not read that image.");
    } finally {
      setBusy(false);
    }
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-[#DEF39A] bg-[#F6FCE6]">
        <img src={file.base64} alt="Receipt" className="w-16 h-16 rounded-lg object-cover border border-white shadow-sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#15171D] truncate">{file.name}</p>
          <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB</p>
        </div>
        <button type="button" onClick={() => onChange(null)} className={`${ui.btnOutline} h-8`} title="Remove">
          <X size={13} /> Remove
        </button>
      </div>
    );
  }

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <>
      <div
        onDragEnter={(e) => { stop(e); setDrag(true); }}
        onDragOver={(e) => { stop(e); setDrag(true); }}
        onDragLeave={(e) => { stop(e); setDrag(false); }}
        onDrop={(e) => { stop(e); setDrag(false); handle(getFilesFromDragEvent(e)[0]); }}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 h-[148px] rounded-xl border-2 border-dashed cursor-pointer text-center px-4 transition ${
          drag ? "border-[#A8D11E] bg-[#F6FCE6]" : error ? "border-red-300 bg-red-50/40" : "border-gray-200 bg-gray-50/60 hover:border-gray-300 hover:bg-gray-50"
        }`}
      >
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-white border border-gray-200 text-[#15171D]">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
        </span>
        <p className="text-sm font-semibold text-[#15171D]">
          Drop an image or <span className="underline underline-offset-4">browse</span>
        </p>
        <p className="text-xs text-gray-400">
          JPG, PNG, GIF or WEBP · up to {IMAGE_CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>
      {(msg || error) && <p className="mt-1.5 text-xs font-medium text-red-600">{msg || error}</p>}
    </>
  );
};

// ── Searchable category picker (works for 3 or 30 categories) ────────
const CategoryPicker = ({ categories, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const ref = useRef(null);
  const current = categories.find((c) => c.value === value);
  const t = term.trim().toLowerCase();
  const list = categories.filter((c) => !t || c.label.toLowerCase().includes(t) || (c.subs || []).some((s) => s.toLowerCase().includes(t)));

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls()} no-hover-anim flex items-center justify-between text-left`}
      >
        <span className="font-medium truncate">{current?.label || "Select category"}</span>
        <ChevronDown size={16} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {categories.length > 6 && (
            <div className="relative border-b border-gray-100">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search categories..."
                className="no-focus-ring w-full h-10 pl-9 pr-3 text-sm outline-none"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {list.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No category found.</p>}
            {list.map((c) => {
              const sel = c.value === value;
              return (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => { onChange(c.value); setOpen(false); setTerm(""); }}
                  className={`no-hover-anim w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition ${
                    sel ? "bg-[#F6FCE6] text-[#15171D] font-semibold" : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>{c.label}</span>
                  {sel && <Check size={15} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main form ─────────────────────────────────────────────────────────
/**
 * props:
 *  type: "income" | "expense"
 *  title, subtitle, icon, actions
 *  categories: [{ value, label, subs?, cashOnly? }]
 *  stores / canSelectStore / defaultStore   (expense: admins pick the store)
 *  requireAttachment
 */
const TransactionEntry = ({
  type, title, subtitle, icon, actions, categories, stores = [], canSelectStore = false,
  defaultStore = "", requireAttachment = false, children,
}) => {
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem("rootfinuser")) || {}; } catch { return {}; } })();
  const isExpense = type === "expense";

  const [store, setStore] = useState(defaultStore);
  const [category, setCategory] = useState(categories[0]?.value || "");
  const cat = categories.find((c) => c.value === category) || categories[0];
  const [subCategory, setSubCategory] = useState(cat?.subs?.length === 1 ? cat.subs[0] : "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [split, setSplit] = useState({ cash: "", bank: "", upi: "" });
  const [remark, setRemark] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  const total = parseFloat(amount) || 0;
  const splitSum = ["cash", "bank", "upi"].reduce((s, k) => s + (parseFloat(split[k]) || 0), 0);
  const remaining = Math.round((total - splitSum) * 100) / 100;
  const cashOnly = !!cat?.cashOnly;
  const storeName = stores.find((s) => String(s.locCode) === String(store))?.locName || store;

  const clearErr = (...keys) => setErrors((e) => { const n = { ...e }; keys.forEach((k) => delete n[k]); return n; });

  const changeCategory = (val) => {
    const c = categories.find((x) => x.value === val);
    setCategory(val);
    setSubCategory(c?.subs?.length === 1 ? c.subs[0] : "");
    if (c?.cashOnly) setMethod("cash");
  };

  const reset = (keepNotice) => {
    setAmount(""); setSplit({ cash: "", bank: "", upi: "" }); setRemark(""); setAttachment(null);
    setMethod("cash"); setErrors({});
    changeCategory(categories[0]?.value || "");
    if (!keepNotice) setNotice(null);
  };

  const breakdown = () => {
    if (method === "split") return { cash: parseFloat(split.cash) || 0, bank: parseFloat(split.bank) || 0, upi: parseFloat(split.upi) || 0 };
    return { cash: method === "cash" ? total : 0, bank: method === "bank" ? total : 0, upi: method === "upi" ? total : 0 };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNotice(null);
    const er = {};
    if (canSelectStore && !store) er.store = "Choose a store.";
    if (!(total > 0)) er.amount = "Enter an amount greater than 0.";
    if (method === "split") {
      if (["cash", "bank", "upi"].some((k) => (parseFloat(split[k]) || 0) < 0)) er.split = "Split amounts can't be negative.";
      else if (Math.abs(remaining) > 0.009) er.split = remaining > 0 ? `${inr(remaining)} still to allocate.` : `${inr(-remaining)} more than the total.`;
    }
    if (!remark.trim()) er.remark = "Add a short note about this transaction.";
    if (requireAttachment && !attachment) er.attachment = "Attach the bill or receipt.";
    setErrors(er);
    if (Object.keys(er).length) return;

    const b = breakdown();
    const sign = isExpense ? "-" : "";
    const fmt = (n) => (n ? `${sign}${n}` : "0");
    const payload = {
      type,
      category: cat.value,
      ...(isExpense && subCategory ? { subCategory } : {}),
      remark: remark.trim(),
      locCode: canSelectStore ? store : currentUser.locCode,
      ...(isExpense ? { isAdminLevel: canSelectStore } : { quantity: "" }),
      amount: `${sign}${total}`,
      cash: fmt(b.cash),
      bank: fmt(b.bank),
      upi: fmt(b.upi),
      paymentMethod: method,
      date: todayLocal(),
      attachment: attachment?.base64 || null,
    };

    setSaving(true);
    try {
      const res = await fetch(`${baseUrl.baseUrl}user/createPayment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let json = {};
      try { json = await res.json(); } catch { /* empty */ }
      if (!res.ok) {
        setNotice({ type: "error", text: json?.message || `Could not record the ${type}.` });
      } else {
        setNotice({ type: "success", text: `${isExpense ? "Expense" : "Income"} of ${inr(total)} recorded under "${cat.label}".` });
        reset(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setNotice({ type: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const b = breakdown();
  const tone = isExpense
    ? { text: "text-red-500", soft: "bg-red-500/15 text-red-300", label: "Expense" }
    : { text: "text-[#C6F135]", soft: "bg-[#C6F135]/15 text-[#C6F135]", label: "Income" };

  return (
    <>
      <Helmet><title>{`Record ${tone.label} | RootFin`}</title></Helmet>
      <PageShell title={title} subtitle={subtitle} icon={icon} actions={actions}>
        {children}
        <form onSubmit={handleSubmit} noValidate autoComplete="off" className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <Notice notice={notice} onClose={() => setNotice(null)} />

            {/* 1. Details */}
            <Card step={1} title="Details" description={isExpense ? "What was the money spent on?" : "Where did the money come from?"}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {canSelectStore && (
                  <Field label="Store" required error={errors.store} className="md:col-span-2">
                    <div className="relative">
                      <StoreIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <select
                        value={store}
                        onChange={(e) => { setStore(e.target.value); clearErr("store"); }}
                        className={`${inputCls(errors.store)} appearance-none pl-10 pr-10 cursor-pointer`}
                      >
                        {stores.map((s) => <option key={s.locCode} value={s.locCode}>{s.locName || s.name}</option>)}
                      </select>
                      <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </Field>
                )}
                <Field label="Category" required>
                  <CategoryPicker categories={categories} value={category} onChange={changeCategory} />
                </Field>
                <Field label="Amount" required error={errors.amount}>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); clearErr("amount", "split"); }}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0.00"
                      className={`${inputCls(errors.amount)} pl-8 text-base font-semibold`}
                    />
                  </div>
                </Field>

                {cat?.subs?.length > 0 && (
                  <div className="md:col-span-2">
                    <p className="mb-2 text-[13px] font-semibold text-gray-700">
                      Sub-category {cat.subs.length > 1 && <span className="font-normal text-gray-400">· optional</span>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {cat.subs.map((s) => {
                        const on = subCategory === s;
                        return (
                          <button
                            type="button"
                            key={s}
                            onClick={() => setSubCategory(on && cat.subs.length > 1 ? "" : s)}
                            className={`no-hover-anim inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border text-xs font-semibold transition ${
                              on ? "bg-[#15171D] border-[#15171D] text-white" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                          >
                            {on && <Check size={12} className="text-[#C6F135]" />} {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* 2. Payment */}
            <Card step={2} title="Way of payment" description={cashOnly ? "This category is always settled in cash." : "How was it paid? Use Split for a mix."}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {METHODS.map(({ id, label, icon: Icon }) => {
                  const disabled = cashOnly && id !== "cash";
                  const on = method === id;
                  return (
                    <button
                      type="button"
                      key={id}
                      disabled={disabled}
                      onClick={() => { setMethod(id); clearErr("split"); }}
                      className={`no-hover-anim relative flex flex-col items-center justify-center gap-2 h-20 rounded-xl border text-sm font-semibold transition ${
                        on
                          ? "border-[#15171D] bg-[#F6FCE6] text-[#15171D] ring-2 ring-[#C6F135]/60"
                          : disabled
                            ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {on && (
                        <span className="absolute top-2 right-2 grid place-items-center w-4 h-4 rounded-full bg-[#15171D] text-[#C6F135]">
                          <Check size={10} />
                        </span>
                      )}
                      <Icon size={20} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {method === "split" && (
                <div className="mt-5 pt-5 border-t border-gray-100">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[["cash", "Cash"], ["bank", "Bank"], ["upi", "UPI"]].map(([k, lbl]) => (
                      <Field key={k} label={lbl}>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">₹</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={split[k]}
                            onChange={(e) => { setSplit((s) => ({ ...s, [k]: e.target.value })); clearErr("split"); }}
                            onWheel={(e) => e.currentTarget.blur()}
                            placeholder="0.00"
                            className={`${inputCls(errors.split)} pl-8`}
                          />
                        </div>
                      </Field>
                    ))}
                  </div>
                  <div className={`mt-3 flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm ${
                    errors.split ? "bg-red-50 text-red-700" : Math.abs(remaining) < 0.01 && total > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-600"
                  }`}>
                    <span className="font-medium">
                      {errors.split || (total <= 0 ? "Enter the total amount first." : Math.abs(remaining) < 0.01 ? "Split matches the total." : remaining > 0 ? "Left to allocate" : "Over the total by")}
                    </span>
                    {!errors.split && total > 0 && Math.abs(remaining) >= 0.01 && <span className="font-bold">{inr(Math.abs(remaining))}</span>}
                    {!errors.split && total > 0 && Math.abs(remaining) < 0.01 && <Check size={16} />}
                  </div>
                </div>
              )}
            </Card>

            {/* 3. Notes & receipt */}
            <Card step={3} title="Notes & receipt">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Remarks" required error={errors.remark}>
                  <TextArea
                    rows={6}
                    value={remark}
                    onChange={(e) => { setRemark(e.target.value); clearErr("remark"); }}
                    placeholder={isExpense ? "e.g. AC service for the billing counter, invoice #2231" : "e.g. Compensation received for cancelled order #1042"}
                    error={errors.remark}
                    className="min-h-[148px]"
                  />
                </Field>
                <Field label={requireAttachment ? "Bill / receipt" : "Attachment"} required={requireAttachment}>
                  <ReceiptUpload file={attachment} onChange={(f) => { setAttachment(f); clearErr("attachment"); }} error={errors.attachment} />
                  {!requireAttachment && !attachment && <p className="mt-1.5 text-xs text-gray-400">Optional</p>}
                </Field>
              </div>
            </Card>
          </div>

          {/* Summary */}
          <aside className="xl:sticky xl:top-20 space-y-3">
            <div className="bg-[#15171D] rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">Summary</p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${tone.soft}`}>{tone.label}</span>
              </div>
              <p className={`mt-3 text-3xl font-extrabold tracking-tight ${total > 0 ? tone.text : "text-white/30"}`}>
                {isExpense && total > 0 ? "−" : ""}{inr(total)}
              </p>
              <p className="mt-1 text-sm font-semibold truncate">{cat?.label}</p>
              {subCategory && <p className="text-xs text-white/50 truncate">{subCategory}</p>}

              <div className="mt-5 pt-4 border-t border-white/10 space-y-2.5 text-sm">
                {[["Cash", b.cash], ["Bank", b.bank], ["UPI", b.upi]].map(([lbl, v]) => (
                  <div key={lbl} className="flex items-center justify-between">
                    <span className="text-white/60">{lbl}</span>
                    <span className={v ? "font-semibold" : "text-white/30"}>{inr(v)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-white/10 space-y-2 text-xs text-white/60">
                {canSelectStore && <div className="flex items-center gap-2"><StoreIcon size={13} className="text-[#C6F135]" /> {storeName || "—"}</div>}
                <div className="flex items-center gap-2"><CalendarDays size={13} className="text-[#C6F135]" />
                  {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                </div>
                <div className="flex items-center gap-2"><Paperclip size={13} className="text-[#C6F135]" />
                  {attachment ? "Receipt attached" : requireAttachment ? "Receipt required" : "No attachment"}
                </div>
              </div>

              <button type="submit" disabled={saving} className={`${ui.btnLime} w-full h-11 mt-5 text-sm`}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {saving ? "Saving..." : `Record ${tone.label}`}
              </button>
            </div>
            <button type="button" onClick={() => reset(false)} className={`${ui.btnOutline} w-full h-10 text-sm`}>
              <RotateCcw size={14} /> Clear form
            </button>
          </aside>
        </form>
      </PageShell>
    </>
  );
};

export default TransactionEntry;
