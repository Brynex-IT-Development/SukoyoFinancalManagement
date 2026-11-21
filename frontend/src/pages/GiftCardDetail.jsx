import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Ban, CheckCircle2 } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import CodeSheet from "../components/offers/CodeSheet";
import { api, formatCurrency, formatDate, formatDateTime, getCurrentUser, isAdminUser, ui, GIFT_CARD_STATUS_STYLES } from "../utils/retailApi";

const HISTORY_LABELS = { issue: "Issued", redeem: "Spent", reload: "Reloaded", reverse: "Put back" };

const GiftCardDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState({ amount: "", paymentMode: "cash" });
  const sheetRef = useRef(null);
  const print = useReactToPrint({ contentRef: sheetRef, documentTitle: card ? `Gift card ${card.code}` : "Gift card" });
  const admin = isAdminUser();

  const load = useCallback(() => { api(`/gift-cards/${id}`).then(setCard).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);

  const doReload = async (e) => {
    e.preventDefault();
    const amount = Number(reload.amount);
    if (!(amount > 0)) return alert("Enter the reload amount.");
    if (!window.confirm(`Record ₹${amount.toLocaleString("en-IN")} received by ${reload.paymentMode.toUpperCase()} and add it to ${card.code}?`)) return;
    setBusy(true);
    try {
      setCard(await api(`/gift-cards/${id}/reload`, { method: "POST", body: { amount, paymentMode: reload.paymentMode, locCode: getCurrentUser().locCode } }));
      setReload({ amount: "", paymentMode: "cash" });
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    const blocking = card.status !== "blocked";
    if (!window.confirm(blocking ? `Block ${card.code}? It cannot be spent until it is unblocked.` : `Unblock ${card.code}?`)) return;
    setBusy(true);
    try {
      setCard(await api(`/gift-cards/${id}/block`, { method: "POST", body: { blocked: blocking } }));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (content) => (<><Header title="Gift Card" /><div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>{content}</div></>);
  if (error) return shell(<p className="p-6 text-xs font-semibold text-red-600">{error}</p>);
  if (!card) return shell(<p className="p-6 text-xs text-[#6B7280]">Loading...</p>);

  const history = [...(card.history || [])].reverse();

  return shell(
    <>
      <div className={ui.topBar}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className={`${ui.h1} font-mono`}>{card.code}</h1>
            <p className={ui.sub}>Gift card · {card.issueType === "complimentary" ? "complimentary" : `sold (${card.saleInvoiceRef})`}{card.soldToName ? ` · ${card.soldToName}` : ""}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link to="/offers/gift-cards" className={ui.btn}><ArrowLeft size={14} /> Gift Cards</Link>
            {admin && card.status !== "expired" && (
              <button type="button" onClick={toggleBlock} disabled={busy} className={ui.btn}>
                {card.status === "blocked" ? <><CheckCircle2 size={14} /> Unblock</> : <><Ban size={14} /> Block</>}
              </button>
            )}
            <button type="button" onClick={() => print()} className={ui.btnDark}><Printer size={14} /> Print</button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-5">
          <div className={`${ui.card} p-5 space-y-3 text-xs`}>
            <div className="flex justify-between"><span className="text-[#6B7280]">Status</span><span className={`${ui.badge} ${GIFT_CARD_STATUS_STYLES[card.status] || ""}`}>{card.status}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Initial value</span><span className="font-semibold">{formatCurrency(card.initialValue)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-[#6B7280]">Balance</span><span className="font-extrabold">{formatCurrency(card.balance)}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Issued</span><span>{formatDate(card.issueDate)}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Expires</span><span>{card.expiryDate ? formatDate(card.expiryDate) : "Never"}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Reloadable</span><span>{card.reloadable ? "Yes" : "No"}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Sold to</span>
              {card.soldToCustomerId ? <Link to={`/sales/customers/${card.soldToCustomerId}`} className="font-semibold hover:underline">{card.soldToName || "Customer"}</Link> : <span>{card.soldToName || "—"}</span>}
            </div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Store</span><span>{card.locCode || "—"}</span></div>
          </div>

          {card.reloadable && card.status === "active" && (
            <form onSubmit={doReload} className={`${ui.card} p-5 space-y-3`}>
              <p className={ui.sectionTitle}>Reload</p>
              <div className="flex gap-2">
                <input type="number" min="1" step="0.01" value={reload.amount} onChange={(e) => setReload((r) => ({ ...r, amount: e.target.value }))} placeholder="Amount ₹" className={ui.input} />
                <select value={reload.paymentMode} onChange={(e) => setReload((r) => ({ ...r, paymentMode: e.target.value }))} className={`${ui.input} w-32`}>
                  <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Card / Bank</option>
                </select>
              </div>
              <button type="submit" disabled={busy} className={`${ui.btnDark} w-full justify-center`}>{busy ? "Saving..." : "Reload card"}</button>
              <p className="text-[11px] text-[#6B7280]">The amount is recorded in today's daybook as a "Gift Card Reload".</p>
            </form>
          )}
        </div>

        <section className={`${ui.card} overflow-x-auto lg:col-span-2`}>
          <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">History</p>
          <table className="min-w-full border-collapse mt-3">
            <thead><tr className={ui.theadRow}>
              <th className={ui.th}>Date</th><th className={ui.th}>What</th><th className={ui.thRight}>Amount</th><th className={ui.th}>Bill / ref</th><th className="px-3 py-3 text-left">By</th>
            </tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {history.map((h) => (
                <tr key={h._id} className={h.reversed ? "text-[#9CA3AF]" : ""}>
                  <td className={`${ui.td} whitespace-nowrap`}>{formatDateTime(h.date)}</td>
                  <td className={ui.td}>{HISTORY_LABELS[h.type] || h.type}{h.reversed ? " (put back later)" : ""}{h.note ? <span className="text-[#9CA3AF]"> · {h.note}</span> : null}</td>
                  <td className={`${ui.td} text-right font-semibold ${h.type === "redeem" ? "text-red-600" : "text-[#15803D]"}`}>{h.type === "redeem" ? "−" : "+"}{formatCurrency(h.amount)}</td>
                  <td className={ui.td}>{h.invoiceId ? <Link to={`/sales/invoices/${h.invoiceId}`} className="hover:underline">{h.invoiceNumber}</Link> : (h.reference || "—")}</td>
                  <td className={`${ui.td} text-[#6B7280]`}>{h.by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div style={{ display: "none" }}>
        <CodeSheet ref={sheetRef} cards={[{ code: card.code, title: "Gift Card", value: formatCurrency(card.balance),
          lines: [card.expiryDate ? `Valid till ${formatDate(card.expiryDate)}` : "No expiry", `Balance as of ${formatDate(new Date())}`, "Use at billing. Can be spent in parts. Not exchangeable for cash."] }]} />
      </div>
    </>
  );
};

export default GiftCardDetail;
