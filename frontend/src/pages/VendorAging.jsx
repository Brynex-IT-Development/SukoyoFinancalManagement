import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

// F10: unpaid vendor bills by how many days past their due date they are (IST days).
// Due date = the bill's due date, or bill date + 30 days when it has none.
const VendorAging = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const store = useStoreChoice();
  const [vendorKey, setVendorKey] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: "Vendor aging", pageStyle: PRINT_PAGE_STYLE });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api("/vendor-reports/aging", { query: { ...store.query, vendorKey, fromDate, toDate } })
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [store.query.locCode, store.query.warehouse, vendorKey, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const buckets = useMemo(() => data?.buckets || [], [data]);
  const rows = useMemo(() => data?.rows || [], [data]);
  const t = data?.totals;
  const csvData = useMemo(() => {
    const line = (name, r) => ({ Vendor: name, Bills: r.bills, ...Object.fromEntries(buckets.map((b) => [b.label === "Not due" ? "Not due" : `${b.label} days`, r[b.key]])), Total: r.total });
    const out = rows.map((r) => line(r.vendorName, r));
    if (t) out.push(line("TOTAL", t));
    return out;
  }, [rows, t, buckets]);

  const vendorName = (data?.vendors || []).find((v) => v.vendorKey === vendorKey)?.vendorName;
  const printLines = [data?.asOf && `As of ${formatDate(data.asOf)}`, `Store: ${store.label}`, vendorName && `Vendor: ${vendorName}`,
    (fromDate || toDate) && `Bills dated ${fromDate ? formatDate(fromDate) : "start"} – ${toDate ? formatDate(toDate) : "today"}`];

  return (
    <>
      <Header title="Vendor Aging" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Vendor Aging</h1>
              <p className={ui.sub}>
                Unpaid bill balances by days past due{data?.asOf ? `, as of ${formatDate(data.asOf)}` : ""}. Bills without a due date are due 30 days after the bill date.
              </p>
            </div>
            <ReportActions csvData={csvData} csvName="vendor-aging" onPrint={() => print()} disabled={!rows.length} />
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div>
            <label className={ui.label}>Vendor</label>
            <select value={vendorKey} onChange={(e) => setVendorKey(e.target.value)} className={`${ui.input} w-52`}>
              <option value="">All vendors</option>
              {(data?.vendors || []).map((v) => <option key={v.vendorKey} value={v.vendorKey}>{v.vendorName}</option>)}
              {vendorKey && !(data?.vendors || []).some((v) => v.vendorKey === vendorKey) && <option value={vendorKey}>{vendorName || "Selected vendor"}</option>}
            </select>
          </div>
          <div><label className={ui.label}>Bill date from</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
        </div>

        <div className="px-6 pb-8 pt-2">
          <div ref={printRef}>
            <PrintHeader title="Vendor aging" lines={printLines} />
            <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
              {loading ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
                : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
                : !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">No unpaid bills match these filters.</p>
                : (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Vendor</th><th className={ui.thRight}>Bills</th>
                      {buckets.map((b) => <th key={b.key} className={ui.thRight}>{b.label === "Not due" ? "Not due" : `${b.label} days`}</th>)}
                      <th className="px-3 py-3 text-right whitespace-nowrap">Total due</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r.vendorKey} onClick={() => navigate(`/reports/vendor-statement?vendorKey=${encodeURIComponent(r.vendorKey)}`)}
                          className="cursor-pointer hover:bg-[#F6FCE6]/60" title="Open this vendor's statement">
                          <td className={`${ui.td} font-semibold whitespace-nowrap`}>{r.vendorName}</td>
                          <td className={`${ui.td} text-right`}>{r.bills}</td>
                          {buckets.map((b) => (
                            <td key={b.key} className={`${ui.td} text-right ${r[b.key] > 0 && b.key !== "notDue" ? "text-[#B91C1C]" : ""}`}>{r[b.key] > 0 ? formatCurrency(r[b.key]) : "—"}</td>
                          ))}
                          <td className={`${ui.td} text-right font-bold`}>{formatCurrency(r.total)}</td>
                        </tr>
                      ))}
                      {t && (
                        <tr className="bg-[#F3F4F6] font-bold">
                          <td className={ui.td}>Total ({rows.length} vendors)</td>
                          <td className={`${ui.td} text-right`}>{t.bills}</td>
                          {buckets.map((b) => <td key={b.key} className={`${ui.td} text-right`}>{formatCurrency(t[b.key])}</td>)}
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.total)}</td>
                        </tr>
                      )}
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

export default VendorAging;
