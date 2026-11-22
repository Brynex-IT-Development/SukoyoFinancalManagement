// Repacking (F19) formulas. Pure: no database access.
import { round2 } from "./retailMath.js";

const num = (v) => Number(v) || 0;

/**
 * Unit cost of a consumed source line: the cost recorded on the batches it came from (weighted by qty),
 * else the item's cost price.
 */
export const sourceUnitCost = (itemCost, allocations = []) => {
  const withCost = (allocations || []).filter((a) => a.costPrice !== null && a.costPrice !== undefined && num(a.qty) > 0);
  const qty = withCost.reduce((s, a) => s + num(a.qty), 0);
  const allQty = (allocations || []).reduce((s, a) => s + num(a.qty), 0);
  if (!qty) return num(itemCost);
  // Batches without a recorded cost count at the item's cost price
  const value = withCost.reduce((s, a) => s + num(a.qty) * num(a.costPrice), 0) + (allQty - qty) * num(itemCost);
  return value / allQty;
};

/**
 * Cost per produced unit = (Σ consumed qty × cost + repacking charges) ÷ packs produced.
 * sources: [{ qty, unitCost }]. Rounded to paise only at the end.
 */
export const repackCost = (sources, charges, packs) => {
  const consumed = sources.reduce((s, x) => s + num(x.qty) * num(x.unitCost), 0);
  const total = consumed + num(charges);
  return { consumedCost: round2(consumed), charges: round2(num(charges)), totalCost: round2(total), unitCost: num(packs) > 0 ? round2(total / num(packs)) : 0 };
};

/** Problems with a repack request (before anything moves), or null. */
export const repackRequestError = ({ sources, target, charges }) => {
  if (!Array.isArray(sources) || !sources.length) return "Add at least one item to repack from.";
  for (const s of sources) {
    if (!s?.itemId) return "Choose the item for every source line.";
    if (!(num(s.qty) > 0)) return "Each source quantity must be more than 0.";
  }
  if (!target?.itemId) return "Choose the item the packs are made into.";
  if (!(num(target.packs) > 0)) return "Packs produced must be more than 0.";
  const key = (x) => `${x.itemGroupId || ""}:${x.itemId}`;
  if (sources.some((s) => key(s) === key(target))) return "The packed item cannot also be one of the items repacked.";
  if (new Set(sources.map(key)).size !== sources.length) return "The same source item is listed twice.";
  if (charges !== undefined && charges !== "" && !(num(charges) >= 0)) return "Repacking charges cannot be negative.";
  return null;
};
