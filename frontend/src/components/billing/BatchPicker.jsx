import { useEffect, useState } from "react";
import { api, formatDate } from "../../utils/retailApi";

/**
 * F18: batch choice for a batch-managed item on the billing screen. Default "earliest expiry"
 * leaves the choice to the server (unexpired batch that expires first). Expired batches are shown
 * but cannot be chosen; the server refuses them too.
 */
const BatchPicker = ({ line, warehouse, onChange }) => {
  const itemId = line?.itemData?._id;
  const managed = !!line?.itemData?.manageBatch && !line?.itemData?.isFromGroup;
  const [batches, setBatches] = useState(null);
  useEffect(() => {
    if (!managed || !itemId) { setBatches(null); return undefined; }
    let active = true;
    api("/batches", { query: { itemId, warehouse: warehouse || "Warehouse" } })
      .then((d) => { if (active) setBatches(d.batches || []); })
      .catch(() => active && setBatches([]));
    return () => { active = false; };
  }, [managed, itemId, warehouse]);
  // A choice that no longer exists here (item or warehouse changed) falls back to automatic
  useEffect(() => {
    if (batches && line.batchNo && !batches.some((b) => b.batchNo === line.batchNo && !b.expired)) onChange("");
  }, [batches]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!managed) return null;
  const usable = (batches || []).filter((b) => !b.expired).reduce((s, b) => s + b.qty, 0);
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#4B5563]">
      <span className="font-semibold">Batch</span>
      <select value={line.batchNo || ""} onChange={(e) => onChange(e.target.value)} className="h-7 border border-[#E5E7EB] bg-white px-1.5 text-[11px] max-w-[260px]" aria-label="Batch">
        <option value="">Earliest expiry{batches ? ` (${usable} unexpired)` : ""}</option>
        {(batches || []).map((b) => (
          <option key={b.batchNo} value={b.batchNo} disabled={b.expired}>
            {b.unassigned ? "No batch recorded" : b.batchNo} · {b.qty} left{b.expDate ? ` · exp ${formatDate(b.expDate)}` : ""}{b.expired ? " · EXPIRED" : ""}
          </option>
        ))}
      </select>
    </div>
  );
};

export default BatchPicker;
