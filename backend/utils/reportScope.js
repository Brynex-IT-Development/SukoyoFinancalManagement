// Filters shared by the report controllers (vendor reports, profit, purchase and stock reports).
import { locFilter } from "./userScope.js";
import { istDayStart, istDayEnd } from "./ist.js";

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** IST start / end of a "YYYY-MM-DD" day. */
export const dayStart = (d) => istDayStart(new Date(`${d}T12:00:00+05:30`));
export const dayEnd = (d) => istDayEnd(new Date(`${d}T12:00:00+05:30`));

/** { [field]: { $gte, $lte } } for an optional IST date range, or {} when neither end is given. */
export const dateRange = (field, fromDate, toDate) => {
  if (!fromDate && !toDate) return {};
  const r = {};
  if (fromDate) r.$gte = dayStart(fromDate);
  if (toDate) r.$lte = dayEnd(toDate);
  return { [field]: r };
};

/**
 * Store filter + the user's store scope, for documents that carry a locCode.
 * locCode matches the document's store; with withWarehouse, a document that has no locCode
 * (older records) matches when its warehouse/branch name equals `warehouse` (the store's name).
 * The same identifier (locCode) is compared on both sides.
 */
export const storeFilter = (who, { locCode, warehouse } = {}, { withWarehouse = true } = {}) => {
  const and = [];
  if (!who.scope.all) and.push(locFilter(who.scope));
  const hasWarehouse = warehouse && withWarehouse && warehouse !== "All Stores";
  const rx = hasWarehouse ? { $regex: `^${escapeRegex(String(warehouse))}$`, $options: "i" } : null;
  if (locCode && rx) and.push({ $or: [{ locCode: String(locCode) }, { locCode: { $in: [null, ""] }, $or: [{ warehouse: rx }, { branch: rx }] }] });
  else if (locCode) and.push({ locCode: String(locCode) });
  else if (rx) and.push({ $or: [{ warehouse: rx }, { branch: rx }] });
  return and.length ? { $and: and } : {};
};

/** Merge several Mongo filters with $and (skips empty ones). */
export const allOf = (...filters) => {
  const parts = filters.filter((f) => f && Object.keys(f).length);
  if (!parts.length) return {};
  return parts.length === 1 ? parts[0] : { $and: parts };
};
