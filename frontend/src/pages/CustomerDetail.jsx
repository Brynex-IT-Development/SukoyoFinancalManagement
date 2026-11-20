import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CSVLink } from "react-csv";
import { ArrowLeft, Pencil, Download } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import {
  api, formatCurrency, formatDate, formatDateTime, isAdminUser, ui, LEDGER_LABELS, STORE_CREDIT_STATUS_STYLES,
} from "../utils/retailApi";

const Stat = ({ label, value }) => (
  <div className={`${ui.card} p-4`}>
    <p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">{label}</p>
    <p className="text-lg font-extrabold text-[#111827] mt-1">{value}</p>
  </div>
);

const isReturn = (inv) => ["return", "refund", "cancel"].includes(String(inv.category || "").toLowerCase());

const CustomerDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("invoices");
  const [adj, setAdj] = useState({ points: "", note: "" });
  const [adjBusy, setAdjBusy] = useState(false);
  const admin = isAdminUser();

  const load = useCallback(() => {
    api(`/customers/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const submitAdjust = async (e) => {
    e.preventDefault();
    const points = Number(adj.points);
    if (!Number.isInteger(points) || points === 0) return alert("Enter a whole number of points (use a minus sign to take points away).");
    if (!adj.note.trim()) return alert("A note explaining the adjustment is required.");
    setAdjBusy(true);
    try {
      await api(`/customers/${id}/loyalty-adjust`, { method: "POST", body: { points, note: adj.note.trim() } });
      setAdj({ points: "", note: "" });
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdjBusy(false);
    }
  };

  if (error) return (<><Header title="Customer" /><div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"} p-6`}><p className="text-xs font-semibold text-red-600">{error}</p></div></>);
  if (!data) return (<><Header title="Customer" /><div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"} p-6`}><p className="text-xs text-[#6B7280]">Loading...</p></div></>);

  const { customer: c, stats, invoices, ledger, storeCredits } = data;
  const tabs = [["invoices", `Invoices (${invoices.length})`], ["points", `Points (${ledger.length})`], ["credits", `Store Credit (${storeCredits.length})`]];

  return (
    <>
      <Header title="Customer" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>{c.name}</h1>
              <p className={ui.sub}>
                {c.phone}{c.email ? ` · ${c.email}` : ""} · <span className={c.status === "inactive" ? "text-[#92400E] font-semibold" : ""}>{c.status}</span>
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <Link to="/sales/customers" className={ui.btn}><ArrowLeft size={14} /> Customers</Link>
              <Link to={`/sales/customers/${id}/edit`} className={ui.btnDark}><Pencil size={14} /> Edit</Link>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Total spend" value={formatCurrency(stats.totalSpend)} />
            <Stat label="Invoices" value={stats.invoiceCount} />
            <Stat label="Last visit" value={formatDate(stats.lastVisit)} />
            <Stat label="Loyalty points" value={c.loyaltyPoints || 0} />
            <Stat label="Store credit" value={formatCurrency(c.storeCreditBalance)} />
          </div>

          <div className={`${ui.card} p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs`}>
            <div><span className="text-[#6B7280]">Address: </span>{[c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ") || "—"}</div>
            <div><span className="text-[#6B7280]">GSTIN: </span>{c.gstin || "—"}</div>
            <div><span className="text-[#6B7280]">Created: </span>{formatDate(c.createdAt)} at store {c.locCode || "—"}</div>
          </div>

          <div className="flex gap-1 border-b border-[#E5E7EB]">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`px-4 py-2 text-xs font-bold uppercase tracking-wider cursor-pointer border-b-2 -mb-px ${tab === k ? "border-[#1C1F26] text-[#111827]" : "border-transparent text-[#6B7280] hover:text-[#111827]"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "invoices" && (
            <section className={`${ui.card} overflow-x-auto`}>
              <table className="min-w-full border-collapse">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Date</th><th className={ui.th}>Invoice #</th><th className={ui.th}>Store</th>
                  <th className={ui.thRight}>Total</th><th className={ui.thRight}>Redeemed / Credit</th><th className={ui.thRight}>Paid / Refunded</th>
                  <th className={ui.thRight}>Points +/−</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {invoices.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-[#6B7280]">No invoices yet.</td></tr>}
                  {invoices.map((inv) => (
                    <tr key={inv._id} className={isReturn(inv) ? "bg-red-50/40" : ""}>
                      <td className={`${ui.td} whitespace-nowrap`}>{formatDate(inv.invoiceDate)}</td>
                      <td className={ui.td}><Link to={`/sales/invoices/${inv._id}`} className="font-semibold text-[#1C1F26] hover:underline">{inv.invoiceNumber}</Link></td>
                      <td className={ui.td}>{inv.branch || inv.locCode || "—"}</td>
                      <td className={`${ui.td} text-right font-semibold ${isReturn(inv) ? "text-red-600" : ""}`}>{formatCurrency(inv.finalTotal)}</td>
                      <td className={`${ui.td} text-right`}>
                        {isReturn(inv)
                          ? (inv.refundBreakdown?.storeCreditAmount ? `Credit ${formatCurrency(inv.refundBreakdown.storeCreditAmount)}` : "—")
                          : (inv.totalRedeemed ? formatCurrency(inv.totalRedeemed) : "—")}
                      </td>
                      <td className={`${ui.td} text-right`}>{formatCurrency(Math.abs(inv.amountDue ?? inv.finalTotal))}</td>
                      <td className={`${ui.td} text-right`}>{inv.loyaltyPointsEarned || inv.loyaltyPointsUsed ? `+${inv.loyaltyPointsEarned || 0} / −${inv.loyaltyPointsUsed || 0}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {tab === "points" && (
            <div className="space-y-4">
              {admin && (
                <form onSubmit={submitAdjust} className={`${ui.card} p-4 flex flex-wrap items-end gap-3`}>
                  <div className="w-36">
                    <label className={ui.label}>Adjust points</label>
                    <input value={adj.points} onChange={(e) => setAdj((a) => ({ ...a, points: e.target.value }))} placeholder="e.g. 50 or -20" className={ui.input} inputMode="numeric" />
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <label className={ui.label}>Reason (required)</label>
                    <input value={adj.note} onChange={(e) => setAdj((a) => ({ ...a, note: e.target.value }))} placeholder="Why the points are being changed" className={ui.input} />
                  </div>
                  <button type="submit" disabled={adjBusy} className={ui.btnDark}>{adjBusy ? "Saving..." : "Apply"}</button>
                </form>
              )}
              <section className={`${ui.card} overflow-x-auto`}>
                <div className="flex justify-end p-2">
                  <CSVLink className={ui.btn} filename={`points-${c.phone}.csv`} data={ledger.map((l) => ({
                    Date: formatDateTime(l.createdAt), Type: LEDGER_LABELS[l.type] || l.type, Points: l.points,
                    "Balance After": l.balanceAfter, Invoice: l.invoiceNumber || "", Note: l.note || "", By: l.createdBy || "",
                  }))}><Download size={14} /> CSV</CSVLink>
                </div>
                <table className="min-w-full border-collapse">
                  <thead><tr className={ui.theadRow}>
                    <th className={ui.th}>Date</th><th className={ui.th}>Type</th><th className={ui.thRight}>Points</th>
                    <th className={ui.thRight}>Balance</th><th className={ui.th}>Invoice</th><th className="px-3 py-3 text-left">Note</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs">
                    {ledger.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-[#6B7280]">No points activity yet.</td></tr>}
                    {ledger.map((l) => (
                      <tr key={l._id}>
                        <td className={`${ui.td} whitespace-nowrap`}>{formatDateTime(l.createdAt)}</td>
                        <td className={ui.td}>{LEDGER_LABELS[l.type] || l.type}</td>
                        <td className={`${ui.td} text-right font-bold ${l.points < 0 ? "text-red-600" : "text-[#15803D]"}`}>{l.points > 0 ? `+${l.points}` : l.points}</td>
                        <td className={`${ui.td} text-right`}>{l.balanceAfter}</td>
                        <td className={ui.td}>{l.invoiceId ? <Link to={`/sales/invoices/${l.invoiceId}`} className="hover:underline">{l.invoiceNumber}</Link> : "—"}</td>
                        <td className={`${ui.td} text-[#4B5563]`}>{l.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {tab === "credits" && (
            <section className={`${ui.card} overflow-x-auto`}>
              <table className="min-w-full border-collapse">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Number</th><th className={ui.th}>Issued</th><th className={ui.th}>Expires</th>
                  <th className={ui.thRight}>Amount</th><th className={ui.thRight}>Balance</th><th className="px-3 py-3 text-left">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {storeCredits.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-[#6B7280]">No store credit.</td></tr>}
                  {storeCredits.map((s) => (
                    <tr key={s._id}>
                      <td className={ui.td}><Link to={`/sales/credit-notes/${s._id}`} className="font-semibold text-[#1C1F26] hover:underline">{s.number}</Link></td>
                      <td className={ui.td}>{formatDate(s.issueDate)}</td>
                      <td className={ui.td}>{s.expiryDate ? formatDate(s.expiryDate) : "Never"}</td>
                      <td className={`${ui.td} text-right`}>{formatCurrency(s.amount)}</td>
                      <td className={`${ui.td} text-right font-semibold`}>{formatCurrency(s.balance)}</td>
                      <td className={ui.td}><span className={`${ui.badge} ${STORE_CREDIT_STATUS_STYLES[s.status] || ""}`}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="text-[11px] text-[#9CA3AF]">Gift cards will appear here once gift cards are added (Phase 2).</p>
        </div>
      </div>
    </>
  );
};

export default CustomerDetail;
