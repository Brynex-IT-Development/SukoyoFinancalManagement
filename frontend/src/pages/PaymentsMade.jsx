import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Plus, Download, Banknote } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { api, formatCurrency, formatDate, getCurrentUser, ui } from "../utils/retailApi";

export const MODE_LABEL = { cash: "Cash", bank: "Bank", upi: "UPI", cheque: "Cheque" };

/** Vendors as VendorController lists them (GET /api/purchase/vendors). */
export const useVendors = () => {
  const [vendors, setVendors] = useState([]);
  useEffect(() => {
    const u = getCurrentUser();
    api("/purchase/vendors", { query: { userPower: u.power } })
      .then((list) => setVendors((Array.isArray(list) ? list : []).map((v) => ({ id: String(v.id || v._id), name: v.displayName || v.companyName || "Vendor" }))
        .sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setVendors([]));
  }, []);
  return vendors;
};

// F9: vendor payments (Payments Made). Route kept as /purchase/payments.
const PaymentsMade = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const vendors = useVendors();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [mode, setMode] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const d = await api("/vendor-payments", { query: { search, vendorId, mode, fromDate, toDate } });
        if (active) setPayments(d.payments || []);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [search, vendorId, mode, fromDate, toDate]);

  const total = useMemo(() => payments.reduce((s, p) => s + (p.amount || 0), 0), [payments]);
  const csvData = useMemo(() => payments.map((p) => ({
    Date: formatDate(p.date), Number: p.number, Vendor: p.vendorName, Mode: MODE_LABEL[p.mode] || p.mode, Reference: p.reference || "",
    Bills: (p.allocations || []).map((a) => `${a.billNumber} (${a.amount})`).join("; "), Amount: p.amount, Store: p.locCode || "", Notes: p.notes || "",
  })), [payments]);

  return (
    <>
      <Header title="Payments Made" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Payments Made</h1>
              <p className={ui.sub}>Money paid to vendors against their bills. Each payment is recorded in the daybook as money out.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <CSVLink data={csvData} filename={`vendor-payments-${new Date().toISOString().slice(0, 10)}.csv`} className={ui.btn}><Download size={14} /> Export CSV</CSVLink>
              <Link to="/purchase/payments/new" className={ui.btnDark}><Plus size={14} /> New Payment</Link>
            </div>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payment #, vendor, bill #, reference..." className={`${ui.input} pl-9`} />
          </div>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={`${ui.input} w-48`}>
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${ui.input} w-32`}>
            <option value="">All modes</option>
            {Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#374151]">From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#374151]">To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></label>
          <span className="inline-flex items-center rounded-none bg-[#F6FCE6] border border-[#ECF9C7] px-3 py-1 text-xs font-bold text-[#15171D]">{payments.length} payments · {formatCurrency(total)}</span>
        </div>

        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-hidden`}>
            {loading ? (
              <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading payments...</p>
            ) : error ? (
              <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
            ) : payments.length === 0 ? (
              <div className="px-8 py-16 text-center flex flex-col items-center">
                <Banknote size={28} className="text-[#1C1F26] mb-2" />
                <p className="text-xs text-[#6B7280]">{search || vendorId || mode || fromDate || toDate ? "No payments match." : "No vendor payments yet."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className={ui.theadRow}>
                      <th className={ui.th}>Date</th>
                      <th className={ui.th}>Payment #</th>
                      <th className={ui.th}>Vendor</th>
                      <th className={ui.th}>Mode</th>
                      <th className={ui.th}>Reference</th>
                      <th className={ui.th}>Bills</th>
                      <th className="px-3 py-3 text-right whitespace-nowrap">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1F2937]">
                    {payments.map((p, i) => (
                      <tr key={p._id} onClick={() => navigate(`/purchase/payments/${p._id}`)} className={`${i % 2 ? "bg-[#F9FAFB]/40" : "bg-white"} hover:bg-[#F6FCE6]/60 cursor-pointer`}>
                        <td className={`${ui.td} whitespace-nowrap`}>{formatDate(p.date)}</td>
                        <td className={`${ui.td} font-semibold text-[#111827]`}>{p.number}</td>
                        <td className={ui.td}>{p.vendorName}</td>
                        <td className={ui.td}>{MODE_LABEL[p.mode] || p.mode}</td>
                        <td className={ui.td}>{p.reference || "—"}</td>
                        <td className={`${ui.td} max-w-[260px] truncate`} title={(p.allocations || []).map((a) => a.billNumber).join(", ")}>{(p.allocations || []).map((a) => a.billNumber).join(", ")}</td>
                        <td className={`${ui.td} text-right font-bold`}>{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
};

export default PaymentsMade;
