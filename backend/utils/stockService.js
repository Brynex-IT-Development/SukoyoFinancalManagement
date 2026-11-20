// Central stock service.
//
// Every stock movement should go through moveStock / applyLines so that:
//   * item matching is strict (by _id, then exact SKU / item code / name — never partial),
//   * warehouse matching is the same everywhere,
//   * writes are atomic ($inc with arrayFilters) — no read-modify-write races between stores,
//   * stock can never go below zero silently: a deduction larger than the stock is REJECTED
//     instead of being clamped to 0 (clamping + later reversal is what created phantom stock).
import mongoose from "mongoose";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";

export class StockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StockError";
    this.details = details;
  }
}

const STOCK_FIELDS = ["stockOnHand", "availableForSale", "physicalStockOnHand", "physicalAvailableForSale"];

const toObjectId = (v) => {
  if (!v) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  const s = String(v);
  return mongoose.Types.ObjectId.isValid(s) && /^[0-9a-fA-F]{24}$/.test(s) ? new mongoose.Types.ObjectId(s) : null;
};

const lower = (s) => (s ?? "").toString().trim().toLowerCase();

// ─── Warehouse matching ──────────────────────────────────────────────────────
// Different screens write the same store with different spellings
// ("G.Kannur", "Kannur Branch", "kannur"). Reduce a name to a canonical key.
const ALIASES = {
  "grooms trivandrum": "trivandrum",
  "grooms trivandum": "trivandrum",
  "trivandum": "trivandrum",
  "tvm": "trivandrum",
  "suitorguy mg road": "mg road",
  "mg": "mg road",
  "mgroad": "mg road",
  "manjery": "manjeri",
  "edappally": "edapally",
  "main": "warehouse",
};

export const warehouseKey = (name) => {
  let s = lower(name).replace(/\s+/g, " ");
  if (!s) return "";
  if (s === "warehouse") return "warehouse";
  s = s.replace(/^(sg|g|z)\s*[.\-]\s*/, "");      // "G.Kannur", "SG-Trivandrum", "Z-Edappal"
  s = s.replace(/\s+(branch|warehouse)$/, "");      // "Kannur Branch", "Main Warehouse"
  s = s.trim();
  return ALIASES[s] || s;
};

/**
 * Find the index of the warehouse row for `target` in a warehouseStocks array.
 * Tiers: exact (case-insensitive) → same canonical key → unique substring.
 * Returns -1 when nothing (or more than one ambiguous row) matches.
 */
export const findWarehouseIndex = (warehouseStocks, target) => {
  if (!Array.isArray(warehouseStocks) || !target) return -1;
  const t = lower(target);
  let idx = warehouseStocks.findIndex((ws) => ws?.warehouse && lower(ws.warehouse) === t);
  if (idx !== -1) return idx;

  const key = warehouseKey(target);
  const byKey = [];
  warehouseStocks.forEach((ws, i) => { if (ws?.warehouse && warehouseKey(ws.warehouse) === key) byKey.push(i); });
  if (byKey.length === 1) return byKey[0];
  if (byKey.length > 1) return -1; // ambiguous — refuse to guess

  if (key.length >= 4) {
    const bySub = [];
    warehouseStocks.forEach((ws, i) => {
      const k = warehouseKey(ws?.warehouse);
      if (k && (k.includes(key) || key.includes(k)) && Math.min(k.length, key.length) >= 4) bySub.push(i);
    });
    if (bySub.length === 1) return bySub[0];
  }
  return -1;
};

export const sameWarehouse = (a, b) => !!a && !!b && (lower(a) === lower(b) || warehouseKey(a) === warehouseKey(b));

// ─── Item matching ───────────────────────────────────────────────────────────
const lineFields = (line = {}) => {
  const d = line.itemData || {};
  return {
    groupId: line.itemGroupId || d.itemGroupId || null,
    itemId: d._id || d.id || line.itemId || null,
    sku: (line.itemSku || d.sku || line.sku || "").toString().trim(),
    itemCode: (line.itemCode || d.itemCode || "").toString().trim(),
    name: (d.itemName || d.name || line.itemName || line.item || "").toString().trim(),
  };
};

const uniqueIndex = (arr, pred) => {
  let found = -1;
  for (let i = 0; i < arr.length; i++) {
    if (pred(arr[i])) {
      if (found !== -1) return -2; // ambiguous
      found = i;
    }
  }
  return found;
};

const findGroupItemIndex = (group, f) => {
  const items = group.items || [];
  if (f.itemId) {
    const id = String(f.itemId);
    let i = items.findIndex((gi) => gi._id && String(gi._id) === id);
    if (i !== -1) return i;
    // Older screens used "<groupId>_<index>" as the variant id
    const m = id.match(/^([0-9a-fA-F]{24})_(\d+)$/);
    if (m && m[1] === String(group._id) && items[Number(m[2])]) return Number(m[2]);
  }
  if (f.sku) {
    const i = uniqueIndex(items, (gi) => lower(gi.sku) === lower(f.sku));
    if (i >= 0) return i;
  }
  if (f.itemCode) {
    const i = uniqueIndex(items, (gi) => lower(gi.itemCode) === lower(f.itemCode) || lower(gi.sku) === lower(f.itemCode));
    if (i >= 0) return i;
  }
  if (f.name) {
    const i = uniqueIndex(items, (gi) => lower(gi.name) === lower(f.name));
    if (i >= 0) return i;
  }
  return -1;
};

/**
 * Resolve a document line (invoice / transfer / bill line) to a concrete stock target.
 * Returns { kind: "group", groupId, itemId, name } | { kind: "standalone", itemId, name } | null.
 * null = the line does not point at a stock item (free-text line, service) and is skipped.
 */
export const resolveLine = async (line) => {
  const f = lineFields(line);
  const gid = toObjectId(f.groupId);
  if (gid) {
    const group = await ItemGroup.findById(gid).select("name items._id items.name items.sku items.itemCode").lean();
    if (!group) throw new StockError(`Item group not found for "${f.name || f.sku}"`, { line: f });
    const idx = findGroupItemIndex(group, f);
    if (idx < 0) throw new StockError(`"${f.name || f.sku}" was not found in group "${group.name}"`, { line: f });
    const gi = group.items[idx];
    return { kind: "group", groupId: group._id, itemId: gi._id, name: gi.name, key: `g:${group._id}:${gi._id}` };
  }

  const iid = toObjectId(f.itemId);
  let item = null;
  if (iid) item = await ShoeItem.findById(iid).select("_id itemName type").lean();
  if (!item && f.sku) {
    const matches = await ShoeItem.find({ sku: f.sku }).select("_id itemName type").limit(2).lean();
    if (matches.length === 1) item = matches[0];
  }
  if (!item && !f.itemId && !f.sku && f.name) {
    // Name-only line: accept an EXACT (case-insensitive) unique name match, else treat as free text
    const ci = { locale: "en", strength: 2 };
    const byName = await ShoeItem.find({ itemName: f.name }).collation(ci).select("_id itemName type").limit(2).lean();
    if (byName.length === 1) item = byName[0];
    else if (byName.length === 0) {
      const groups = await ItemGroup.find({ "items.name": f.name }).collation(ci).select("_id name items._id items.name").limit(2).lean();
      const hits = [];
      for (const g of groups) for (const gi of g.items || []) if (lower(gi.name) === lower(f.name)) hits.push({ g, gi });
      if (hits.length === 1) {
        const { g, gi } = hits[0];
        return { kind: "group", groupId: g._id, itemId: gi._id, name: gi.name, key: `g:${g._id}:${gi._id}` };
      }
    }
    if (!item) return null;
  }
  if (!item) {
    if (!f.itemId && !f.sku) return null; // free-text line, nothing to move
    // The id may belong to a group variant whose group id was not sent
    if (iid) {
      const group = await ItemGroup.findOne({ "items._id": iid }).select("_id name items._id items.name").lean();
      if (group) {
        const gi = group.items.find((x) => String(x._id) === String(iid));
        return { kind: "group", groupId: group._id, itemId: gi._id, name: gi.name, key: `g:${group._id}:${gi._id}` };
      }
    }
    throw new StockError(`Item "${f.name || f.sku || f.itemId}" not found`, { line: f });
  }
  if (item.type === "service") return null;
  return { kind: "standalone", itemId: item._id, name: item.itemName, key: `s:${item._id}` };
};

const loadStocks = async (target) => {
  if (target.kind === "group") {
    const g = await ItemGroup.findOne({ _id: target.groupId }, { items: { $elemMatch: { _id: target.itemId } } }).lean();
    return g?.items?.[0]?.warehouseStocks || null;
  }
  const s = await ShoeItem.findById(target.itemId).select("warehouseStocks").lean();
  return s ? s.warehouseStocks || [] : null;
};

/** Current stockOnHand of a target in a warehouse (0 when the row does not exist). */
export const getStock = async (target, warehouse) => {
  const stocks = await loadStocks(target);
  const idx = findWarehouseIndex(stocks || [], warehouse);
  return idx === -1 ? 0 : Number(stocks[idx].stockOnHand) || 0;
};

const newRow = (warehouse, qty) => ({
  _id: new mongoose.Types.ObjectId(),
  warehouse,
  openingStock: 0,
  openingStockValue: 0,
  stockOnHand: qty,
  committedStock: 0,
  availableForSale: qty,
  physicalOpeningStock: 0,
  physicalStockOnHand: qty,
  physicalCommittedStock: 0,
  physicalAvailableForSale: qty,
  monthlyOpeningStock: [],
});

/**
 * Atomically move stock for one target in one warehouse.
 * delta < 0 removes stock and fails (StockError) if the warehouse does not hold enough.
 * delta > 0 adds stock, creating the warehouse row when it does not exist.
 */
export const moveStock = async (target, warehouse, delta) => {
  delta = Number(delta) || 0;
  if (!delta) return;
  const wh = (warehouse || "Warehouse").toString().trim();
  const Model = target.kind === "group" ? ItemGroup : ShoeItem;
  const docId = target.kind === "group" ? target.groupId : target.itemId;
  const prefix = target.kind === "group" ? "items.$[it].warehouseStocks" : "warehouseStocks";
  const itemFilter = target.kind === "group" ? [{ "it._id": toObjectId(target.itemId) }] : [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const stocks = await loadStocks(target);
    if (stocks === null) throw new StockError(`"${target.name}" no longer exists`);
    const idx = findWarehouseIndex(stocks, wh);

    if (idx === -1) {
      if (delta < 0) {
        throw new StockError(`"${target.name}" has no stock at ${wh} (needed ${-delta})`, {
          item: target.name, warehouse: wh, available: 0, requested: -delta,
        });
      }
      // Add a new warehouse row — only if still absent (another request may have just added it)
      const path = target.kind === "group" ? "items.$[it].warehouseStocks" : "warehouseStocks";
      const absent = target.kind === "group"
        ? { _id: docId, items: { $elemMatch: { _id: toObjectId(target.itemId), "warehouseStocks.warehouse": { $ne: wh } } } }
        : { _id: docId, "warehouseStocks.warehouse": { $ne: wh } };
      const r = await Model.collection.updateOne(absent, { $push: { [path]: newRow(wh, delta) } },
        target.kind === "group" ? { arrayFilters: itemFilter } : {});
      if (r.modifiedCount === 1) return;
      continue; // row appeared meanwhile — retry with $inc
    }

    const row = stocks[idx];
    const wsFilter = row._id ? { "ws._id": toObjectId(row._id) } : { "ws.warehouse": row.warehouse };
    if (delta < 0) wsFilter["ws.stockOnHand"] = { $gte: -delta };
    const $inc = {};
    for (const f of STOCK_FIELDS) $inc[`${prefix}.$[ws].${f}`] = delta;

    const r = await Model.collection.updateOne({ _id: docId }, { $inc }, { arrayFilters: [...itemFilter, wsFilter] });
    if (r.modifiedCount === 1) return;
    if (delta < 0) {
      const available = await getStock(target, wh);
      if (available < -delta) {
        throw new StockError(`Not enough stock for "${target.name}" at ${row.warehouse}: available ${available}, needed ${-delta}`, {
          item: target.name, warehouse: row.warehouse, available, requested: -delta,
        });
      }
    }
  }
  throw new StockError(`Could not update stock for "${target.name}" at ${wh}, please retry`);
};

/**
 * Apply many lines in one go. sign = -1 to remove (sale, transfer out), +1 to add.
 * Quantities of the same item on several lines are combined, so two lines of the
 * same item cannot each pass on their own and oversell together.
 * All-or-nothing: if one line fails, every movement already made is undone and the error is thrown.
 * Returns the list of applied movements [{ target, warehouse, delta }].
 */
export const applyLines = async (lines, warehouse, sign, { qtyField = "quantity" } = {}) => {
  const combined = new Map();
  for (const line of lines || []) {
    const qty = Math.abs(parseFloat(line?.[qtyField]) || 0);
    if (!qty) continue;
    const target = await resolveLine(line);
    if (!target) continue;
    const prev = combined.get(target.key);
    if (prev) prev.qty += qty;
    else combined.set(target.key, { target, qty });
  }

  const applied = [];
  try {
    for (const { target, qty } of combined.values()) {
      await moveStock(target, warehouse, sign * qty);
      applied.push({ target, warehouse, delta: sign * qty });
    }
  } catch (err) {
    await undoMovements(applied);
    throw err;
  }
  return applied;
};

/** Undo movements returned by applyLines (best effort, used for rollback). */
export const undoMovements = async (applied = []) => {
  for (const m of [...applied].reverse()) {
    try {
      await moveStock(m.target, m.warehouse, -m.delta);
    } catch (e) {
      console.error(`❌ Stock rollback failed for "${m.target?.name}" at ${m.warehouse}:`, e.message);
    }
  }
};
