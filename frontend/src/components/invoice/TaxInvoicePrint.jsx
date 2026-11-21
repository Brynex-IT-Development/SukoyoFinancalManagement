import { forwardRef } from "react";
import { amountInWords, stateName } from "../../utils/gst";
import { companyAddressLine } from "../../hooks/useCompanyProfile";

const money = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const isReturn = (inv) => ["return", "refund", "cancel"].includes(String(inv?.category || "").toLowerCase());

const cell = { border: "1px solid #999", padding: "3px 5px", fontSize: 10, verticalAlign: "top" };
const head = { ...cell, background: "#f0f0f0", fontWeight: 700, textAlign: "center" };
const num = { ...cell, textAlign: "right", whiteSpace: "nowrap" };

/**
 * A4 GST tax invoice for a business (B2B) invoice (F8): seller and buyer GSTINs, place of supply,
 * line table with HSN / taxable value / CGST-SGST or IGST, HSN summary, amount in words and bank
 * details from the company profile. Figures come from the invoice as saved (computed by the server).
 */
const TaxInvoicePrint = forwardRef(({ invoice: inv, company }, ref) => {
  if (!inv) return <div ref={ref} />;
  const tb = inv.taxBreakup || {};
  const intra = !!tb.intra;
  const lines = inv.gstLines || [];
  const total = Math.abs(Number(inv.finalTotal) || 0);
  const roundOff = Number(inv.adjustmentAmount) || 0;
  const tds = Number(inv.tdsTcsAmount) || 0;
  const credit = isReturn(inv);
  const c = company || {};
  const sellerState = inv.sellerStateCode || c.stateCode;

  return (
    <div ref={ref} style={{ fontFamily: "Arial, sans-serif", color: "#111", padding: "6mm", fontSize: 11 }}>
      <style>{"@page { size: A4; margin: 8mm; } table { border-collapse: collapse; width: 100%; } tr { page-break-inside: avoid; }"}</style>

      {/* Seller + title */}
      <table><tbody><tr>
        <td style={{ ...cell, width: "62%", border: "1px solid #555" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {c.logo && <img src={c.logo} alt="" style={{ maxHeight: 54, maxWidth: 120, objectFit: "contain" }} />}
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{c.companyName || inv.branch || ""}</div>
              <div style={{ fontSize: 10, lineHeight: 1.4 }}>{companyAddressLine(c)}</div>
              <div style={{ fontSize: 10 }}>{[c.phone && `Ph: ${c.phone}`, c.email].filter(Boolean).join(" · ")}</div>
              <div style={{ fontSize: 10, marginTop: 2 }}>
                <b>GSTIN: {inv.sellerGstin || c.gstin || "—"}</b> · State: {stateName(sellerState)} ({sellerState || "—"}){c.pan ? ` · PAN: ${c.pan}` : ""}
              </div>
            </div>
          </div>
        </td>
        <td style={{ ...cell, border: "1px solid #555" }}>
          <div style={{ fontSize: 15, fontWeight: 800, textAlign: "center", marginBottom: 4 }}>{credit ? "CREDIT NOTE" : "TAX INVOICE"}</div>
          <div><b>{credit ? "Credit note" : "Invoice"} no:</b> {inv.invoiceNumber}</div>
          <div><b>Date:</b> {fmtDate(inv.invoiceDate)}</div>
          {credit && inv.originalInvoiceNumber && <div><b>Against invoice:</b> {inv.originalInvoiceNumber}</div>}
          <div><b>Place of supply:</b> {inv.placeOfSupply?.stateName} ({inv.placeOfSupply?.stateCode})</div>
          <div><b>Reverse charge:</b> No</div>
        </td>
      </tr></tbody></table>

      {/* Buyer */}
      <table style={{ marginTop: 4 }}><tbody><tr>
        <td style={{ ...cell, border: "1px solid #555" }}>
          <div style={{ fontSize: 9, color: "#555", fontWeight: 700 }}>BILL TO</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{inv.buyerLegalName || inv.customer}</div>
          {inv.buyerTradeName && inv.buyerTradeName !== inv.buyerLegalName && <div>Trade name: {inv.buyerTradeName}</div>}
          {inv.buyerAddress && <div>{inv.buyerAddress}</div>}
          <div><b>GSTIN: {inv.buyerGstin}</b> · State: {inv.placeOfSupply?.stateName} ({inv.placeOfSupply?.stateCode}){inv.buyerPan ? ` · PAN: ${inv.buyerPan}` : ""}</div>
          {inv.customerPhone && <div>Ph: {inv.customerPhone}</div>}
        </td>
      </tr></tbody></table>

      {/* Lines */}
      <table style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th style={head} rowSpan={2}>#</th>
            <th style={{ ...head, textAlign: "left" }} rowSpan={2}>Description</th>
            <th style={head} rowSpan={2}>HSN</th>
            <th style={head} rowSpan={2}>Qty</th>
            <th style={head} rowSpan={2}>Rate</th>
            <th style={head} rowSpan={2}>Disc.</th>
            <th style={head} rowSpan={2}>Taxable value</th>
            {intra ? <><th style={head} colSpan={2}>CGST</th><th style={head} colSpan={2}>SGST</th></> : <th style={head} colSpan={2}>IGST</th>}
            <th style={head} rowSpan={2}>Total</th>
          </tr>
          <tr>
            {(intra ? ["%", "Amt", "%", "Amt"] : ["%", "Amt"]).map((h, i) => <th key={i} style={head}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
              <td style={cell}>{l.description}</td>
              <td style={{ ...cell, textAlign: "center" }}>{l.hsnCode || "—"}</td>
              <td style={num}>{l.quantity}</td>
              <td style={num}>{money(l.unitRate)}</td>
              <td style={num}>{l.discount ? money(l.discount) : ""}</td>
              <td style={num}>{money(l.taxable)}</td>
              {intra ? (
                <>
                  <td style={num}>{l.rate / 2}</td><td style={num}>{money(l.cgst)}</td>
                  <td style={num}>{l.rate / 2}</td><td style={num}>{money(l.sgst)}</td>
                </>
              ) : (
                <><td style={num}>{l.rate}</td><td style={num}>{money(l.igst)}</td></>
              )}
              <td style={num}>{money(l.total)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td style={cell} colSpan={6}>Total</td>
            <td style={num}>{money(tb.taxable)}</td>
            {intra ? <><td style={cell} /><td style={num}>{money(tb.cgst)}</td><td style={cell} /><td style={num}>{money(tb.sgst)}</td></> : <><td style={cell} /><td style={num}>{money(tb.igst)}</td></>}
            <td style={num}>{money((tb.taxable || 0) + (tb.tax || 0))}</td>
          </tr>
        </tbody>
      </table>

      {/* Totals + words */}
      <table style={{ marginTop: 6 }}><tbody><tr>
        <td style={{ ...cell, width: "60%" }}>
          <div style={{ fontSize: 9, color: "#555", fontWeight: 700 }}>AMOUNT IN WORDS</div>
          <div style={{ fontWeight: 700 }}>{amountInWords(total)}</div>
          {(inv.redemptions || []).length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10 }}>
              Settled partly by: {(inv.redemptions || []).map((r) => `${r.type === "giftCard" ? "Gift card" : r.type === "voucher" ? "Voucher" : r.type === "storeCredit" ? "Store credit" : "Loyalty points"} ₹${money(r.amount)}`).join(", ")}
              {" "}· Amount paid: ₹{money(Math.abs(inv.amountDue ?? total))}
            </div>
          )}
        </td>
        <td style={{ ...cell, padding: 0 }}>
          <table><tbody>
            <tr><td style={{ ...cell, border: 0 }}>Taxable value</td><td style={{ ...num, border: 0 }}>{money(tb.taxable)}</td></tr>
            {intra ? (
              <>
                <tr><td style={{ ...cell, border: 0 }}>CGST</td><td style={{ ...num, border: 0 }}>{money(tb.cgst)}</td></tr>
                <tr><td style={{ ...cell, border: 0 }}>SGST</td><td style={{ ...num, border: 0 }}>{money(tb.sgst)}</td></tr>
              </>
            ) : <tr><td style={{ ...cell, border: 0 }}>IGST</td><td style={{ ...num, border: 0 }}>{money(tb.igst)}</td></tr>}
            {tds ? <tr><td style={{ ...cell, border: 0 }}>Less {inv.tdsTcsType || "TDS"}</td><td style={{ ...num, border: 0 }}>−{money(tds)}</td></tr> : null}
            {roundOff ? <tr><td style={{ ...cell, border: 0 }}>Round off</td><td style={{ ...num, border: 0 }}>{roundOff > 0 ? "" : "−"}{money(Math.abs(roundOff))}</td></tr> : null}
            <tr style={{ fontWeight: 800, fontSize: 12 }}><td style={{ ...cell, border: 0, borderTop: "1px solid #999" }}>{credit ? "Credit note total" : "Invoice total"}</td><td style={{ ...num, border: 0, borderTop: "1px solid #999", fontSize: 12 }}>₹{money(total)}</td></tr>
          </tbody></table>
        </td>
      </tr></tbody></table>

      {/* HSN summary */}
      <table style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th style={head}>HSN</th><th style={head}>Rate %</th><th style={head}>Taxable value</th>
            {intra ? <><th style={head}>CGST</th><th style={head}>SGST</th></> : <th style={head}>IGST</th>}
            <th style={head}>Total tax</th>
          </tr>
        </thead>
        <tbody>
          {(inv.hsnSummary || []).map((h, i) => (
            <tr key={i}>
              <td style={{ ...cell, textAlign: "center" }}>{h.hsnCode || "—"}</td>
              <td style={num}>{h.rate}</td>
              <td style={num}>{money(h.taxable)}</td>
              {intra ? <><td style={num}>{money(h.cgst)}</td><td style={num}>{money(h.sgst)}</td></> : <td style={num}>{money(h.igst)}</td>}
              <td style={num}>{money(h.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Bank + signature */}
      <table style={{ marginTop: 6 }}><tbody><tr>
        <td style={{ ...cell, width: "60%" }}>
          {(c.bankName || c.accountNumber || c.upiId) ? (
            <>
              <div style={{ fontSize: 9, color: "#555", fontWeight: 700 }}>BANK DETAILS</div>
              {c.bankName && <div>Bank: {c.bankName}{c.branch ? `, ${c.branch}` : ""}</div>}
              {c.accountHolder && <div>A/c name: {c.accountHolder}</div>}
              {c.accountNumber && <div>A/c no: {c.accountNumber}</div>}
              {c.ifsc && <div>IFSC: {c.ifsc}</div>}
              {c.upiId && <div>UPI: {c.upiId}</div>}
            </>
          ) : <div style={{ color: "#999" }}>Bank details: add them in Company Profile.</div>}
          {c.invoiceFooterNote && <div style={{ marginTop: 6, fontSize: 9 }}>{c.invoiceFooterNote}</div>}
        </td>
        <td style={{ ...cell, textAlign: "right", verticalAlign: "bottom", height: 70 }}>
          <div>For {c.companyName || inv.branch || ""}</div>
          <div style={{ marginTop: 34, fontWeight: 700 }}>Authorised Signatory</div>
        </td>
      </tr></tbody></table>
      <div style={{ fontSize: 8, color: "#777", marginTop: 4, textAlign: "center" }}>This is a computer-generated invoice.</div>
    </div>
  );
});

TaxInvoicePrint.displayName = "TaxInvoicePrint";
export default TaxInvoicePrint;
