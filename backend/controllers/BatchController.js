// F18: batches of batch-managed items — picker for the billing screen, expiring report, reconcile.
import mongoose from "mongoose";
import Batch from "../model/Batch.js";
import ShoeItem from "../model/ShoeItem.js";
import Store from "../model/Store.js";
import { requireUser, canSeeLoc } from "../utils/userScope.js";
import { warehouseKey, StockError } from "../utils/stockService.js";
import { reconcileBatches, fefoSort, isExpired, UNASSIGNED } from "../utils/batches.js";
import { warehousesFor } from "../utils/stockRows.js";
import { istDateString, addIstDays } from "../utils/ist.js";
import { escapeRegex } from "../utils/reportScope.js";
import { round2 } from "../utils/retailMath.js";

const fail = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};
const keyOf = (name) => warehouseKey(name) || String(name || "").trim().toLowerCase();
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** Warehouse keys the user may look at (null = all). */
const allowedKeys = async (who) => {
  if (who.scope.all) return null;
  const stores = await Store.find({ locCode: { $in: who.scope.locCodes } }).select("name").lean();
  return new Set(stores.map((s) => keyOf(s.name)));
};

// GET /api/batches?userId=&itemId=&warehouse= — the item's batches with stock in a warehouse (FEFO order)
export const listItemBatches = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { itemId, warehouse } = req.query;
    if (!mongoose.Types.ObjectId.isValid(String(itemId || ""))) return res.status(400).json({ message: "Invalid item." });
    const whKey = keyOf(warehouse || "Warehouse");
    const keys = await allowedKeys(who);
    if (keys && !keys.has(whKey)) return res.status(403).json({ message: "That warehouse is outside your access." });
    const today = istDateString();
    const batches = (await Batch.find({ itemId, warehouseKey: whKey, qty: { $gt: 0 } }).lean()).sort(fefoSort);
    res.json({
      today, batches: batches.map((b) => ({
        batchNo: b.batchNo, qty: b.qty, expDate: b.expDate || "", mfgDate: b.mfgDate || "", expired: isExpired(b, today),
        daysLeft: b.expDate ? daysBetween(today, b.expDate) : null, unassigned: b.batchNo === UNASSIGNED,
      })),
    });
  } catch (err) { fail(res, err, "List item batches"); }
};

// GET /api/batches/expiring?userId=&days=30&locCode=&includeExpired=1&search=
// Batches with stock whose expiry falls within N days (and, optionally, already expired).
export const expiringBatches = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const raw = req.query.days;
    const days = raw === undefined || raw === "" ? 30 : Math.floor(Number(raw));
    if (!Number.isFinite(days) || days < 0 || days > 3650) return res.status(400).json({ message: "Days must be between 0 and 3650." });
    if (req.query.locCode && !canSeeLoc(who.scope, req.query.locCode)) return res.status(403).json({ message: "That store is outside your access." });
    const wh = await warehousesFor(who, req.query);
    const today = istDateString();
    const until = istDateString(addIstDays(new Date(), days));
    const expFilter = req.query.includeExpired === "1" ? { $ne: "", $lte: until } : { $gte: today, $lte: until };
    const filter = { qty: { $gt: 0 }, expDate: expFilter };
    if (wh.names) filter.warehouseKey = { $in: wh.names.map(keyOf) };
    const search = String(req.query.search || "").trim();
    if (search) filter.$or = [{ itemName: { $regex: escapeRegex(search), $options: "i" } }, { sku: { $regex: escapeRegex(search), $options: "i" } }, { batchNo: { $regex: escapeRegex(search), $options: "i" } }];
    const batches = await Batch.find(filter).sort({ expDate: 1 }).limit(2000).lean();
    const items = new Map((await ShoeItem.find({ _id: { $in: [...new Set(batches.map((b) => String(b.itemId)))] } }).select("itemName sku costPrice").lean()).map((i) => [String(i._id), i]));
    const rows = batches.map((b) => {
      const it = items.get(String(b.itemId)) || {};
      const unit = b.costPrice ?? it.costPrice ?? 0;
      return {
        _id: b._id, itemId: b.itemId, itemName: it.itemName || b.itemName, sku: it.sku || b.sku, batchNo: b.batchNo, warehouse: b.warehouse,
        qty: b.qty, expDate: b.expDate, mfgDate: b.mfgDate, daysLeft: daysBetween(today, b.expDate), expired: b.expDate < today,
        unitCost: Number(unit) || 0, value: round2(b.qty * (Number(unit) || 0)),
      };
    });
    res.json({
      today, until, days, store: wh.label, rows,
      totals: { batches: rows.length, qty: rows.reduce((s, r) => s + r.qty, 0), value: round2(rows.reduce((s, r) => s + r.value, 0)), expired: rows.filter((r) => r.expired).length },
    });
  } catch (err) { fail(res, err, "Expiring batches"); }
};

// GET /api/batches/managed?userId=&ids=a,b,c — which of these items are batch-managed (for forms)
export const batchManagedItems = async (req, res) => {
  try {
    if (!(await requireUser(req, res))) return;
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)).slice(0, 500);
    const items = ids.length ? await ShoeItem.find({ _id: { $in: ids }, manageBatch: true }).select("_id").lean() : [];
    res.json({ ids: items.map((i) => String(i._id)) });
  } catch (err) { fail(res, err, "Batch-managed items"); }
};

/** Reconcile every batch-managed item's batches with its stock (all warehouses). */
export const reconcileAll = async () => {
  const items = await ShoeItem.find({ manageBatch: true }).select("itemName warehouseStocks.warehouse warehouseStocks.stockOnHand").lean();
  const fixed = [];
  for (const it of items) {
    const target = { kind: "standalone", itemId: it._id, name: it.itemName };
    const seen = new Set();
    for (const ws of it.warehouseStocks || []) {
      const k = keyOf(ws.warehouse);
      if (!k) continue;
      // Rows that share a key (different spellings) are counted together
      const stock = (it.warehouseStocks || []).filter((w) => keyOf(w.warehouse) === k).reduce((s, w) => s + (Number(w.stockOnHand) || 0), 0);
      if (seen.has(k)) continue;
      seen.add(k);
      const diff = await reconcileBatches(target, ws.warehouse, k, stock, StockError);
      if (diff) fixed.push({ item: it.itemName, warehouse: ws.warehouse, diff });
    }
    // Batches left in warehouses that no longer hold this item
    for (const k of await Batch.distinct("warehouseKey", { itemId: it._id, qty: { $gt: 0 } })) {
      if (seen.has(k)) continue;
      const b = await Batch.findOne({ itemId: it._id, warehouseKey: k }).lean();
      const diff = await reconcileBatches(target, b.warehouse, k, 0, StockError);
      if (diff) fixed.push({ item: it.itemName, warehouse: b.warehouse, diff });
    }
  }
  return { items: items.length, fixed };
};

// POST /api/batches/reconcile  body { userId } — admin
export const reconcileBatchesNow = async (req, res) => {
  try {
    if (!(await requireUser(req, res, { admin: true }))) return;
    const r = await reconcileAll();
    res.json({ ...r, message: r.fixed.length ? `${r.fixed.length} batch total(s) brought back in line with stock.` : `All ${r.items} batch-managed item(s) already match their stock.` });
  } catch (err) { fail(res, err, "Reconcile batches"); }
};
