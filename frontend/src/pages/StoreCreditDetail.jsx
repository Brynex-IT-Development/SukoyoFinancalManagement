import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Ban } from "lucide-react";
import Header from "../components/Header";
import useCompanyProfile, { companyAddressLine } from "../hooks/useCompanyProfile";
import useSidebar from "../hooks/useSidebar";
import { api, formatCurrency, formatDate, formatDateTime, isAdminUser, ui, STORE_CREDIT_STATUS_STYLES } from "../utils/retailApi";

const StoreCreditDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const [sc, setSc] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const slipRef = useRef(null);
  const company = useCompanyProfile();
  const print = useReactToPrint({ contentRef: slipRef, documentTitle: sc ? `Store credit ${sc.number}` : "Store credit" });

  const load = useCallback(() => {
    api(`/store-credits/${id}`).then(setSc).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const voidCredit = async () => {
    if (!window.confirm(`Void ${sc.number}? Its remaining ${formatCurrency(sc.balance)} can no longer be used. This cannot be undone.`)) return;
    setBusy(true);
    try {
      setSc(await api(`/store-credits/${id}/void`, { method: "POST" }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (content) => (
    <>
      <Header title="Store Credit" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>{content}</div>
    </>
  );
  if (error) return shell(<p className="p-6 text-xs font-semibold text-red-600">{error}</p>);
  if (!sc) return shell(<p className="p-6 text-xs text-[#6B7280]">Loading...</p>);

  return shell(
    <>
      <div className={ui.topBar}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className={ui.h1}>{sc.number}</h1>
            <p className={ui.sub}>Store credit for {sc.customerName} · {sc.customerPhone}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link to="/sales/credit-notes" className={ui.btn}><ArrowLeft size={14} /> Store Credit</Link>
            {isAdminUser() && ["open", "expired"].includes(sc.status) && (
              <button type="button" onClick={voidCredit} disabled={busy} className={ui.btn}><Ban size={14} /> Void</button>
            )}
            <button type="button" onClick={() => print()} className={ui.btnDark}><Printer size={14} /> Print Slip</button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`${ui.card} p-5 space-y-3 text-xs lg:col-span-1`}>
          <div className="flex justify-between"><span className="text-[#6B7280]">Status</span><span className={`${ui.badge} ${STORE_CREDIT_STATUS_STYLES[sc.status] || ""}`}>{sc.status}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Amount issued</span><span className="font-semibold">{formatCurrency(sc.amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-[#6B7280]">Balance</span><span className="font-extrabold">{formatCurrency(sc.balance)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Issued</span><span>{formatDate(sc.issueDate)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Expires</span><span>{sc.expiryDate ? formatDate(sc.expiryDate) : "Never"}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Return invoice</span>
            {sc.returnInvoiceId ? <Link className="font-semibold hover:underline" to={`/sales/invoices/${sc.returnInvoiceId}`}>{sc.returnInvoiceNumber}</Link> : <span>—</span>}</div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Original invoice</span>
            {sc.sourceInvoiceId ? <Link className="font-semibold hover:underline" to={`/sales/invoices/${sc.sourceInvoiceId}`}>{sc.sourceInvoiceNumber}</Link> : <span>—</span>}</div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Customer</span><Link className="font-semibold hover:underline" to={`/sales/customers/${sc.customerId}`}>{sc.customerName}</Link></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Store</span><span>{sc.locCode || "—"}</span></div>
        </div>

        <section className={`${ui.card} overflow-x-auto lg:col-span-2`}>
          <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Redemption history</p>
          <table className="min-w-full border-collapse mt-3">
            <thead><tr className={ui.theadRow}>
              <th className={ui.th}>Date</th><th className={ui.th}>Invoice</th><th className={ui.thRight}>Amount</th><th className="px-3 py-3 text-left">Note</th>
            </tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {(sc.redemptions || []).length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-[#6B7280]">Not used yet.</td></tr>}
              {(sc.redemptions || []).map((r, i) => (
                <tr key={i} className={r.reversed ? "text-[#9CA3AF] line-through" : ""}>
                  <td className={`${ui.td} whitespace-nowrap`}>{formatDateTime(r.date)}</td>
                  <td className={ui.td}>{r.invoiceId ? <Link className="hover:underline" to={`/sales/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link> : r.invoiceNumber}</td>
                  <td className={`${ui.td} text-right font-semibold`}>{formatCurrency(r.amount)}</td>
                  <td className={`${ui.td} no-underline`}>{r.reversed ? `Put back ${formatDate(r.reversedAt)} (invoice edited or deleted)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Printable slip (hidden on screen, printed via react-to-print) */}
      <div style={{ display: "none" }}>
        <div ref={slipRef} style={{ width: "80mm", padding: "6mm", fontFamily: "Arial, sans-serif", color: "#111" }}>
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>STORE CREDIT</div>
          {company?.companyName && <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, marginTop: 2 }}>{company.companyName}</div>}
          {companyAddressLine(company) && <div style={{ textAlign: "center", fontSize: 9 }}>{companyAddressLine(company)}</div>}
          {company?.gstin && <div style={{ textAlign: "center", fontSize: 9 }}>GSTIN {company.gstin}</div>}
          <div style={{ textAlign: "center", fontSize: 11, marginTop: 2 }}>Store {sc.locCode || ""}</div>
          <hr style={{ margin: "8px 0" }} />
          <div style={{ fontSize: 12 }}>Credit no.</div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>{sc.number}</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>Customer: <b>{sc.customerName}</b></div>
          <div style={{ fontSize: 12 }}>Phone: {sc.customerPhone}</div>
          <div style={{ fontSize: 12 }}>Issued: {formatDate(sc.issueDate)}</div>
          <div style={{ fontSize: 12 }}>Valid till: <b>{sc.expiryDate ? formatDate(sc.expiryDate) : "No expiry"}</b></div>
          {sc.returnInvoiceNumber && <div style={{ fontSize: 12 }}>Against return: {sc.returnInvoiceNumber}</div>}
          <hr style={{ margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>Amount issued</span><span>{formatCurrency(sc.amount)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800 }}><span>Balance</span><span>{formatCurrency(sc.balance)}</span></div>
          <hr style={{ margin: "8px 0" }} />
          <div style={{ fontSize: 10, lineHeight: 1.4 }}>
            Can be used in part over several bills by the customer named above. Not exchangeable for cash.
            Show this slip or quote the credit number at billing.
          </div>
        </div>
      </div>
    </>
  );
};

export default StoreCreditDetail;
