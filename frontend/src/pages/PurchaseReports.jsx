import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { Search } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, todayIST, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const TABS = [
  { key: "summary", label: "Purchase summary", endpoint: "/purchase-reports/summary" },
  { key: "items", label: "Item purchases by vendor", endpoint: "/purchase-reports/items-by-vendor" },
  { key: "gst", label: "GST purchase register", endpoint: "/purchase-reports/gst-register" },
];
const PAY_LABEL = { paid: "Paid", partially_paid: "Part paid", overdue: "Overdue", unpaid: "Unpaid" };
const rateText = (r) => (r === null || r === undefined ? "Unknown" : `${r}%`);
const R = ({ children, bold }) => <td className={`${ui.td} text-right tabular-nums ${bold ? "font-bold" : ""}`}>{children}</td>;

// F13: purchase summary, item purchases by vendor, GST purchase register.
const PurchaseReports = () => {
  const isSidebarOpen = useSidebar();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab")) || TABS[0];
  const store = useStoreChoice();
  const [vendorKey, setVendorKey] = useState("");
  const [fromDate, setFromDate] = useState(`${todayIST().slice(0, 8)}01`);
  const [toDate, setToDate] = useState(todayIST());
  const [search, setSearch] = useState("");
  const [rate, setRate] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: () => tab.label, pageStyle: PRINT_PAGE_STYLE });

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      const query = { ...store.query, vendorKey, fromDate, toDate, ...(tab.key === "items" ? { search } : {}), ...(tab.key === "gst" ? { rate } : {}) };
      api(tab.endpoint, { query })
        .then((d) => active && setData({ ...d, tab: tab.key }))
        .catch((e) => { if (active) { setError(e.message); setData(null); } })
        .finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [tab.key, store.query.locCode, vendorKey, fromDate, toDate, search, rate]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (data?.tab === tab.key ? data.rows : []), [data, tab.key]);
  const t = data?.tab === tab.key ? data.totals : null;

  const csvData = useMemo(() => {
    if (tab.key === "summary") {
      const out = rows.map((r) => ({ Date: formatDate(r.date), Bill: r.billNumber, Vendor: r.vendorName, Store: r.store, Items: r.items, Qty: r.qty, "Sub-total": r.subTotal, Tax: r.tax, Total: r.total, Paid: r.paid, "Credits applied": r.credits, Balance: r.balance, Status: PAY_LABEL[r.paymentStatus] || r.paymentStatus }));
      if (t) out.push({ Date: "TOTAL", Bill: `${t.bills} bills`, Items: t.items, Qty: t.qty, "Sub-total": t.subTotal, Tax: t.tax, Total: t.total, Paid: t.paid, "Credits applied": t.credits, Balance: t.balance });
      return out;
    }
    if (tab.key === "items") {
      const out = rows.map((r) => ({ Item: r.itemName, SKU: r.sku, Vendor: r.vendorName, Bills: r.bills, Qty: r.qty, "Value (as billed)": r.value, "Taxable value": r.taxable, "Average rate": r.averageRate }));
      if (t) out.push({ Item: "TOTAL", Qty: t.qty, "Value (as billed)": t.value, "Taxable value": t.taxable });
      return out;
    }
    const out = rows.map((r) => ({ Date: formatDate(r.date), Vendor: r.vendorName, "Vendor GSTIN": r.vendorGstin, "Bill number": r.billNumber, "Tax rate": rateText(r.rate), "Taxable value": r.taxable, CGST: r.cgst, SGST: r.sgst, IGST: r.igst, Cess: r.cess, Total: r.total }));
    if (t) out.push({ Date: "TOTAL", "Taxable value": t.taxable, CGST: t.cgst, SGST: t.sgst, IGST: t.igst, Cess: 0, Total: t.total });
    return out;
  }, [rows, t, tab.key]);

  const vendorName = (data?.vendors || []).find((v) => v.vendorKey === vendorKey)?.vendorName;
  const printLines = [`Store: ${data?.store || store.label}`, `Bills dated ${formatDate(fromDate)} – ${formatDate(toDate)}`, vendorName && `Vendor: ${vendorName}`, tab.key === "gst" && rate !== "" && `Rate: ${rate}%`];

  return (
    <>
      <Header title="Purchase Reports" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Purchase Reports</h1>
              <p className={ui.sub}>Bills by date, item and vendor, and the GST purchase register. Draft and cancelled bills are left out.</p>
            </div>
            <ReportActions csvData={csvData} csvName={`purchase-${tab.key}`} onPrint={() => print()} disabled={!rows.length} />
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {TABS.map((x) => (
              <button key={x.key} type="button" onClick={() => setParams({ tab: x.key }, { replace: true })}
                className={`h-8 px-3.5 text-xs font-bold uppercase tracking-wider border ${x.key === tab.key ? "bg-[#1C1F26] text-white border-[#1C1F26]" : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F3F4F6]"}`}>{x.label}</button>
            ))}
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          {tab.key === "items" && (
            <div className="relative min-w-[200px]">
              <label className={ui.label}>Item</label>
              <Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name or SKU" className={`${ui.input} pl-9`} />
            </div>
          )}
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div>
            <label className={ui.label}>Vendor</label>
            <select value={vendorKey} onChange={(e) => setVendorKey(e.target.value)} className={`${ui.input} w-52`}>
              <option value="">All vendors</option>
              {(data?.vendors || []).map((v) => <option key={v.vendorKey} value={v.vendorKey}>{v.vendorName}</option>)}
            </select>
          </div>
          {tab.key === "gst" && (
            <div>
              <label className={ui.label}>Tax rate</label>
              <select value={rate} onChange={(e) => setRate(e.target.value)} className={`${ui.input} w-32`}>
                <option value="">All rates</option>
                {(data?.rates || []).map((x) => <option key={String(x)} value={x === null ? "unknown" : String(x)}>{rateText(x)}</option>)}
              </select>
            </div>
          )}
          <div><label className={ui.label}>Bill date from</label><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
        </div>

        <div className="px-6 pb-8 pt-2">
          <div ref={printRef}>
            <PrintHeader title={tab.label} lines={printLines} />
            <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
              {loading && !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
                : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
                : !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">No bills match these filters.</p>
                : tab.key === "summary" ? (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Date</th><th className={ui.th}>Bill #</th><th className={ui.th}>Vendor</th><th className={ui.th}>Store</th>
                      <th className={ui.thRight}>Items</th><th className={ui.thRight}>Qty</th><th className={ui.thRight}>Sub-total</th><th className={ui.thRight}>Tax</th>
                      <th className={ui.thRight}>Total</th><th className={ui.thRight}>Paid</th><th className={ui.thRight}>Credits</th><th className={ui.thRight}>Balance</th><th className="px-3 py-3 text-left">Status</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r._id}>
                          <td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.date)}</td>
                          <td className={`${ui.td} font-semibold`}><Link to={`/purchase/bills/${r._id}`} className="hover:underline">{r.billNumber}</Link></td>
                          <td className={`${ui.td} whitespace-nowrap`}>{r.vendorName}</td>
                          <td className={ui.td}>{r.store || "—"}</td>
                          <R>{r.items}</R><R>{r.qty}</R><R>{formatCurrency(r.subTotal)}</R><R>{formatCurrency(r.tax)}</R><R bold>{formatCurrency(r.total)}</R>
                          <R>{formatCurrency(r.paid)}</R><R>{formatCurrency(r.credits)}</R><R bold>{formatCurrency(r.balance)}</R>
                          <td className={ui.td}>{PAY_LABEL[r.paymentStatus] || r.paymentStatus}</td>
                        </tr>
                      ))}
                      {t && (
                        <tr className="bg-[#F3F4F6] font-bold">
                          <td className={ui.td} colSpan={4}>Total ({t.bills} bills)</td>
                          <R>{t.items}</R><R>{t.qty}</R><R>{formatCurrency(t.subTotal)}</R><R>{formatCurrency(t.tax)}</R><R>{formatCurrency(t.total)}</R>
                          <R>{formatCurrency(t.paid)}</R><R>{formatCurrency(t.credits)}</R><R>{formatCurrency(t.balance)}</R><td className={ui.td} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : tab.key === "items" ? (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Item</th><th className={ui.th}>SKU</th><th className={ui.th}>Vendor</th><th className={ui.thRight}>Bills</th><th className={ui.thRight}>Qty</th>
                      <th className={ui.thRight}>Value (as billed)</th><th className={ui.thRight}>Taxable value</th><th className="px-3 py-3 text-right whitespace-nowrap">Average rate</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={`${r.itemKey}|${r.vendorKey}`}>
                          <td className={`${ui.td} font-semibold`}>{r.itemName || "—"}</td><td className={ui.td}>{r.sku || "—"}</td><td className={`${ui.td} whitespace-nowrap`}>{r.vendorName}</td>
                          <R>{r.bills}</R><R>{r.qty}</R><R bold>{formatCurrency(r.value)}</R><R>{formatCurrency(r.taxable)}</R><R>{formatCurrency(r.averageRate)}</R>
                        </tr>
                      ))}
                      {t && (
                        <tr className="bg-[#F3F4F6] font-bold">
                          <td className={ui.td} colSpan={4}>Total ({t.rows} item × vendor rows)</td>
                          <R>{t.qty}</R><R>{formatCurrency(t.value)}</R><R>{formatCurrency(t.taxable)}</R><td className={ui.td} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Date</th><th className={ui.th}>Vendor</th><th className={ui.th}>Vendor GSTIN</th><th className={ui.th}>Bill #</th><th className={ui.thRight}>Rate</th>
                      <th className={ui.thRight}>Taxable value</th><th className={ui.thRight}>CGST</th><th className={ui.thRight}>SGST</th><th className={ui.thRight}>IGST</th><th className={ui.thRight}>Cess</th>
                      <th className="px-3 py-3 text-right whitespace-nowrap">Total</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={`${r.billId}-${r.rate}`}>
                          <td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.date)}</td><td className={`${ui.td} whitespace-nowrap`}>{r.vendorName}</td>
                          <td className={`${ui.td} font-mono`}>{r.vendorGstin}</td>
                          <td className={`${ui.td} font-semibold`}><Link to={`/purchase/bills/${r.billId}`} className="hover:underline">{r.billNumber}</Link></td>
                          <R>{rateText(r.rate)}</R><R>{formatCurrency(r.taxable)}</R><R>{formatCurrency(r.cgst)}</R><R>{formatCurrency(r.sgst)}</R><R>{formatCurrency(r.igst)}</R><R>{formatCurrency(r.cess)}</R><R bold>{formatCurrency(r.total)}</R>
                        </tr>
                      ))}
                      {t && (
                        <tr className="bg-[#F3F4F6] font-bold">
                          <td className={ui.td} colSpan={5}>Total ({t.rows} rows)</td>
                          <R>{formatCurrency(t.taxable)}</R><R>{formatCurrency(t.cgst)}</R><R>{formatCurrency(t.sgst)}</R><R>{formatCurrency(t.igst)}</R><R>{formatCurrency(0)}</R><R>{formatCurrency(t.total)}</R>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
            </section>
            {tab.key === "gst" && data?.tab === "gst" && data.skippedNoGstin > 0 && (
              <p className="mt-2 text-[11px] text-[#6B7280]">{data.skippedNoGstin} bill(s) from vendors without a GSTIN are not in the register. Taxable value and tax come from the amounts stored on each bill line.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default PurchaseReports;
