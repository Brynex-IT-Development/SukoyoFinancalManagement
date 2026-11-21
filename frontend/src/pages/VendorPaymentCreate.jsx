import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Wand2 } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { useVendors, MODE_LABEL } from "./PaymentsMade";
import { api, formatCurrency, formatDate, getCurrentUser, round2, ui } from "../utils/retailApi";

const STATUS_LABEL = { paid: "Paid", partially_paid: "Part paid", overdue: "Overdue", unpaid: "Unpaid" };
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// F9: record a payment to a vendor and split it over the vendor's open bills (oldest first).
const VendorPaymentCreate = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const vendors = useVendors();
  const [vendorId, setVendorId] = useState(params.get("vendorId") || "");
  const [bills, setBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [pay, setPay] = useState({}); // billId → amount (string)
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("bank");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(todayIST());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vendorId) { setBills([]); setPay({}); return; }
    let active = true;
    setLoadingBills(true);
    setError("");
    api("/vendor-payments/open-bills", { query: { vendorId } })
      .then((d) => {
        if (!active) return;
        setBills(d.bills || []);
        // Coming from a bill's "Record payment": fill that bill's full balance
        const billId = params.get("billId");
        const b = (d.bills || []).find((x) => String(x._id) === billId);
        if (b) { setPay({ [b._id]: String(b.balanceDue) }); setAmount(String(b.balanceDue)); } else setPay({});
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoadingBills(false));
    return () => { active = false; };
  }, [vendorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocated = useMemo(() => round2(Object.values(pay).reduce((s, v) => s + (Number(v) || 0), 0)), [pay]);
  const totalDue = useMemo(() => round2(bills.reduce((s, b) => s + b.balanceDue, 0)), [bills]);
  const amt = round2(Number(amount) || 0);
  const overBills = bills.filter((b) => (Number(pay[b._id]) || 0) > b.balanceDue + 0.004);
  const canSave = vendorId && amt > 0 && Math.abs(allocated - amt) <= 0.01 && !overBills.length && !saving;

  const autoAllocate = () => {
    let left = amt;
    const next = {};
    for (const b of bills) { // already oldest first
      if (left <= 0) break;
      const take = round2(Math.min(left, b.balanceDue));
      if (take > 0) { next[b._id] = String(take); left = round2(left - take); }
    }
    setPay(next);
    setError(left > 0.004 ? `₹${left.toFixed(2)} is more than this vendor's open bills. Advances are not supported, so lower the amount.` : "");
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (!canSave) return;
    setSaving(true);
    try {
      const allocations = Object.entries(pay).filter(([, v]) => Number(v) > 0).map(([billId, v]) => ({ billId, amount: round2(Number(v)) }));
      const p = await api("/vendor-payments", {
        method: "POST",
        body: { vendorId, amount: amt, mode, reference, date, notes, allocations, locCode: getCurrentUser().locCode },
      });
      navigate(`/purchase/payments/${p._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="New Vendor Payment" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>New Vendor Payment</h1>
              <p className={ui.sub}>Choose the vendor, enter the amount, and split it over their unpaid bills.</p>
            </div>
            <Link to="/purchase/payments" className={ui.btn}><ArrowLeft size={14} /> Payments Made</Link>
          </div>
        </div>

        <form onSubmit={save} className="px-6 py-5 space-y-5 max-w-6xl">
          <div className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-6 gap-4`}>
            <div className="md:col-span-2">
              <label className={ui.label}>Vendor <span className="text-red-500">*</span></label>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={ui.input}>
                <option value="">Choose a vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                {vendorId && !vendors.some((v) => v.id === vendorId) && <option value={vendorId}>{bills[0]?.vendorName || vendorId}</option>}
              </select>
            </div>
            <div>
              <label className={ui.label}>Amount paid (₹) <span className="text-red-500">*</span></label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={ui.input} />
            </div>
            <div>
              <label className={ui.label}>Paid by</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className={ui.input}>
                {Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={ui.label}>Reference{mode === "cheque" && <span className="text-red-500"> *</span>}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={mode === "cheque" ? "Cheque no." : "UTR / txn id"} className={ui.input} />
            </div>
            <div>
              <label className={ui.label}>Payment date</label>
              <input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className={ui.input} />
            </div>
            <div className="md:col-span-6">
              <label className={ui.label}>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={ui.input} />
            </div>
          </div>

          {vendorId && (
            <section className={`${ui.card} overflow-x-auto`}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
                <p className="text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Unpaid bills · {formatCurrency(totalDue)} due</p>
                <button type="button" onClick={autoAllocate} disabled={!(amt > 0) || !bills.length} className={ui.btn}><Wand2 size={14} /> Auto-allocate oldest first</button>
              </div>
              <table className="min-w-full border-collapse mt-3">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Bill #</th><th className={ui.th}>Bill date</th><th className={ui.th}>Due date</th><th className={ui.th}>Status</th>
                  <th className={ui.thRight}>Total</th><th className={ui.thRight}>Paid</th><th className={ui.thRight}>Balance</th><th className="px-3 py-3 text-right whitespace-nowrap">Pay now (₹)</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {loadingBills && <tr><td colSpan={8} className="px-3 py-8 text-center text-[#6B7280]">Loading bills…</td></tr>}
                  {!loadingBills && bills.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-[#6B7280]">This vendor has no unpaid bills.</td></tr>}
                  {bills.map((b) => {
                    const over = (Number(pay[b._id]) || 0) > b.balanceDue + 0.004;
                    return (
                      <tr key={b._id}>
                        <td className={`${ui.td} font-semibold`}><Link to={`/purchase/bills/${b._id}`} className="hover:underline">{b.billNumber}</Link></td>
                        <td className={ui.td}>{formatDate(b.billDate)}</td>
                        <td className={ui.td}>{formatDate(b.effectiveDueDate)}{b.daysOverdue > 0 && <span className="text-red-600"> · {b.daysOverdue}d late</span>}</td>
                        <td className={ui.td}>{STATUS_LABEL[b.paymentStatus] || b.paymentStatus}</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(b.finalTotal)}</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(b.amountPaid + b.creditsApplied)}</td>
                        <td className={`${ui.td} text-right font-semibold`}>{formatCurrency(b.balanceDue)}</td>
                        <td className={`${ui.td} text-right`}>
                          <input type="number" min="0" step="0.01" value={pay[b._id] || ""} onChange={(e) => setPay((p) => ({ ...p, [b._id]: e.target.value }))}
                            className={`${ui.input} w-28 text-right ${over ? "border-red-400" : ""}`} placeholder="0.00" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex flex-wrap justify-end gap-6 px-4 py-3 text-xs border-t border-[#E5E7EB]">
                <span>Allocated: <b>{formatCurrency(allocated)}</b></span>
                <span>Payment: <b>{formatCurrency(amt)}</b></span>
                <span className={Math.abs(allocated - amt) <= 0.01 ? "text-[#15803d] font-semibold" : "text-red-600 font-semibold"}>
                  {Math.abs(allocated - amt) <= 0.01 ? "Matches" : `Difference ${formatCurrency(round2(amt - allocated))}`}
                </span>
              </div>
            </section>
          )}

          {overBills.length > 0 && <p className="text-xs font-semibold text-red-600">Pay-now is more than the balance on {overBills.map((b) => b.billNumber).join(", ")}.</p>}
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          <div className="flex justify-end gap-2.5">
            <Link to="/purchase/payments" className={ui.btn}>Cancel</Link>
            <button type="submit" disabled={!canSave} className={ui.btnDark}>{saving ? "Saving..." : `Save payment ${amt > 0 ? formatCurrency(amt) : ""}`}</button>
          </div>
        </form>
      </div>
    </>
  );
};

export default VendorPaymentCreate;
