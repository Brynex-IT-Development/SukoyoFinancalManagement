import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { useVendors } from "./PaymentsMade";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, todayIST, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const ENTRY_LINK = { Bill: "/purchase/bills/", Payment: "/purchase/payments/", "Vendor credit": "/purchase/vendor-credits/" };
const MODE = { cash: "Cash", bank: "Bank", upi: "UPI", cheque: "Cheque" };

// F10: one vendor's ledger for a date range — bills owed, payments and vendor credits, running balance.
const VendorStatement = () => {
  const isSidebarOpen = useSidebar();
  const [params, setParams] = useSearchParams();
  const store = useStoreChoice();
  const mongoVendors = useVendors();
  const [billVendors, setBillVendors] = useState([]);
  const vendorKey = params.get("vendorKey") || "";
  const [fromDate, setFromDate] = useState(params.get("fromDate") || `${todayIST().slice(0, 8)}01`);
  const [toDate, setToDate] = useState(params.get("toDate") || todayIST());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: () => `Statement ${data?.vendorName || ""}`.trim(), pageStyle: PRINT_PAGE_STYLE.replace("landscape", "portrait") });

  // Vendor choices: vendor records plus names found on older bills without a vendor record
  useEffect(() => {
    api("/vendor-reports/outstanding", { query: store.query }).then((d) => setBillVendors(d.vendors || [])).catch(() => setBillVendors([]));
  }, [store.query.locCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendorOptions = useMemo(() => {
    const m = new Map(mongoVendors.map((v) => [`id:${v.id}`, v.name]));
    billVendors.forEach((v) => { if (!m.has(v.vendorKey)) m.set(v.vendorKey, v.vendorName); });
    return [...m.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [mongoVendors, billVendors]);

  const setVendorKey = (key) => setParams((p) => { const n = new URLSearchParams(p); if (key) n.set("vendorKey", key); else n.delete("vendorKey"); return n; }, { replace: true });

  useEffect(() => {
    if (!vendorKey) { setData(null); return; }
    let active = true;
    setLoading(true);
    setError("");
    api("/vendor-reports/statement", { query: { ...store.query, vendorKey, fromDate, toDate } })
      .then((d) => active && setData(d))
      .catch((e) => { if (active) { setError(e.message); setData(null); } })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [store.query.locCode, store.query.warehouse, vendorKey, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const csvData = useMemo(() => {
    if (!data) return [];
    return [
      { Date: formatDate(data.fromDate), Type: "Opening balance", Reference: "", Debit: "", Credit: "", Balance: data.opening },
      ...data.entries.map((e) => ({ Date: formatDate(e.date), Type: e.type, Reference: e.ref, Debit: e.debit || "", Credit: e.credit || "", Balance: e.balance })),
      { Date: "", Type: "Total", Reference: "", Debit: data.totalDebit, Credit: data.totalCredit, Balance: "" },
      { Date: formatDate(data.toDate), Type: "Closing balance", Reference: "", Debit: "", Credit: "", Balance: data.closing },
    ];
  }, [data]);

  const bal = (n) => (n < 0 ? `${formatCurrency(-n)} Cr` : formatCurrency(n));

  return (
    <>
      <Header title="Vendor Statement" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Vendor Statement</h1>
              <p className={ui.sub}>Bills (owed to the vendor), payments and vendor credits for one vendor, with the running balance we owe.</p>
            </div>
            <ReportActions csvData={csvData} csvName={`vendor-statement-${(data?.vendorName || "vendor").replace(/\W+/g, "-").toLowerCase()}`} onPrint={() => print()} disabled={!data} />
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div>
            <label className={ui.label}>Vendor <span className="text-red-500">*</span></label>
            <select value={vendorKey} onChange={(e) => setVendorKey(e.target.value)} className={`${ui.input} w-60`}>
              <option value="">Choose a vendor…</option>
              {vendorOptions.map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}
              {vendorKey && !vendorOptions.some((v) => v.key === vendorKey) && <option value={vendorKey}>{data?.vendorName || "Selected vendor"}</option>}
            </select>
          </div>
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div><label className={ui.label}>From</label><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
        </div>

        <div className="px-6 pb-8 pt-2">
          {!vendorKey ? <p className={`${ui.card} px-8 py-16 text-center text-xs text-[#6B7280]`}>Choose a vendor to see their statement.</p>
            : loading && !data ? <p className={`${ui.card} px-8 py-16 text-center text-xs text-[#6B7280]`}>Loading...</p>
            : error ? <p className={`${ui.card} px-8 py-16 text-center text-xs font-semibold text-red-500`}>{error}</p>
            : data && (
              <div ref={printRef}>
                <PrintHeader title="Vendor statement" lines={[`Store: ${store.label}`]} />
                <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
                  <div className="flex flex-wrap justify-between gap-4 px-4 py-4 border-b border-[#E5E7EB] text-xs">
                    <div>
                      <div className="text-[#6B7280]">Vendor</div>
                      <div className="text-sm font-bold">{data.vendorName}</div>
                      {data.gstin && <div>GSTIN {data.gstin}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-[#6B7280]">Period</div>
                      <div className="font-semibold">{formatDate(data.fromDate)} – {formatDate(data.toDate)}</div>
                    </div>
                  </div>
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Date</th><th className={ui.th}>Type</th><th className={ui.th}>Reference</th>
                      <th className={ui.thRight}>Billed (debit)</th><th className={ui.thRight}>Paid / credited</th><th className="px-3 py-3 text-right whitespace-nowrap">Balance</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      <tr className="bg-[#F9FAFB] font-semibold">
                        <td className={ui.td}>{formatDate(data.fromDate)}</td><td className={ui.td} colSpan={4}>Opening balance</td>
                        <td className={`${ui.td} text-right`}>{bal(data.opening)}</td>
                      </tr>
                      {data.entries.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-[#6B7280]">Nothing in this period.</td></tr>}
                      {data.entries.map((e) => (
                        <tr key={`${e.type}-${e.id}`}>
                          <td className={`${ui.td} whitespace-nowrap`}>{formatDate(e.date)}</td>
                          <td className={ui.td}>{e.type}{e.note ? ` · ${MODE[e.note] || e.note}` : ""}</td>
                          <td className={`${ui.td} font-semibold`}>{ENTRY_LINK[e.type] && e.id ? <Link to={`${ENTRY_LINK[e.type]}${e.id}`} className="hover:underline">{e.ref}</Link> : e.ref}</td>
                          <td className={`${ui.td} text-right`}>{e.debit ? formatCurrency(e.debit) : ""}</td>
                          <td className={`${ui.td} text-right`}>{e.credit ? formatCurrency(e.credit) : ""}</td>
                          <td className={`${ui.td} text-right`}>{bal(e.balance)}</td>
                        </tr>
                      ))}
                      <tr className="bg-[#F3F4F6] font-bold">
                        <td className={ui.td} colSpan={3}>Total for period</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(data.totalDebit)}</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(data.totalCredit)}</td>
                        <td className={ui.td} />
                      </tr>
                      <tr className="bg-[#1C1F26] text-white font-bold">
                        <td className={ui.td}>{formatDate(data.toDate)}</td><td className={ui.td} colSpan={4}>Closing balance (we owe)</td>
                        <td className={`${ui.td} text-right`}>{bal(data.closing)}</td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              </div>
            )}
        </div>
      </div>
    </>
  );
};

export default VendorStatement;
