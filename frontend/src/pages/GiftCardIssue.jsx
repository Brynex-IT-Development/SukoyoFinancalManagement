import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Plus } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import CodeSheet from "../components/offers/CodeSheet";
import { api, formatCurrency, formatDate, getCurrentUser, isAdminUser, normalizePhone, ui } from "../utils/retailApi";

const EMPTY = { count: "1", value: "", code: "", expiryMode: "days", expiryDays: "365", expiryDate: "", reloadable: false, paymentMode: "cash", customerPhone: "", customerName: "" };

// Issue (sell) one gift card or a batch of cards with the same value.
const GiftCardIssue = () => {
  const isSidebarOpen = useSidebar();
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const sheetRef = useRef(null);
  const print = useReactToPrint({ contentRef: sheetRef, documentTitle: result ? `Gift cards ${result.saleRef}` : "Gift cards" });
  const admin = isAdminUser();
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const count = Math.max(1, parseInt(f.count, 10) || 1);
  const value = Number(f.value) || 0;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(value > 0)) return setError("Enter the card value.");
    if (count > 500) return setError("At most 500 cards at a time.");
    if (f.customerPhone && !normalizePhone(f.customerPhone)) return setError("Buyer phone number is not valid.");
    if (f.paymentMode !== "complimentary" && !window.confirm(`Record ₹${(count * value).toLocaleString("en-IN")} received by ${f.paymentMode.toUpperCase()} for ${count} gift card${count > 1 ? "s" : ""}?`)) return;
    setSaving(true);
    try {
      const res = await api("/gift-cards/issue", {
        method: "POST",
        body: {
          count, value, code: count === 1 ? f.code : "", reloadable: f.reloadable, paymentMode: f.paymentMode,
          expiryDays: f.expiryMode === "days" ? Number(f.expiryDays) || 0 : undefined,
          expiryDate: f.expiryMode === "date" ? f.expiryDate : undefined,
          customerPhone: f.customerPhone, customerName: f.customerName, locCode: getCurrentUser().locCode,
        },
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sheetCards = (result?.cards || []).map((c) => ({
    code: c.code, title: "Gift Card", value: formatCurrency(c.initialValue),
    lines: [c.expiryDate ? `Valid till ${formatDate(c.expiryDate)}` : "No expiry", c.reloadable ? "Reloadable" : "", "Use at billing. Can be spent in parts. Not exchangeable for cash."],
  }));

  return (
    <>
      <Header title="Issue Gift Cards" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Issue Gift Cards</h1>
              <p className={ui.sub}>Sell one card, or many cards of the same value. The money received goes into today's daybook.</p>
            </div>
            <Link to="/offers/gift-cards" className={ui.btn}><ArrowLeft size={14} /> Gift Cards</Link>
          </div>
        </div>

        <div className="px-6 py-6">
          {result ? (
            <div className={`${ui.card} max-w-3xl p-6 space-y-4`}>
              <p className="text-sm font-bold text-[#111827]">
                {result.cards.length} gift card{result.cards.length > 1 ? "s" : ""} issued · sale {result.saleRef}
              </p>
              <div className="max-h-72 overflow-y-auto border border-[#E5E7EB]">
                <table className="min-w-full text-xs">
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {result.cards.map((c) => (
                      <tr key={c._id}>
                        <td className="px-3 py-2"><Link to={`/offers/gift-cards/${c._id}`} className="font-mono font-semibold hover:underline">{c.code}</Link></td>
                        <td className="px-3 py-2 text-right">{formatCurrency(c.initialValue)}</td>
                        <td className="px-3 py-2">{c.expiryDate ? `till ${formatDate(c.expiryDate)}` : "no expiry"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2.5 justify-end">
                <button type="button" className={ui.btn} onClick={() => { setResult(null); setF(EMPTY); }}><Plus size={14} /> Issue more</button>
                <button type="button" className={ui.btnDark} onClick={() => print()}><Printer size={14} /> Print cards</button>
              </div>
              <div style={{ display: "none" }}><CodeSheet ref={sheetRef} heading={`Gift cards · ${result.saleRef}`} cards={sheetCards} /></div>
            </div>
          ) : (
            <form onSubmit={submit} className={`${ui.card} max-w-3xl p-6 space-y-5`}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={ui.label}>Number of cards</label>
                  <input type="number" min="1" max="500" value={f.count} onChange={set("count")} className={ui.input} />
                </div>
                <div>
                  <label className={ui.label}>Value per card (₹) <span className="text-red-500">*</span></label>
                  <input type="number" min="1" step="0.01" value={f.value} onChange={set("value")} className={ui.input} placeholder="e.g. 1000" />
                </div>
                <div>
                  <label className={ui.label}>Code (single card only)</label>
                  <input value={f.code} onChange={set("code")} disabled={count > 1} className={ui.input} placeholder={count > 1 ? "Generated" : "Leave empty to generate"} style={{ textTransform: "uppercase" }} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className={ui.label}>Expiry</label>
                  <select value={f.expiryMode} onChange={set("expiryMode")} className={ui.input}>
                    <option value="days">Valid for a number of days</option>
                    <option value="date">Valid until a date</option>
                    <option value="never">Never expires</option>
                  </select>
                </div>
                {f.expiryMode === "days" && (
                  <div><label className={ui.label}>Days</label><input type="number" min="1" value={f.expiryDays} onChange={set("expiryDays")} className={ui.input} /></div>
                )}
                {f.expiryMode === "date" && (
                  <div><label className={ui.label}>Valid until</label><input type="date" value={f.expiryDate} onChange={set("expiryDate")} className={ui.input} /></div>
                )}
                <label className="flex items-center gap-2 text-xs font-semibold text-[#111827] h-9 cursor-pointer">
                  <input type="checkbox" checked={f.reloadable} onChange={set("reloadable")} className="w-4 h-4 accent-[#1C1F26]" /> Reloadable
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={ui.label}>Paid by</label>
                  <select value={f.paymentMode} onChange={set("paymentMode")} className={ui.input}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="bank">Card / Bank</option>
                    {admin && <option value="complimentary">Complimentary (no payment)</option>}
                  </select>
                </div>
                <div>
                  <label className={ui.label}>Buyer phone (optional)</label>
                  <input value={f.customerPhone} onChange={set("customerPhone")} className={ui.input} placeholder="Links the card to a customer" inputMode="tel" />
                </div>
                <div>
                  <label className={ui.label}>Buyer name</label>
                  <input value={f.customerName} onChange={set("customerName")} className={ui.input} />
                </div>
              </div>

              <div className="text-xs bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-[#374151]">
                {f.paymentMode === "complimentary"
                  ? <>Complimentary: {count} card{count > 1 ? "s" : ""} worth {formatCurrency(count * value)} in total. <b>No money is recorded</b>, but the cards can be spent like paid ones.</>
                  : <>Records <b>{formatCurrency(count * value)}</b> received by {f.paymentMode.toUpperCase()} in today's daybook as a "Gift Card Sale".</>}
              </div>

              {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              <div className="flex justify-end gap-2.5">
                <Link to="/offers/gift-cards" className={ui.btn}>Cancel</Link>
                <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Issuing..." : `Issue ${count} card${count > 1 ? "s" : ""}`}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default GiftCardIssue;
