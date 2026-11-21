import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Download, Plus, Gift } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { api, formatCurrency, formatDate, ui, GIFT_CARD_STATUS_STYLES } from "../utils/retailApi";

const GiftCards = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
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
        const data = await api("/gift-cards", { query: { search, status, fromDate, toDate } });
        if (active) setCards(data.cards || []);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [search, status, fromDate, toDate]);

  const totals = useMemo(() => ({
    issued: cards.reduce((s, c) => s + (c.initialValue || 0), 0),
    outstanding: cards.filter((c) => c.status === "active").reduce((s, c) => s + (c.balance || 0), 0),
  }), [cards]);

  const csvData = useMemo(() => cards.map((c) => ({
    Code: c.code, "Initial Value": c.initialValue, Balance: c.balance, Status: c.status, Type: c.issueType,
    Reloadable: c.reloadable ? "Yes" : "No", Issued: formatDate(c.issueDate), Expires: c.expiryDate ? formatDate(c.expiryDate) : "Never",
    "Sold To": c.soldToName || "", "Sale Ref": c.saleInvoiceRef || "", Store: c.locCode || "",
  })), [cards]);

  return (
    <>
      <Header title="Gift Cards" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Gift Cards</h1>
              <p className={ui.sub}>Prepaid cards. Selling or reloading one records the money in the daybook; customers spend them from the billing Apply panel.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <CSVLink data={csvData} filename={`gift-cards-${new Date().toISOString().slice(0, 10)}.csv`} className={ui.btn}><Download size={14} /> Export CSV</CSVLink>
              <Link to="/offers/gift-cards/new" className={ui.btnDark}><Plus size={14} /> Issue Gift Cards</Link>
            </div>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, buyer or sale ref (GCS-)..." className={`${ui.input} pl-9`} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${ui.input} w-36`}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
            <option value="expired">Expired</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#374151]">From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#374151]">To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} />
          </label>
          <span className="inline-flex items-center rounded-none bg-[#F6FCE6] border border-[#ECF9C7] px-3 py-1 text-xs font-bold text-[#15171D]">
            {cards.length} cards · unspent {formatCurrency(totals.outstanding)}
          </span>
        </div>

        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-hidden`}>
            {loading ? (
              <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading gift cards...</p>
            ) : error ? (
              <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
            ) : cards.length === 0 ? (
              <div className="px-8 py-16 text-center flex flex-col items-center">
                <Gift size={28} className="text-[#1C1F26] mb-2" />
                <p className="text-xs text-[#6B7280]">{search || status || fromDate || toDate ? "No gift cards match." : "No gift cards issued yet."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className={ui.theadRow}>
                      <th className={ui.th}>Code</th>
                      <th className={ui.thRight}>Value</th>
                      <th className={ui.thRight}>Balance</th>
                      <th className={ui.th}>Issued</th>
                      <th className={ui.th}>Expires</th>
                      <th className={ui.th}>Sold to</th>
                      <th className={ui.th}>Sale ref</th>
                      <th className="px-3 py-3 text-left whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1F2937]">
                    {cards.map((c, i) => (
                      <tr key={c._id} onClick={() => navigate(`/offers/gift-cards/${c._id}`)}
                        className={`${i % 2 ? "bg-[#F9FAFB]/40" : "bg-white"} hover:bg-[#F6FCE6]/60 cursor-pointer`}>
                        <td className={`${ui.td} font-mono font-semibold text-[#111827]`}>{c.code}{c.reloadable && <span className="ml-1.5 text-[10px] font-sans text-[#6B7280]">reloadable</span>}</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(c.initialValue)}</td>
                        <td className={`${ui.td} text-right font-bold`}>{formatCurrency(c.balance)}</td>
                        <td className={`${ui.td} whitespace-nowrap`}>{formatDate(c.issueDate)}</td>
                        <td className={`${ui.td} whitespace-nowrap`}>{c.expiryDate ? formatDate(c.expiryDate) : "Never"}</td>
                        <td className={ui.td}>{c.soldToName || (c.issueType === "complimentary" ? "Complimentary" : "—")}</td>
                        <td className={ui.td}>{c.saleInvoiceRef || "—"}</td>
                        <td className={ui.td}><span className={`${ui.badge} ${GIFT_CARD_STATUS_STYLES[c.status] || ""}`}>{c.status}</span></td>
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

export default GiftCards;
