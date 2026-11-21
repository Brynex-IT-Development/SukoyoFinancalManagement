import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Plus, X } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import CodeSheet from "../components/offers/CodeSheet";
import { useActiveStores } from "../utils/storeService.js";
import { api, formatDate, isAdminUser, normalizePhone, ui, voucherValueText } from "../utils/retailApi";

const EMPTY = {
  count: "1", code: "", codePrefix: "VC", name: "", kind: "discount", discountType: "percent", value: "", maxDiscount: "",
  minBillAmount: "", customerPhone: "", customerName: "", usageLimitTotal: "", usageLimitPerCustomer: "",
  validFrom: "", validTo: "", locCode: "", active: true,
};

/** Multi-pick chips from a fixed option list. */
const ChipPicker = ({ label, options, value, onChange }) => {
  const [pick, setPick] = useState("");
  return (
    <div>
      <label className={ui.label}>{label}</label>
      <div className="flex gap-1.5">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={ui.input}>
          <option value="">Choose…</option>
          {options.filter((o) => !value.includes(o)).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" className={ui.btn} disabled={!pick} onClick={() => { onChange([...value, pick]); setPick(""); }}><Plus size={13} /></button>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 bg-[#F6FCE6] border border-[#DEF39A] px-2 py-0.5 text-[11px] font-semibold">
            {v}<button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="cursor-pointer"><X size={11} /></button>
          </span>
        ))}
      </div>
    </div>
  );
};

const VoucherCreate = () => {
  const isSidebarOpen = useSidebar();
  const { stores } = useActiveStores();
  const [f, setF] = useState(EMPTY);
  const [scope, setScope] = useState({ brands: [], categories: [], subCategories: [], items: [] });
  const [options, setOptions] = useState({ brands: [], categories: [], subCategories: [] });
  const [itemQuery, setItemQuery] = useState("");
  const [itemHits, setItemHits] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const sheetRef = useRef(null);
  const print = useReactToPrint({ contentRef: sheetRef, documentTitle: result ? `Vouchers ${result.batchRef || result.vouchers[0]?.code}` : "Vouchers" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  useEffect(() => { api("/vouchers/scope-options").then(setOptions).catch(() => {}); }, []);
  useEffect(() => {
    if (itemQuery.trim().length < 2) { setItemHits([]); return; }
    const t = setTimeout(() => api("/vouchers/scope-options", { query: { itemSearch: itemQuery } }).then((d) => setItemHits(d.items || [])).catch(() => setItemHits([])), 300);
    return () => clearTimeout(t);
  }, [itemQuery]);

  if (!isAdminUser()) return <Navigate to="/offers/vouchers" />;

  const count = Math.max(1, parseInt(f.count, 10) || 1);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(Number(f.value) > 0)) return setError("Enter the voucher value.");
    if (f.customerPhone && !normalizePhone(f.customerPhone)) return setError("Customer phone number is not valid.");
    setSaving(true);
    try {
      const res = await api("/vouchers", {
        method: "POST",
        body: {
          ...f, count, code: count === 1 ? f.code : "",
          scope: { brands: scope.brands, categories: scope.categories, subCategories: scope.subCategories, itemIds: scope.items.map((i) => i.id), itemLabels: scope.items.map((i) => i.label) },
        },
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const scopeSummary = [...scope.brands, ...scope.categories, ...scope.subCategories, ...scope.items.map((i) => i.label)];
  const sheetCards = (result?.vouchers || []).map((v) => ({
    code: v.code, title: v.name || "Voucher", value: voucherValueText(v),
    lines: [
      v.minBillAmount ? `On bills of ₹${v.minBillAmount} or more` : "",
      scopeSummary.length ? `Valid on: ${scopeSummary.join(", ")}` : "Valid on all items",
      v.validTo ? `Valid till ${formatDate(v.validTo)}` : "",
      v.customerName ? `For ${v.customerName} only` : "",
    ],
  }));

  return (
    <>
      <Header title="New Voucher" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>New Voucher</h1>
              <p className={ui.sub}>Create one voucher, or a batch with unique codes.</p>
            </div>
            <Link to="/offers/vouchers" className={ui.btn}><ArrowLeft size={14} /> Vouchers</Link>
          </div>
        </div>

        <div className="px-6 py-6">
          {result ? (
            <div className={`${ui.card} max-w-3xl p-6 space-y-4`}>
              <p className="text-sm font-bold text-[#111827]">{result.vouchers.length} voucher{result.vouchers.length > 1 ? "s" : ""} created{result.batchRef ? ` · batch ${result.batchRef}` : ""}</p>
              <div className="max-h-72 overflow-y-auto border border-[#E5E7EB]">
                <table className="min-w-full text-xs"><tbody className="divide-y divide-[#F3F4F6]">
                  {result.vouchers.map((v) => (
                    <tr key={v._id}>
                      <td className="px-3 py-2"><Link to={`/offers/vouchers/${v._id}`} className="font-mono font-semibold hover:underline">{v.code}</Link></td>
                      <td className="px-3 py-2">{voucherValueText(v)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              <div className="flex gap-2.5 justify-end">
                <button type="button" className={ui.btn} onClick={() => { setResult(null); setF(EMPTY); setScope({ brands: [], categories: [], subCategories: [], items: [] }); }}><Plus size={14} /> Create more</button>
                <button type="button" className={ui.btnDark} onClick={() => print()}><Printer size={14} /> Print vouchers</button>
              </div>
              <div style={{ display: "none" }}><CodeSheet ref={sheetRef} heading={result.batchRef ? `Vouchers · ${result.batchRef}` : ""} cards={sheetCards} /></div>
            </div>
          ) : (
            <form onSubmit={submit} className={`${ui.card} max-w-4xl p-6 space-y-6`}>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className={ui.label}>Name (shown on the voucher)</label>
                  <input value={f.name} onChange={set("name")} className={ui.input} placeholder="e.g. Diwali 10% off rings" />
                </div>
                <div>
                  <label className={ui.label}>How many</label>
                  <input type="number" min="1" max="500" value={f.count} onChange={set("count")} className={ui.input} />
                </div>
                {count === 1 ? (
                  <div>
                    <label className={ui.label}>Code</label>
                    <input value={f.code} onChange={set("code")} className={ui.input} placeholder="Empty = generate" style={{ textTransform: "uppercase" }} />
                  </div>
                ) : (
                  <div>
                    <label className={ui.label}>Code prefix</label>
                    <input value={f.codePrefix} onChange={set("codePrefix")} className={ui.input} maxLength={10} style={{ textTransform: "uppercase" }} />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={ui.label}>Type</label>
                  <select value={f.kind} onChange={set("kind")} className={ui.input}>
                    <option value="discount">Discount (per use)</option>
                    <option value="value">Stored value (balance)</option>
                  </select>
                </div>
                {f.kind === "discount" && (
                  <div>
                    <label className={ui.label}>Discount</label>
                    <select value={f.discountType} onChange={set("discountType")} className={ui.input}>
                      <option value="percent">Percent %</option>
                      <option value="flat">Flat ₹</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className={ui.label}>{f.kind === "value" ? "Value (₹)" : f.discountType === "percent" ? "Percent off" : "Amount off (₹)"} <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={f.value} onChange={set("value")} className={ui.input} />
                </div>
                {f.kind === "discount" && f.discountType === "percent" && (
                  <div>
                    <label className={ui.label}>Max discount (₹)</label>
                    <input type="number" min="0" step="0.01" value={f.maxDiscount} onChange={set("maxDiscount")} className={ui.input} placeholder="No cap" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={ui.label}>Min bill (₹)</label>
                  <input type="number" min="0" value={f.minBillAmount} onChange={set("minBillAmount")} className={ui.input} placeholder="0" />
                </div>
                <div>
                  <label className={ui.label}>Total uses</label>
                  <input type="number" min="1" value={f.usageLimitTotal} onChange={set("usageLimitTotal")} className={ui.input} placeholder="Unlimited" />
                </div>
                <div>
                  <label className={ui.label}>Uses per customer</label>
                  <input type="number" min="1" value={f.usageLimitPerCustomer} onChange={set("usageLimitPerCustomer")} className={ui.input} placeholder="Unlimited" />
                </div>
                <div>
                  <label className={ui.label}>Store</label>
                  <select value={f.locCode} onChange={set("locCode")} className={ui.input}>
                    <option value="">All stores</option>
                    {(stores || []).filter((s) => s.locCode).map((s) => <option key={s.locCode} value={String(s.locCode)}>{s.locName || s.name} ({s.locCode})</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div><label className={ui.label}>Valid from</label><input type="date" value={f.validFrom} onChange={set("validFrom")} className={ui.input} /></div>
                <div><label className={ui.label}>Valid to</label><input type="date" value={f.validTo} onChange={set("validTo")} className={ui.input} /></div>
                <div>
                  <label className={ui.label}>Only for customer (phone)</label>
                  <input value={f.customerPhone} onChange={set("customerPhone")} disabled={count > 1} className={ui.input} placeholder={count > 1 ? "Single voucher only" : "Optional"} />
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-[#111827] h-9 cursor-pointer">
                  <input type="checkbox" checked={f.active} onChange={set("active")} className="w-4 h-4 accent-[#1C1F26]" /> Active
                </label>
              </div>

              <div className="border-t border-[#E5E7EB] pt-5 space-y-4">
                <div>
                  <p className={ui.sectionTitle}>Applies to</p>
                  <p className="text-[11px] text-[#6B7280] -mt-2">Leave everything empty for all items. An item qualifies if it matches any of these.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ChipPicker label="Brands" options={options.brands} value={scope.brands} onChange={(v) => setScope((s) => ({ ...s, brands: v }))} />
                  <ChipPicker label="Categories" options={options.categories} value={scope.categories} onChange={(v) => setScope((s) => ({ ...s, categories: v }))} />
                  <ChipPicker label="Sub categories" options={options.subCategories} value={scope.subCategories} onChange={(v) => setScope((s) => ({ ...s, subCategories: v }))} />
                </div>
                <div>
                  <label className={ui.label}>Specific items</label>
                  <input value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} className={ui.input} placeholder="Search item name or SKU…" />
                  {itemHits.length > 0 && (
                    <div className="border border-[#E5E7EB] max-h-44 overflow-y-auto bg-white">
                      {itemHits.filter((h) => !scope.items.some((i) => i.id === h.id)).map((h) => (
                        <button key={h.id} type="button" className="block w-full text-left px-3 py-1.5 text-xs hover:bg-[#F6FCE6] cursor-pointer"
                          onClick={() => { setScope((s) => ({ ...s, items: [...s.items, h] })); setItemQuery(""); setItemHits([]); }}>{h.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {scope.items.map((i) => (
                      <span key={i.id} className="inline-flex items-center gap-1 bg-[#F6FCE6] border border-[#DEF39A] px-2 py-0.5 text-[11px] font-semibold">
                        {i.label}<button type="button" onClick={() => setScope((s) => ({ ...s, items: s.items.filter((x) => x.id !== i.id) }))} className="cursor-pointer"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              <div className="flex justify-end gap-2.5">
                <Link to="/offers/vouchers" className={ui.btn}>Cancel</Link>
                <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Creating..." : `Create ${count} voucher${count > 1 ? "s" : ""}`}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default VoucherCreate;
