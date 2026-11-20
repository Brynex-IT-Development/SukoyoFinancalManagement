import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Download, Ticket } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { api, formatCurrency, formatDate, ui, STORE_CREDIT_STATUS_STYLES } from "../utils/retailApi";

// Customer store credit ("SC-" notes issued on returns). Route kept as /sales/credit-notes.
const CreditNotes = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api("/store-credits", { query: { search, status, fromDate, toDate } });
        if (active) setCredits(data.credits || []);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [search, status, fromDate, toDate]);

  const openBalance = useMemo(() => credits.filter((c) => c.status === "open").reduce((s, c) => s + (c.balance || 0), 0), [credits]);
  const csvData = useMemo(() => credits.map((c) => ({
    Number: c.number, Customer: c.customerName, Phone: c.customerPhone, "Issued": formatDate(c.issueDate),
    "Expires": c.expiryDate ? formatDate(c.expiryDate) : "Never", Amount: c.amount, Balance: c.balance, Status: c.status,
    "Return Invoice": c.returnInvoiceNumber || "", "Original Invoice": c.sourceInvoiceNumber || "", Store: c.locCode || "",
  })), [credits]);

  return (
    <>
      <Header title="Store Credit" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Store Credit</h1>
              <p className={ui.sub}>Issued when a return is refunded as store credit. Use it on a bill from the Apply panel.</p>
            </div>
            <CSVLink data={csvData} filename={`store-credit-${new Date().toISOString().slice(0, 10)}.csv`} className={ui.btn}>
              <Download size={14} /> Export CSV
            </CSVLink>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, customer, phone, return #..." className={`${ui.input} pl-9`} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${ui.input} w-36`}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="used">Used</option>
            <option value="expired">Expired</option>
            <option value="void">Void</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#374151]">From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#374151]">To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} />
          </label>
          {(fromDate || toDate) && <button type="button" className={ui.btn} onClick={() => { setFromDate(""); setToDate(""); }}>Clear dates</button>}
          <span className="inline-flex items-center rounded-none bg-[#F6FCE6] border border-[#ECF9C7] px-3 py-1 text-xs font-bold text-[#15171D]">
            Open balance: {formatCurrency(openBalance)}
          </span>
        </div>

        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-hidden`}>
            {loading ? (
              <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading store credit...</p>
            ) : error ? (
              <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
            ) : credits.length === 0 ? (
              <div className="px-8 py-16 text-center flex flex-col items-center">
                <Ticket size={28} className="text-[#1C1F26] mb-2" />
                <p className="text-xs text-[#6B7280]">No store credit found. It is created when a return is refunded as store credit.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className={ui.theadRow}>
                      <th className={ui.th}>Number</th>
                      <th className={ui.th}>Customer</th>
                      <th className={ui.th}>Issued</th>
                      <th className={ui.th}>Expires</th>
                      <th className={ui.th}>Return #</th>
                      <th className={ui.thRight}>Amount</th>
                      <th className={ui.thRight}>Balance</th>
                      <th className="px-3 py-3 text-left whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1F2937]">
                    {credits.map((c, i) => (
                      <tr key={c._id} onClick={() => navigate(`/sales/credit-notes/${c._id}`)}
                        className={`${i % 2 ? "bg-[#F9FAFB]/40" : "bg-white"} hover:bg-[#F6FCE6]/60 cursor-pointer`}>
                        <td className={`${ui.td} font-semibold text-[#111827]`}>{c.number}</td>
                        <td className={ui.td}>{c.customerName}<span className="text-[#9CA3AF]"> · {c.customerPhone}</span></td>
                        <td className={`${ui.td} whitespace-nowrap`}>{formatDate(c.issueDate)}</td>
                        <td className={`${ui.td} whitespace-nowrap`}>{c.expiryDate ? formatDate(c.expiryDate) : "Never"}</td>
                        <td className={ui.td}>{c.returnInvoiceNumber || "—"}</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(c.amount)}</td>
                        <td className={`${ui.td} text-right font-bold`}>{formatCurrency(c.balance)}</td>
                        <td className={ui.td}><span className={`${ui.badge} ${STORE_CREDIT_STATUS_STYLES[c.status] || ""}`}>{c.status}</span></td>
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

export default CreditNotes;
