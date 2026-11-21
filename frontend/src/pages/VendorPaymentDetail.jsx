import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Trash2 } from "lucide-react";
import Header from "../components/Header";
import useCompanyProfile, { companyAddressLine } from "../hooks/useCompanyProfile";
import useSidebar from "../hooks/useSidebar";
import { MODE_LABEL } from "./PaymentsMade";
import { api, formatCurrency, formatDate, formatDateTime, isAdminUser, ui } from "../utils/retailApi";

const STATUS_LABEL = { paid: "Paid", partially_paid: "Part paid", overdue: "Overdue", unpaid: "Unpaid" };

// F9: one vendor payment, how it was split over bills, and a printable payment receipt.
const VendorPaymentDetail = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const receiptRef = useRef(null);
  const company = useCompanyProfile();
  const print = useReactToPrint({ contentRef: receiptRef, documentTitle: () => (p ? `Payment ${p.number}` : "Payment") });

  const load = useCallback(() => {
    api(`/vendor-payments/${id}`).then(setP).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const remove = async () => {
    if (!window.confirm(`Delete ${p.number}? ${formatCurrency(p.amount)} becomes due again on ${p.allocations.map((a) => a.billNumber).join(", ")} and the daybook entry is removed.`)) return;
    setBusy(true);
    try {
      const r = await api(`/vendor-payments/${id}`, { method: "DELETE" });
      window.alert(r.message);
      navigate("/purchase/payments");
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (content) => (
    <>
      <Header title="Vendor Payment" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>{content}</div>
    </>
  );
  if (error) return shell(<p className="p-6 text-xs font-semibold text-red-600">{error}</p>);
  if (!p) return shell(<p className="p-6 text-xs text-[#6B7280]">Loading...</p>);

  const billInfo = Object.fromEntries((p.bills || []).map((b) => [String(b._id), b]));
  const cell = { border: "1px solid #999", padding: "4px 6px" };

  return shell(
    <>
      <div className={ui.topBar}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className={ui.h1}>{p.number}</h1>
            <p className={ui.sub}>Paid to {p.vendorName} · {formatDate(p.date)} · {MODE_LABEL[p.mode] || p.mode}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link to="/purchase/payments" className={ui.btn}><ArrowLeft size={14} /> Payments Made</Link>
            {isAdminUser() && <button type="button" onClick={remove} disabled={busy} className={ui.btn}><Trash2 size={14} /> Delete</button>}
            <button type="button" onClick={() => print()} className={ui.btnDark}><Printer size={14} /> Print Receipt</button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`${ui.card} p-5 space-y-3 text-xs`}>
          <div className="flex justify-between text-sm"><span className="text-[#6B7280]">Amount paid</span><span className="font-extrabold">{formatCurrency(p.amount)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Vendor</span>
            {p.vendorId ? <Link className="font-semibold hover:underline" to={`/purchase/vendors/${p.vendorId}`}>{p.vendorName}</Link> : <span>{p.vendorName}</span>}</div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Date</span><span>{formatDate(p.date)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Paid by</span><span>{MODE_LABEL[p.mode] || p.mode}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Reference</span><span>{p.reference || "—"}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Store</span><span>{p.locCode || "—"}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Recorded</span><span>{formatDateTime(p.createdAt)}{p.createdBy ? ` · ${p.createdBy}` : ""}</span></div>
          {p.notes && <div><span className="text-[#6B7280]">Notes</span><p className="mt-1">{p.notes}</p></div>}
        </div>

        <section className={`${ui.card} overflow-x-auto lg:col-span-2`}>
          <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Bills paid</p>
          <table className="min-w-full border-collapse mt-3">
            <thead><tr className={ui.theadRow}>
              <th className={ui.th}>Bill #</th><th className={ui.th}>Bill date</th><th className={ui.thRight}>Bill total</th>
              <th className={ui.thRight}>Paid by this payment</th><th className={ui.thRight}>Balance now</th><th className="px-3 py-3 text-left">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {p.allocations.map((a) => {
                const b = billInfo[String(a.billId)];
                return (
                  <tr key={String(a.billId)}>
                    <td className={`${ui.td} font-semibold`}><Link to={`/purchase/bills/${a.billId}`} className="hover:underline">{a.billNumber}</Link></td>
                    <td className={ui.td}>{b ? formatDate(b.billDate) : "—"}</td>
                    <td className={`${ui.td} text-right`}>{b ? formatCurrency(b.finalTotal) : "—"}</td>
                    <td className={`${ui.td} text-right font-semibold`}>{formatCurrency(a.amount)}</td>
                    <td className={`${ui.td} text-right`}>{b ? formatCurrency(b.balanceDue) : "—"}</td>
                    <td className={ui.td}>{b ? STATUS_LABEL[b.paymentStatus] || b.paymentStatus : "Bill deleted"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      {/* Printable receipt (hidden on screen) */}
      <div style={{ display: "none" }}>
        <div ref={receiptRef} style={{ width: "190mm", padding: "10mm", fontFamily: "Arial, sans-serif", color: "#111", fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              {company?.logo && <img src={company.logo} alt="" style={{ maxHeight: 48, marginBottom: 4 }} />}
              <div style={{ fontSize: 16, fontWeight: 800 }}>{company?.companyName || "Payment receipt"}</div>
              {companyAddressLine(company) && <div style={{ fontSize: 10 }}>{companyAddressLine(company)}</div>}
              {company?.gstin && <div style={{ fontSize: 10 }}>GSTIN {company.gstin}</div>}
              {(company?.phone || company?.email) && <div style={{ fontSize: 10 }}>{[company.phone, company.email].filter(Boolean).join(" · ")}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>PAYMENT MADE</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{p.number}</div>
              <div>Date: {formatDate(p.date)}</div>
              {p.locCode && <div>Store: {p.locCode}</div>}
            </div>
          </div>
          <hr style={{ margin: "10px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, color: "#555" }}>PAID TO</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{p.vendorName}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#555" }}>AMOUNT PAID</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{formatCurrency(p.amount)}</div>
              <div>{MODE_LABEL[p.mode] || p.mode}{p.reference ? ` · Ref ${p.reference}` : ""}</div>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={{ ...cell, textAlign: "left" }}>Bill #</th>
                <th style={{ ...cell, textAlign: "left" }}>Bill date</th>
                <th style={{ ...cell, textAlign: "right" }}>Bill total</th>
                <th style={{ ...cell, textAlign: "right" }}>Paid now</th>
                <th style={{ ...cell, textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {p.allocations.map((a) => {
                const b = billInfo[String(a.billId)];
                return (
                  <tr key={String(a.billId)}>
                    <td style={cell}>{a.billNumber}</td>
                    <td style={cell}>{b ? formatDate(b.billDate) : ""}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{b ? formatCurrency(b.finalTotal) : ""}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{formatCurrency(a.amount)}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{b ? formatCurrency(b.balanceDue) : ""}</td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ ...cell, fontWeight: 700 }} colSpan={3}>Total</td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{formatCurrency(p.amount)}</td>
                <td style={cell} />
              </tr>
            </tbody>
          </table>
          {p.notes && <div style={{ marginTop: 10 }}>Notes: {p.notes}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 48 }}>
            <div style={{ borderTop: "1px solid #555", width: "60mm", textAlign: "center", paddingTop: 4 }}>Received by (vendor)</div>
            <div style={{ borderTop: "1px solid #555", width: "60mm", textAlign: "center", paddingTop: 4 }}>Authorised signatory</div>
          </div>
        </div>
      </div>
    </>
  );
};

export default VendorPaymentDetail;
