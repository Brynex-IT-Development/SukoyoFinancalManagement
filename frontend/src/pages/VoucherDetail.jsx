import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Power } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import CodeSheet from "../components/offers/CodeSheet";
import { api, formatCurrency, formatDate, formatDateTime, isAdminUser, ui, voucherState, voucherValueText, VOUCHER_STATE_STYLES } from "../utils/retailApi";

const VoucherDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const [v, setV] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef(null);
  const print = useReactToPrint({ contentRef: sheetRef, documentTitle: v ? `Voucher ${v.code}` : "Voucher" });

  const load = useCallback(() => { api(`/vouchers/${id}`).then(setV).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);

  const toggle = async () => {
    setBusy(true);
    try {
      setV(await api(`/vouchers/${id}/active`, { method: "PATCH", body: { active: !v.active } }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (content) => (<><Header title="Voucher" /><div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>{content}</div></>);
  if (error) return shell(<p className="p-6 text-xs font-semibold text-red-600">{error}</p>);
  if (!v) return shell(<p className="p-6 text-xs text-[#6B7280]">Loading...</p>);

  const st = voucherState(v);
  const scope = v.scope || {};
  const scopeParts = [
    scope.brands?.length && `Brands: ${scope.brands.join(", ")}`,
    scope.categories?.length && `Categories: ${scope.categories.join(", ")}`,
    scope.subCategories?.length && `Sub categories: ${scope.subCategories.join(", ")}`,
    scope.itemLabels?.length && `Items: ${scope.itemLabels.join(", ")}`,
  ].filter(Boolean);
  const usages = [...(v.usages || [])].reverse();
  const row = (label, value) => <div className="flex justify-between gap-3"><span className="text-[#6B7280]">{label}</span><span className="text-right">{value}</span></div>;

  return shell(
    <>
      <div className={ui.topBar}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className={`${ui.h1} font-mono`}>{v.code}</h1>
            <p className={ui.sub}>{v.name || "Voucher"} · {voucherValueText(v)}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link to="/offers/vouchers" className={ui.btn}><ArrowLeft size={14} /> Vouchers</Link>
            {isAdminUser() && <button type="button" onClick={toggle} disabled={busy} className={ui.btn}><Power size={14} /> {v.active ? "Switch off" : "Switch on"}</button>}
            <button type="button" onClick={() => print()} className={ui.btnDark}><Printer size={14} /> Print</button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`${ui.card} p-5 space-y-3 text-xs`}>
          {row("State", <span className={`${ui.badge} ${VOUCHER_STATE_STYLES[st] || ""}`}>{st}</span>)}
          {row("Type", v.kind === "value" ? "Stored value" : `Discount (${v.discountType})`)}
          {row("Value", voucherValueText(v))}
          {v.kind === "value" && row("Balance", <b>{formatCurrency(v.balance)}</b>)}
          {row("Min bill", v.minBillAmount ? formatCurrency(v.minBillAmount) : "—")}
          {row("Used", `${v.usedCount}${v.usageLimitTotal ? ` of ${v.usageLimitTotal}` : " (no limit)"}`)}
          {row("Per customer", v.usageLimitPerCustomer ? `${v.usageLimitPerCustomer} use(s)` : "No limit")}
          {row("Valid", v.validFrom || v.validTo ? `${v.validFrom ? formatDate(v.validFrom) : "…"} – ${v.validTo ? formatDate(v.validTo) : "…"}` : "Always")}
          {row("Only for", v.customerId ? <Link className="font-semibold hover:underline" to={`/sales/customers/${v.customerId}`}>{v.customerName || "Customer"}</Link> : "Anyone")}
          {row("Store", v.locCode || "All stores")}
          {row("Applies to", scopeParts.length ? <span className="block">{scopeParts.map((p) => <span key={p} className="block">{p}</span>)}</span> : "All items")}
          {v.batchRef && row("Batch", v.batchRef)}
        </div>

        <section className={`${ui.card} overflow-x-auto lg:col-span-2`}>
          <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Usages</p>
          <table className="min-w-full border-collapse mt-3">
            <thead><tr className={ui.theadRow}>
              <th className={ui.th}>Date</th><th className={ui.th}>Invoice</th><th className={ui.thRight}>Amount</th><th className="px-3 py-3 text-left">Note</th>
            </tr></thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs">
              {usages.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-[#6B7280]">Not used yet.</td></tr>}
              {usages.map((u) => (
                <tr key={u._id} className={u.reversed ? "text-[#9CA3AF] line-through" : ""}>
                  <td className={`${ui.td} whitespace-nowrap`}>{formatDateTime(u.date)}</td>
                  <td className={ui.td}>{u.invoiceId ? <Link className="hover:underline" to={`/sales/invoices/${u.invoiceId}`}>{u.invoiceNumber}</Link> : u.invoiceNumber}</td>
                  <td className={`${ui.td} text-right font-semibold`}>{formatCurrency(u.amount)}</td>
                  <td className={`${ui.td} no-underline`}>{u.reversed ? `Given back ${formatDate(u.reversedAt)} (invoice edited or deleted)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div style={{ display: "none" }}>
        <CodeSheet ref={sheetRef} cards={[{
          code: v.code, title: v.name || "Voucher", value: voucherValueText(v),
          lines: [v.minBillAmount ? `On bills of ₹${v.minBillAmount} or more` : "", scopeParts.length ? scopeParts.join(" · ") : "Valid on all items",
            v.validTo ? `Valid till ${formatDate(v.validTo)}` : "", v.customerName ? `For ${v.customerName} only` : ""],
        }]} />
      </div>
    </>
  );
};

export default VoucherDetail;
