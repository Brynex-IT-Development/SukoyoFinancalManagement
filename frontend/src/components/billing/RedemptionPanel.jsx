import { useState } from "react";
import { X } from "lucide-react";
import { formatCurrency, formatDate } from "../../utils/retailApi";

const TABS = [
  ["loyalty", "Loyalty"],
  ["storeCredit", "Store credit"],
  ["giftCard", "Gift card"],
  ["voucher", "Voucher"],
];

const inputCls = "w-full min-w-0 h-9 rounded-none border border-[#E5E7EB] bg-white px-2 text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#1C1F26] focus:outline-none";
const btnCls = "h-9 shrink-0 rounded-none bg-[#1C1F26] px-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#15171D] disabled:opacity-50 cursor-pointer";

/** Customer summary + "Apply" panel on the billing screen. `r` is the useBillRedemptions() result. */
export default function RedemptionPanel({ r, finalTotal, disabled }) {
  const [tab, setTab] = useState("loyalty");
  const [points, setPoints] = useState("");
  const [code, setCode] = useState("");
  const [scAmount, setScAmount] = useState("");
  const { lookup, customer } = r;
  const total = Number(finalTotal) || 0;

  const run = async (fn) => { try { await fn(); } catch { /* message shown via r.notice */ } };

  return (
    <div className="rounded-none bg-[#F9FAFB] p-3 border border-[#E5E7EB]/60 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Customer & Redemptions</p>

      {/* Customer summary */}
      {lookup.status === "idle" && <p className="text-[11px] text-[#6B7280]">Enter the customer's phone number to see points and store credit. No phone = walk-in (no points).</p>}
      {lookup.status === "loading" && <p className="text-[11px] text-[#6B7280]">Looking up customer…</p>}
      {lookup.status === "invalid" && <p className="text-[11px] font-semibold text-red-600">Phone number looks invalid (10-digit mobile, or 6–15 digits).</p>}
      {lookup.status === "error" && <p className="text-[11px] font-semibold text-red-600">{lookup.message}</p>}
      {lookup.status === "new" && <p className="text-[11px] text-[#6B7280]">New customer: they will be saved with this bill and start earning points.</p>}
      {customer && (
        <div className="text-xs space-y-0.5">
          <div className="font-bold text-[#111827]">{customer.name}{customer.status === "inactive" && <span className="ml-1 text-[10px] text-[#92400E]">(inactive)</span>}</div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Points</span><span className="font-semibold">{customer.loyaltyPoints || 0}{lookup.loyalty?.valuePerPoint ? ` (₹${((customer.loyaltyPoints || 0) * lookup.loyalty.valuePerPoint).toFixed(2)})` : ""}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">Store credit</span><span className="font-semibold">{formatCurrency(customer.storeCreditBalance)}</span></div>
        </div>
      )}

      {/* Apply */}
      {customer && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`h-7 rounded-none border text-[10px] font-bold uppercase tracking-wide cursor-pointer ${tab === k ? "border-[#1C1F26] bg-[#F6FCE6] text-[#15171D]" : "border-[#E5E7EB] bg-white text-[#6B7280]"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "loyalty" && (
            lookup.loyalty?.enabled === false ? <p className="text-[11px] text-[#6B7280]">Loyalty is switched off for this store.</p> : (
              <div className="flex gap-1.5">
                <input type="number" min="1" step="1" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="Points (blank = max)" className={inputCls} disabled={disabled || r.busy} />
                <button type="button" className={btnCls} disabled={disabled || r.busy || total <= 0}
                  onClick={() => run(async () => { await r.applyLoyalty(points ? { points: Number(points) } : {}); setPoints(""); })}>Apply</button>
              </div>
            )
          )}

          {tab === "storeCredit" && (
            <div className="space-y-1.5">
              {(lookup.storeCredits || []).length === 0 && <p className="text-[11px] text-[#6B7280]">No open store credit.</p>}
              {(lookup.storeCredits || []).map((sc) => (
                <div key={sc._id} className="flex items-center justify-between gap-2 text-[11px] bg-white border border-[#E5E7EB] px-2 py-1.5">
                  <span><b>{sc.number}</b> · {formatCurrency(sc.balance)}<span className="text-[#9CA3AF]"> · till {sc.expiryDate ? formatDate(sc.expiryDate) : "no expiry"}</span></span>
                  <button type="button" className="text-[10px] font-bold uppercase text-[#1C1F26] hover:underline disabled:opacity-50 cursor-pointer" disabled={disabled || r.busy || total <= 0}
                    onClick={() => run(() => r.applyStoreCredit({ refId: sc._id, amount: scAmount || undefined }))}>Use</button>
                </div>
              ))}
              <div className="flex gap-1.5">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SC-000123" className={inputCls} disabled={disabled || r.busy} />
                <input type="number" min="0" step="0.01" value={scAmount} onChange={(e) => setScAmount(e.target.value)} placeholder="₹ (max)" className={`${inputCls} w-20`} disabled={disabled || r.busy} />
                <button type="button" className={btnCls} disabled={disabled || r.busy || !code.trim() || total <= 0}
                  onClick={() => run(async () => { await r.applyStoreCredit({ code, amount: scAmount || undefined }); setCode(""); setScAmount(""); })}>Use</button>
              </div>
            </div>
          )}

          {(tab === "giftCard" || tab === "voucher") && <p className="text-[11px] text-[#6B7280]">Coming with gift cards and vouchers (Phase 2).</p>}
        </div>
      )}

      {r.notice && <p className="text-[11px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-2 py-1">{r.notice}</p>}

      {/* Applied */}
      {r.redemptions.length > 0 && (
        <div className="space-y-1 border-t border-[#E5E7EB] pt-2">
          {r.redemptions.map((x, i) => (
            <div key={`${x.type}-${x.refId || i}`} className="flex items-center justify-between text-xs">
              <span className="text-[#374151]">{x.type === "loyalty" ? "Loyalty" : "Store credit"} · {x.label}</span>
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-red-600">− {formatCurrency(x.amount)}</span>
                <button type="button" onClick={() => r.remove(i)} disabled={disabled} className="text-[#9CA3AF] hover:text-red-600 cursor-pointer" title="Remove"><X size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
