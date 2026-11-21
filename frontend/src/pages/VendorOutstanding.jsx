import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { X } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const STATUS_STYLE = {
  "Fully paid": "bg-[#DCFCE7] text-[#15803d] border-[#BBF7D0]",
  "Partially paid": "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  Unpaid: "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
};
const BILL_STATUS = { paid: "Paid", partially_paid: "Part paid", overdue: "Overdue", unpaid: "Unpaid" };
const SHOW = { all: "All vendors", outstanding: "Outstanding only", paid: "Fully paid only" };

// F10: what each vendor has billed, what has been paid or credited, and what is still owed.
const VendorOutstanding = () => {
  const isSidebarOpen = useSidebar();
  const store = useStoreChoice();
  const [vendorKey, setVendorKey] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [show, setShow] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState(null); // { row, bills, loading, error }
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: "Vendor outstanding", pageStyle: PRINT_PAGE_STYLE });

  const filters = useMemo(() => ({ ...store.query, vendorKey, fromDate, toDate }), [store.query.locCode, store.query.warehouse, vendorKey, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api("/vendor-reports/outstanding", { query: { ...filters, show } })
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [filters, show]);

  useEffect(() => setDrill(null), [filters]);

  const openDrill = async (row) => {
    setDrill({ row, bills: [], loading: true });
    try {
      const d = await api("/vendor-reports/vendor-bills", { query: { ...filters, vendorKey: row.vendorKey } });
      setDrill({ row, bills: d.bills || [], loading: false });
    } catch (e) {
      setDrill({ row, bills: [], loading: false, error: e.message });
    }
  };

  const rows = useMemo(() => data?.rows || [], [data]);
  const t = data?.totals;
  const csvData = useMemo(() => {
    const out = rows.map((r) => ({
      Vendor: r.vendorName, Bills: r.billCount, Billed: r.billed, Paid: r.paid, "Credits applied": r.creditsApplied, Outstanding: r.outstanding,
      "% paid": r.percentPaid, Status: r.status, "First bill": formatDate(r.firstBillDate), "Last bill": formatDate(r.lastBillDate), "Days since last bill": r.daysSinceLastBill ?? "",
    }));
    if (t) out.push({ Vendor: "TOTAL", Bills: t.billCount, Billed: t.billed, Paid: t.paid, "Credits applied": t.creditsApplied, Outstanding: t.outstanding, "% paid": t.percentPaid });
    return out;
  }, [rows, t]);

  const vendorName = (data?.vendors || []).find((v) => v.vendorKey === vendorKey)?.vendorName;
  const printLines = [`Store: ${store.label}`, vendorName && `Vendor: ${vendorName}`, (fromDate || toDate) && `Bills dated ${fromDate ? formatDate(fromDate) : "start"} – ${toDate ? formatDate(toDate) : "today"}`, show !== "all" && SHOW[show]];

  return (
    <>
      <Header title="Vendor Outstanding" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Vendor Outstanding</h1>
              <p className={ui.sub}>Billed, paid, credited and still owed, per vendor. Draft and cancelled bills are left out. Click a vendor to see their bills.</p>
            </div>
            <ReportActions csvData={csvData} csvName="vendor-outstanding" onPrint={() => print()} disabled={!rows.length} />
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div>
            <label className={ui.label}>Vendor</label>
            <select value={vendorKey} onChange={(e) => setVendorKey(e.target.value)} className={`${ui.input} w-52`}>
              <option value="">All vendors</option>
              {(data?.vendors || []).map((v) => <option key={v.vendorKey} value={v.vendorKey}>{v.vendorName}</option>)}
            </select>
          </div>
          <div><label className={ui.label}>Bill date from</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div>
            <label className={ui.label}>Show</label>
            <select value={show} onChange={(e) => setShow(e.target.value)} className={`${ui.input} w-40`}>
              {Object.entries(SHOW).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="px-6 pb-8 pt-2 space-y-5">
          <div ref={printRef}>
            <PrintHeader title="Vendor outstanding" lines={printLines} />
            <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
              {loading ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
                : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
                : !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">No bills match these filters.</p>
                : (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Vendor</th><th className={ui.thRight}>Bills</th><th className={ui.thRight}>Billed</th><th className={ui.thRight}>Paid</th>
                      <th className={ui.thRight}>Credits applied</th><th className={ui.thRight}>Outstanding</th><th className={ui.thRight}>% paid</th><th className={ui.th}>Status</th>
                      <th className={ui.th}>First bill</th><th className={ui.th}>Last bill</th><th className="px-3 py-3 text-right whitespace-nowrap">Days since last bill</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r.vendorKey} onClick={() => openDrill(r)} className={`cursor-pointer hover:bg-[#F6FCE6]/60 ${drill?.row.vendorKey === r.vendorKey ? "bg-[#F6FCE6]" : ""}`}>
                          <td className={`${ui.td} font-semibold whitespace-nowrap`}>{r.vendorName}</td>
                          <td className={`${ui.td} text-right`}>{r.billCount}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(r.billed)}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(r.paid)}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(r.creditsApplied)}</td>
                          <td className={`${ui.td} text-right font-bold`}>{formatCurrency(r.outstanding)}</td>
                          <td className={`${ui.td} text-right`}>{r.percentPaid.toFixed(1)}%</td>
                          <td className={ui.td}><span className={`${ui.badge} ${STATUS_STYLE[r.status] || ""}`}>{r.status}</span></td>
                          <td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.firstBillDate)}</td>
                          <td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.lastBillDate)}</td>
                          <td className={`${ui.td} text-right`}>{r.daysSinceLastBill ?? "—"}</td>
                        </tr>
                      ))}
                      {t && (
                        <tr className="bg-[#F3F4F6] font-bold">
                          <td className={ui.td}>Total ({rows.length} vendors)</td>
                          <td className={`${ui.td} text-right`}>{t.billCount}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.billed)}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.paid)}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.creditsApplied)}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.outstanding)}</td>
                          <td className={`${ui.td} text-right`}>{t.percentPaid.toFixed(1)}%</td>
                          <td className={ui.td} colSpan={4} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
            </section>
          </div>

          {drill && (
            <section className={`${ui.card} overflow-x-auto`}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
                <p className="text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Bills · {drill.row.vendorName}</p>
                <div className="flex items-center gap-2">
                  <Link to={`/reports/vendor-statement?vendorKey=${encodeURIComponent(drill.row.vendorKey)}`} className={ui.btn}>Statement</Link>
                  {drill.row.vendorId && drill.row.outstanding > 0 && <Link to={`/purchase/payments/new?vendorId=${drill.row.vendorId}`} className={ui.btn}>Record payment</Link>}
                  <button type="button" onClick={() => setDrill(null)} className={ui.btn} aria-label="Close"><X size={14} /></button>
                </div>
              </div>
              <table className="min-w-full border-collapse mt-3">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Bill #</th><th className={ui.th}>Bill date</th><th className={ui.th}>Due date</th><th className={ui.thRight}>Total</th>
                  <th className={ui.thRight}>Paid</th><th className={ui.thRight}>Credits</th><th className={ui.thRight}>Balance</th><th className="px-3 py-3 text-left">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {drill.loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-[#6B7280]">Loading bills…</td></tr>}
                  {drill.error && <tr><td colSpan={8} className="px-3 py-6 text-center text-red-600">{drill.error}</td></tr>}
                  {drill.bills.map((b) => (
                    <tr key={b._id}>
                      <td className={`${ui.td} font-semibold`}><Link to={`/purchase/bills/${b._id}`} className="hover:underline">{b.billNumber}</Link></td>
                      <td className={ui.td}>{formatDate(b.billDate)}</td>
                      <td className={ui.td}>{formatDate(b.effectiveDueDate)}{b.daysOverdue > 0 && b.balanceDue > 0 && <span className="text-red-600"> · {b.daysOverdue}d late</span>}</td>
                      <td className={`${ui.td} text-right`}>{formatCurrency(b.finalTotal)}</td>
                      <td className={`${ui.td} text-right`}>{formatCurrency(b.amountPaid)}</td>
                      <td className={`${ui.td} text-right`}>{formatCurrency(b.creditsApplied)}</td>
                      <td className={`${ui.td} text-right font-semibold`}>{formatCurrency(b.balanceDue)}</td>
                      <td className={ui.td}>{BILL_STATUS[b.paymentStatus] || b.paymentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </>
  );
};

export default VendorOutstanding;
