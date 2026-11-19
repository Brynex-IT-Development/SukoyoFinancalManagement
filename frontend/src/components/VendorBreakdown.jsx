// Shows which vendors an item's stock came from, e.g. one SKU shared by
// "SN-10-440-PSP(HMC) STICKY NOTES" and "SN-10-440-PSP(UMC) STICKY NOTES".
// Data comes from item.vendorPrices (vendorCode, quantity, ...) and
// item.vendorItemNames (vendorCode -> original full name), filled when bills are saved.

export const getVendorBreakdown = (item) => {
  const prices = Array.isArray(item?.vendorPrices) ? item.vendorPrices : [];
  const names = Array.isArray(item?.vendorItemNames) ? item.vendorItemNames : [];
  const codes = [...new Set([...prices.map((p) => p.vendorCode), ...names.map((n) => n.vendorCode)].filter(Boolean))];
  return codes
    .map((code) => {
    const p = prices.find((x) => x.vendorCode === code) || {};
    const n = names.filter((x) => x.vendorCode === code).pop();
    return {
      vendorCode: code,
      vendorName: p.vendorName || "",
      fullName: n?.originalName || "",
      quantity: Number(p.quantity) || 0,
      mrp: Number(p.mrp) || 0,
    };
  })
    // Only vendors we actually received pieces from
    .filter((r) => r.quantity > 0);
};

// compact = one line per vendor for tables; otherwise a small card list
const VendorBreakdown = ({ item, compact = false }) => {
  const rows = getVendorBreakdown(item);
  if (rows.length === 0) return null;

  if (compact) {
    return (
      <div className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <div key={r.vendorCode} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="inline-flex items-center px-1.5 py-px bg-purple-50 border border-purple-200 text-[10px] font-bold text-[#15171D]">
              {r.vendorCode}
            </span>
            <span className="truncate">{r.fullName || r.vendorName || "—"}</span>
            <span className="shrink-0 font-semibold text-gray-700">· {r.quantity} pcs</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Stock by Vendor</h3>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.vendorCode} className="flex items-center justify-between gap-4 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 border border-purple-200 text-xs font-bold text-[#15171D] shrink-0">
                {r.vendorCode}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#1a1a2e] truncate">{r.fullName || "—"}</p>
                {r.vendorName && <p className="text-xs text-[#64748b] truncate">{r.vendorName}</p>}
              </div>
            </div>
            <span className="text-sm font-semibold text-[#1a1a2e] shrink-0">{r.quantity} pcs</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorBreakdown;
