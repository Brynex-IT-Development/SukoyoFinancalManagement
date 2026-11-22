import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Plus, Download, MessageSquare } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { StoreSelect, useStoreChoice, todayIST } from "../components/payables/VendorReportKit";
import { api, formatDate, ui } from "../utils/retailApi";

export const ENQUIRY_STATUS = {
  new: { label: "New", style: "bg-[#E0E7FF] text-[#3730A3] border-[#C7D2FE]" },
  contacted: { label: "Contacted", style: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
  converted: { label: "Converted", style: "bg-[#DCFCE7] text-[#15803d] border-[#BBF7D0]" },
  closed: { label: "Closed", style: "bg-[#F3F4F6] text-[#374151] border-[#E5E7EB]" },
};
const DUE = { "": "Any follow-up", today: "Due today", overdue: "Overdue", due: "Due today or overdue" };
export const followUpStyle = { overdue: "text-[#B91C1C] font-semibold", today: "text-[#92400E] font-semibold", later: "" };

// F16: customer enquiries for items, with follow-ups.
const Enquiries = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const store = useStoreChoice();
  const [status, setStatus] = useState("");
  const [due, setDue] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      api("/enquiries", { query: { ...store.query, status, due, search, fromDate, toDate } })
        .then((d) => active && setData(d))
        .catch((e) => { if (active) { setError(e.message); setData(null); } })
        .finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [store.query.locCode, status, due, search, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => data?.rows || [], [data]);
  const csvData = useMemo(() => rows.map((r) => ({
    Number: r.number, Date: formatDate(r.createdAt), Customer: r.customerName, Phone: r.phone, "Item wanted": r.itemWanted, "Linked item": r.itemName || "",
    Staff: r.staffName || "", Status: ENQUIRY_STATUS[r.status]?.label || r.status, "Follow-up": r.followUpDate || "", Invoice: r.convertedInvoiceNumber || "", Store: r.locCode, Notes: r.notes || "",
  })), [rows]);

  return (
    <>
      <Header title="Enquiries" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Enquiries</h1>
              <p className={ui.sub}>Customers asking for items. Follow them up and mark them converted when they buy.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <CSVLink data={csvData} filename={`enquiries-${todayIST()}.csv`} className={`${ui.btn} ${rows.length ? "" : "pointer-events-none opacity-50"}`}><Download size={14} /> Export CSV</CSVLink>
              <Link to="/sales/enquiries/new" className={ui.btnDark}><Plus size={14} /> New Enquiry</Link>
            </div>
          </div>
          {data && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {[["", `All · ${Object.values(data.counts).reduce((a, b) => a + b, 0)}`], ...Object.entries(ENQUIRY_STATUS).map(([k, v]) => [k, `${v.label} · ${data.counts[k] || 0}`])].map(([k, l]) => (
                <button key={k || "all"} type="button" onClick={() => setStatus(k)}
                  className={`h-8 px-3.5 text-xs font-bold uppercase tracking-wider border ${status === k ? "bg-[#1C1F26] text-white border-[#1C1F26]" : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F3F4F6]"}`}>{l}</button>
              ))}
              {(data.dueToday > 0 || data.overdue > 0) && (
                <button type="button" onClick={() => setDue(due === "due" ? "" : "due")} className={`h-8 px-3.5 text-xs font-bold border ${due === "due" ? "bg-[#B91C1C] text-white border-[#B91C1C]" : "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]"}`}>
                  Follow up: {data.dueToday} today · {data.overdue} overdue
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[240px]">
            <label className={ui.label}>Search</label>
            <Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, customer, phone, item" className={`${ui.input} pl-9`} />
          </div>
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div>
            <label className={ui.label}>Follow-up</label>
            <select value={due} onChange={(e) => setDue(e.target.value)} className={`${ui.input} w-48`}>
              {Object.entries(DUE).map(([k, l]) => <option key={k || "any"} value={k}>{l}</option>)}
            </select>
          </div>
          <div><label className={ui.label}>Taken from</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
        </div>

        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-x-auto`}>
            {loading && !data ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
              : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
              : !rows.length ? (
                <div className="px-8 py-16 text-center flex flex-col items-center">
                  <MessageSquare size={28} className="text-[#1C1F26] mb-2" />
                  <p className="text-xs text-[#6B7280]">{status || due || search || fromDate || toDate ? "No enquiries match." : "No enquiries yet."}</p>
                </div>
              ) : (
                <table className="min-w-full border-collapse">
                  <thead><tr className={ui.theadRow}>
                    <th className={ui.th}>Enquiry #</th><th className={ui.th}>Taken</th><th className={ui.th}>Customer</th><th className={ui.th}>Phone</th><th className={ui.th}>Item wanted</th>
                    <th className={ui.th}>Staff</th><th className={ui.th}>Follow-up</th><th className={ui.th}>Store</th><th className="px-3 py-3 text-left">Status</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs">
                    {rows.map((r) => (
                      <tr key={r._id} onClick={() => navigate(`/sales/enquiries/${r._id}`)} className="cursor-pointer hover:bg-[#F6FCE6]/60">
                        <td className={`${ui.td} font-semibold whitespace-nowrap`}>{r.number}</td>
                        <td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.createdAt)}</td>
                        <td className={ui.td}>{r.customerName}</td>
                        <td className={`${ui.td} tabular-nums`}>{r.phone}</td>
                        <td className={`${ui.td} max-w-[260px] truncate`} title={r.itemWanted}>{r.itemWanted}</td>
                        <td className={ui.td}>{r.staffName || "—"}</td>
                        <td className={`${ui.td} whitespace-nowrap ${followUpStyle[r.followUp] || ""}`}>{r.followUpDate ? `${formatDate(r.followUpDate)}${r.followUp === "overdue" ? " · overdue" : r.followUp === "today" ? " · today" : ""}` : "—"}</td>
                        <td className={ui.td}>{r.locCode}</td>
                        <td className={ui.td}><span className={`${ui.badge} ${ENQUIRY_STATUS[r.status]?.style || ""}`}>{ENQUIRY_STATUS[r.status]?.label || r.status}</span>{r.convertedInvoiceNumber && <span className="ml-1.5 text-[10px] text-[#6B7280]">{r.convertedInvoiceNumber}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>
        </div>
      </div>
    </>
  );
};

export default Enquiries;
