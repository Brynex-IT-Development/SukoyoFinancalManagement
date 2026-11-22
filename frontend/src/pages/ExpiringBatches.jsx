import { useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { Search, Scale } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, isAdminUser, ui } from "../utils/retailApi";

const DAY_CHOICES = [7, 30, 60, 90];

// F18: batches of batch-managed items expiring within N days (optionally the expired ones too).
const ExpiringBatches = () => {
  const isSidebarOpen = useSidebar();
  const admin = isAdminUser();
  const store = useStoreChoice();
  const [days, setDays] = useState(30);
  const [customDays, setCustomDays] = useState("");
  const [includeExpired, setIncludeExpired] = useState(true);
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: "Expiring batches", pageStyle: PRINT_PAGE_STYLE });
  const effectiveDays = days === "custom" ? (customDays === "" ? -1 : Number(customDays)) : days;

  useEffect(() => {
    if (!(effectiveDays >= 0)) return undefined;
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      api("/batches/expiring", { query: { ...store.query, days: effectiveDays, includeExpired: includeExpired ? "1" : "", search } })
        .then((d) => active && setData(d))
        .catch((e) => { if (active) { setError(e.message); setData(null); } })
        .finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [store.query.locCode, effectiveDays, includeExpired, search, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reconcile = async () => {
    setNotice("");
    try { const r = await api("/batches/reconcile", { method: "POST" }); setNotice(r.message); setReloadKey((k) => k + 1); }
    catch (e) { setError(e.message); }
  };

  const rows = useMemo(() => data?.rows || [], [data]);
  const t = data?.totals;
  const csvData = useMemo(() => rows.map((r) => ({
    Item: r.itemName, SKU: r.sku, Batch: r.batchNo, Warehouse: r.warehouse, Qty: r.qty, "Mfg date": r.mfgDate || "", "Expiry date": r.expDate,
    "Days left": r.daysLeft, Status: r.expired ? "Expired" : "Expiring", "Unit cost": r.unitCost, Value: r.value,
  })), [rows]);

  return (
    <>
      <Header title="Expiring Batches" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Expiring Batches</h1>
              <p className={ui.sub}>Batches of batch-managed items that expire soon. Expired batches cannot be sold at billing.</p>
            </div>
            <div className="flex items-center gap-2.5">
              {admin && <button type="button" onClick={reconcile} className={ui.btn} title="Match every batch-managed item's batches to its stock"><Scale size={14} /> Check batches against stock</button>}
              <ReportActions csvData={csvData} csvName="expiring-batches" onPrint={() => print()} disabled={!rows.length} />
            </div>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px]">
            <label className={ui.label}>Search</label>
            <Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item, SKU or batch" className={`${ui.input} pl-9`} />
          </div>
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div>
            <label className={ui.label}>Expiring within</label>
            <select value={days} onChange={(e) => setDays(e.target.value === "custom" ? "custom" : Number(e.target.value))} className={`${ui.input} w-32`}>
              {DAY_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
              <option value="custom">Custom…</option>
            </select>
          </div>
          {days === "custom" && <div><label className={ui.label}>Days</label><input type="number" min="0" max="3650" value={customDays} onChange={(e) => setCustomDays(e.target.value)} className={`${ui.input} w-24`} /></div>}
          <label className="inline-flex h-9 items-center gap-2 text-xs font-semibold text-[#374151]"><input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} /> Include expired</label>
        </div>

        <div className="px-6 pb-8 pt-2 space-y-2">
          {notice && <p className="text-xs font-semibold text-[#15803d]">{notice}</p>}
          <div ref={printRef}>
            <PrintHeader title="Expiring batches" lines={[`Store: ${data?.store || store.label}`, data && `Expiring by ${formatDate(data.until)}${includeExpired ? ", expired included" : ""}`]} />
            <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
              {loading && !data ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
                : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
                : !(effectiveDays >= 0) ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Enter the number of days.</p>
                : !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">No batches expire in this period.</p>
                : (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Item</th><th className={ui.th}>SKU</th><th className={ui.th}>Batch</th><th className={ui.th}>Warehouse</th><th className={ui.thRight}>Qty</th>
                      <th className={ui.th}>Expiry</th><th className={ui.thRight}>Days left</th><th className={ui.thRight}>Unit cost</th><th className="px-3 py-3 text-right whitespace-nowrap">Value</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r._id} className={r.expired ? "bg-[#FEF2F2]" : r.daysLeft <= 7 ? "bg-[#FFFBEB]" : ""}>
                          <td className={`${ui.td} font-semibold`}>{r.itemName}</td><td className={ui.td}>{r.sku || "—"}</td><td className={`${ui.td} font-mono`}>{r.batchNo}</td>
                          <td className={ui.td}>{r.warehouse}</td><td className={`${ui.td} text-right tabular-nums`}>{r.qty}</td>
                          <td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.expDate)}{r.expired && <span className="ml-1.5 text-[10px] font-bold uppercase text-[#B91C1C]">Expired</span>}</td>
                          <td className={`${ui.td} text-right tabular-nums ${r.expired ? "text-[#B91C1C] font-semibold" : ""}`}>{r.daysLeft}</td>
                          <td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(r.unitCost)}</td>
                          <td className={`${ui.td} text-right tabular-nums font-bold`}>{formatCurrency(r.value)}</td>
                        </tr>
                      ))}
                      {t && <tr className="bg-[#F3F4F6] font-bold"><td className={ui.td} colSpan={4}>Total ({t.batches} batches, {t.expired} expired)</td><td className={`${ui.td} text-right tabular-nums`}>{t.qty}</td><td className={ui.td} colSpan={3} /><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(t.value)}</td></tr>}
                    </tbody>
                  </table>
                )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default ExpiringBatches;
