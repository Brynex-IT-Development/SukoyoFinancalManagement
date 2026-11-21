import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatCurrency } from "../../utils/retailApi";
import { validateGstin, computeGstBreakup, parseTaxRate, round2 } from "../../utils/gst";
import useCompanyProfile from "../../hooks/useCompanyProfile";

export const EMPTY_B2B = Object.freeze({ enabled: false, noGstin: false, gstin: "", legalName: "", tradeName: "", address: "", phone: "", email: "" });

const inputCls = "w-full h-[38px] rounded-none border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#1C1F26] focus:outline-none";
const labelCls = "block text-xs font-medium text-[#374151] mb-1";

/** Is the business part of the bill ready to save? Returns an error message or "". */
export const b2bProblem = (b) => {
  if (!b?.enabled || b.noGstin) return "";
  const v = validateGstin(b.gstin);
  if (!v.valid) return `Buyer GSTIN: ${v.error}`;
  if (!String(b.legalName || "").trim()) return "Enter the business's legal name.";
  return "";
};

/**
 * "Business (GST) invoice" panel on the billing screen (F8).
 * Validates the GSTIN as it is typed (offline checksum), fills saved details for a GSTIN billed
 * before, and previews CGST + SGST or IGST. The server recomputes the real figures on save.
 *
 * props: value / onChange (b2b state), lines (bill lines), saleValue (bill total + TDS − round-off),
 *        onBuyerName(name) to fill the customer name, disabled
 */
export default function BusinessInvoicePanel({ value: b, onChange, lines, saleValue, onBuyerName, disabled }) {
  const company = useCompanyProfile();
  const [lookup, setLookup] = useState(null); // { business, intra, companyStateCode } for a valid GSTIN
  const filledFor = useRef("");
  const set = (patch) => onChange({ ...b, ...patch });
  const v = useMemo(() => (b.gstin.trim() ? validateGstin(b.gstin) : null), [b.gstin]);

  // A valid GSTIN: fetch what we know about this business (saved details from earlier bills)
  useEffect(() => {
    if (!b.enabled || b.noGstin || !v?.valid) { setLookup(null); return; }
    let active = true;
    api(`/gst/gstin/${v.gstin}`).then((d) => {
      if (!active) return;
      setLookup(d);
      // Fill saved details once per GSTIN, only into empty fields
      if (d.business && filledFor.current !== v.gstin) {
        filledFor.current = v.gstin;
        const patch = {};
        for (const k of ["legalName", "tradeName", "address", "phone", "email"]) if (!String(b[k] || "").trim() && d.business[k]) patch[k] = d.business[k];
        if (Object.keys(patch).length) onChange({ ...b, ...patch });
        if (patch.legalName) onBuyerName?.(patch.legalName);
      }
    }).catch(() => active && setLookup(null));
    return () => { active = false; };
  }, [b.enabled, b.noGstin, v?.valid, v?.gstin]); // eslint-disable-line react-hooks/exhaustive-deps

  const companyStateCode = lookup?.companyStateCode || company?.stateCode || "";
  const intra = v?.valid && companyStateCode ? v.stateCode === companyStateCode : null;

  const preview = useMemo(() => {
    if (!b.enabled || b.noGstin || intra === null) return null;
    const gstLines = (lines || []).filter((l) => l && (l.item || l.itemData)).map((l) => ({
      amount: round2((Number(l.quantity) || 0) * (Number(l.rate) || 0)),
      rate: Number(l.taxPercent) || parseTaxRate(l.itemData?.taxRateIntra) || parseTaxRate(l.itemData?.taxRateInter) || 0,
      hsnCode: l.itemData?.hsnCode || "",
    }));
    return gstLines.length ? computeGstBreakup({ lines: gstLines, saleValue, intra }) : null;
  }, [b.enabled, b.noGstin, intra, lines, saleValue]);

  return (
    <div className="mt-6 rounded-none border border-[#E5E7EB] bg-[#F9FAFB] p-4 space-y-3">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={b.enabled} disabled={disabled} onChange={(e) => onChange(e.target.checked ? { ...b, enabled: true } : { ...EMPTY_B2B })} className="w-4 h-4 accent-[#1C1F26]" />
        <span className="text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Business (GST) invoice</span>
      </label>

      {b.enabled && (
        <>
          <label className="flex items-center gap-2 text-xs text-[#374151] cursor-pointer">
            <input type="checkbox" checked={b.noGstin} disabled={disabled} onChange={(e) => set({ noGstin: e.target.checked })} className="w-4 h-4 accent-[#1C1F26]" />
            Business has no GSTIN (bill the business name only, as a normal invoice)
          </label>

          {!b.noGstin && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Buyer GSTIN <span className="text-red-500">*</span></label>
                <input value={b.gstin} disabled={disabled} maxLength={15} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} placeholder="15-character GSTIN" className={`${inputCls} font-mono uppercase`} />
                {v && <p className={`text-[11px] mt-1 font-semibold ${v.valid ? "text-[#15803D]" : "text-red-600"}`}>{v.valid ? `Valid · ${v.stateName} (${v.stateCode}) · PAN ${v.pan}` : v.error}</p>}
                {lookup?.business && <p className="text-[11px] text-[#6B7280] mt-0.5">Billed before — saved details filled in.</p>}
              </div>
              <div>
                <label className={labelCls}>Legal name <span className="text-red-500">*</span></label>
                <input value={b.legalName} disabled={disabled} onChange={(e) => { set({ legalName: e.target.value }); onBuyerName?.(e.target.value); }} className={inputCls} placeholder="As registered for GST" />
              </div>
              <div>
                <label className={labelCls}>Trade name</label>
                <input value={b.tradeName} disabled={disabled} onChange={(e) => set({ tradeName: e.target.value })} className={inputCls} />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Billing address</label>
                <input value={b.address} disabled={disabled} onChange={(e) => set({ address: e.target.value })} className={inputCls} />
              </div>
            </div>
          )}

          {!b.noGstin && v?.valid && (
            companyStateCode ? (
              <div className="text-xs bg-white border border-[#E5E7EB] p-3 space-y-1">
                <div className="flex justify-between"><span className="text-[#6B7280]">Place of supply</span><b>{v.stateName} ({v.stateCode})</b></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Tax type</span><b>{intra ? "Same state: CGST + SGST" : "Other state: IGST"}</b></div>
                {preview && (
                  <>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Taxable value</span><span>{formatCurrency(preview.totals.taxable)}</span></div>
                    {intra ? (
                      <>
                        <div className="flex justify-between"><span className="text-[#6B7280]">CGST</span><span>{formatCurrency(preview.totals.cgst)}</span></div>
                        <div className="flex justify-between"><span className="text-[#6B7280]">SGST</span><span>{formatCurrency(preview.totals.sgst)}</span></div>
                      </>
                    ) : (
                      <div className="flex justify-between"><span className="text-[#6B7280]">IGST</span><span>{formatCurrency(preview.totals.igst)}</span></div>
                    )}
                    <p className="text-[10px] text-[#9CA3AF] pt-1">Preview. The final figures are worked out from the item tax rates when the invoice is saved.</p>
                  </>
                )}
              </div>
            ) : (
              <p className="text-[11px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-2 py-1.5">
                The company's GST state code is not set, so a GST invoice cannot be saved yet. An admin can set it in Manage Users → Company Profile.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
