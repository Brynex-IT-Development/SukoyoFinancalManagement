// F14: Stock health — dead stock, overstock, ABC analysis, and the per-item maxStock / abcOverride settings.
import mongoose from "mongoose";
import SalesInvoice from "../model/SalesInvoice.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { requireUser, canSeeLoc } from "../utils/userScope.js";
import { storeFilter, allOf } from "../utils/reportScope.js";
import { RETURN_MATCH, loadValuedSales } from "../utils/salesData.js";
import { deadStock, overstock, abcClassify } from "../utils/profit.js";
import { warehousesFor, loadStockRows } from "../utils/stockRows.js";
import { istDateString, addIstDays } from "../utils/ist.js";
import { round2 } from "../utils/retailMath.js";
import { reportPeriod } from "./ProfitLossController.js";

const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

/** Store / warehouse the stock is read from, checked against the user's scope. */
const stockScope = async (who, q, res) => {
  if (q.locCode && !canSeeLoc(who.scope, q.locCode)) { res.status(403).json({ message: "That store is outside your access." }); return null; }
  const wh = await warehousesFor(who, q);
  return { locCode: q.locCode || "", warehouse: q.locCode ? wh.names?.[0] || "" : "", names: wh.names, label: wh.label };
};

const totalsOf = (rows, valueKey = "value") => ({
  items: rows.length,
  qty: round2(rows.reduce((s, r) => s + (Number(r.stock) || 0), 0)),
  value: round2(rows.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0)),
});
const pickRow = (r) => ({
  key: r.key, kind: r.kind, id: r.id, groupId: r.groupId, groupName: r.groupName, name: r.name, sku: r.sku, category: r.category, brand: r.brand,
  stock: r.stock, cost: r.cost, value: r.value, maxStock: r.maxStock, abcOverride: r.abcOverride, warehouses: r.warehouses,
});

// GET /api/stock-health/dead?userId=&days=90&locCode=&search=
// Items with stock > 0 and no sale (at the chosen store, or anywhere for all stores) in the last N days.
export const deadStockReport = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const s = await stockScope(who, req.query, res);
    if (!s) return;
    const rawDays = req.query.days;
    const days = rawDays === undefined || rawDays === "" ? 90 : Math.floor(Number(rawDays));
    if (!Number.isFinite(days) || days < 1 || days > 3650) return res.status(400).json({ message: "Days must be between 1 and 3650." });
    const search = String(req.query.search || "").trim().toLowerCase();

    const [stockRows, sales] = await Promise.all([
      loadStockRows(s.names),
      SalesInvoice.aggregate([
        { $match: allOf(storeFilter(who, s), { status: { $nin: ["draft", "Draft"] } }, { $nor: [RETURN_MATCH] }) },
        { $unwind: "$lineItems" },
        { $match: { "lineItems.quantity": { $gt: 0 } } },
        { $facet: {
          byId: [{ $group: { _id: { $toString: { $ifNull: ["$lineItems.itemData._id", "$lineItems.itemData.id"] } }, last: { $max: "$invoiceDate" } } }],
          bySku: [{ $group: { _id: "$lineItems.itemSku", last: { $max: "$invoiceDate" } } }],
        } },
      ]),
    ]);
    const byId = new Map((sales[0]?.byId || []).filter((x) => x._id).map((x) => [String(x._id), x.last]));
    const bySku = new Map((sales[0]?.bySku || []).filter((x) => x._id).map((x) => [String(x._id), x.last]));
    const lastSale = new Map();
    for (const r of stockRows) {
      const a = byId.get(r.key), b = r.sku ? bySku.get(r.sku) : null;
      const last = a && b ? (a > b ? a : b) : a || b;
      if (last) lastSale.set(r.key, last);
    }
    let rows = deadStock(stockRows, lastSale, days).map((r) => ({ ...pickRow(r), lastSaleDate: r.lastSaleDate, daysSinceLastSale: r.daysSinceLastSale }));
    if (search) rows = rows.filter((r) => `${r.name} ${r.sku} ${r.groupName}`.toLowerCase().includes(search));
    res.json({ store: s.label, days, rows, totals: totalsOf(rows) });
  } catch (err) { serverError(res, err, "Dead stock"); }
};

// GET /api/stock-health/overstock?userId=&locCode=&all=1&search=
// Items whose stock is above their maxStock. all=1 lists every item with stock or a maxStock (to set limits).
export const overstockReport = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const s = await stockScope(who, req.query, res);
    if (!s) return;
    const search = String(req.query.search || "").trim().toLowerCase();
    const stockRows = await loadStockRows(s.names);
    const withLimit = stockRows.filter((r) => Number(r.maxStock) > 0).length;
    let rows = req.query.all === "1"
      ? stockRows.filter((r) => r.stock > 0 || Number(r.maxStock) > 0)
        .map((r) => ({ ...pickRow(r), excess: Number(r.maxStock) > 0 ? Math.max(0, r.stock - Number(r.maxStock)) : 0, excessValue: Number(r.maxStock) > 0 ? round2(Math.max(0, r.stock - Number(r.maxStock)) * r.cost) : 0 }))
        .sort((a, b) => b.value - a.value)
      : overstock(stockRows).map((r) => ({ ...pickRow(r), excess: r.excess, excessValue: r.excessValue }));
    if (search) rows = rows.filter((r) => `${r.name} ${r.sku} ${r.groupName}`.toLowerCase().includes(search));
    res.json({ store: s.label, rows, itemsWithLimit: withLimit, totals: { ...totalsOf(rows), excess: round2(rows.reduce((t, r) => t + r.excess, 0)), excessValue: round2(rows.reduce((t, r) => t + r.excessValue, 0)) } });
  } catch (err) { serverError(res, err, "Overstock"); }
};

// GET /api/stock-health/abc?userId=&fromDate=&toDate=&locCode=
// Items ranked by sales value (taxable, net of returns) over the period — default the last 12 months.
export const abcReport = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const today = istDateString();
    const q = { ...req.query, fromDate: req.query.fromDate || istDateString(addIstDays(new Date(), -364)), toDate: req.query.toDate || today };
    const p = await reportPeriod(who, q, res);
    if (!p) return;
    const [{ sales, returns }, stockRows] = await Promise.all([loadValuedSales(who, p), loadStockRows(p.warehouses)]);

    const value = new Map();
    const names = new Map();
    const add = (lines, sign) => {
      for (const l of lines) {
        const key = l.itemId || (l.sku ? `sku:${l.sku}` : "");
        if (!key) continue;
        value.set(key, (value.get(key) || 0) + sign * l.taxable);
        if (!names.has(key)) names.set(key, { name: l.name, sku: l.sku });
      }
    };
    for (const s of sales) add(s.v.lines, 1);
    for (const r of returns) add(r.v.lines, -1);

    const rows = [];
    const seen = new Set();
    for (const r of stockRows) {
      // Sales are matched by item id; lines without an id fall back to the SKU (each sales key used once)
      const key = value.has(r.key) ? r.key : r.sku && value.has(`sku:${r.sku}`) && !seen.has(`sku:${r.sku}`) ? `sku:${r.sku}` : null;
      const v = key ? value.get(key) : 0;
      if (key) seen.add(key);
      if (v > 0 || r.stock > 0) rows.push({ ...pickRow(r), salesValue: v });
    }
    // Sold items that are no longer in the item master still count towards the total
    for (const [key, v] of value) {
      if (seen.has(key) || v <= 0) continue;
      const n = names.get(key) || {};
      rows.push({ key, kind: "unknown", id: null, groupId: null, name: n.name || "(deleted item)", sku: n.sku || "", stock: 0, cost: 0, value: 0, maxStock: null, abcOverride: "", salesValue: v });
    }
    const result = abcClassify(rows);
    res.json({ fromDate: p.fromDate, toDate: p.toDate, store: p.storeLabel, ...result });
  } catch (err) { serverError(res, err, "ABC analysis"); }
};

// PATCH /api/stock-health/items/:id  body { userId, kind: "item"|"group", groupId?, maxStock?, abcOverride? } — admin only.
// Writes only these two settings; stock is never touched.
export const updateStockSettings = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const { kind, groupId } = req.body;
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid item id." });
    const set = {};
    if (req.body.maxStock !== undefined) {
      const m = req.body.maxStock;
      if (m === null || m === "") set.maxStock = null;
      else if (!Number.isFinite(Number(m)) || Number(m) < 0) return res.status(400).json({ message: "Max stock must be a number of 0 or more (leave empty for no limit)." });
      else set.maxStock = Number(m);
    }
    if (req.body.abcOverride !== undefined) {
      const c = String(req.body.abcOverride || "").toUpperCase();
      if (!["", "A", "B", "C"].includes(c)) return res.status(400).json({ message: "ABC class must be A, B, C or empty (computed)." });
      set.abcOverride = c;
    }
    if (!Object.keys(set).length) return res.status(400).json({ message: "Nothing to change." });

    let result;
    if (kind === "group") {
      if (!mongoose.Types.ObjectId.isValid(groupId)) return res.status(400).json({ message: "Invalid item group id." });
      const $set = Object.fromEntries(Object.entries(set).map(([k, v]) => [`items.$.${k}`, v]));
      result = await ItemGroup.updateOne({ _id: groupId, "items._id": id }, { $set }, { runValidators: true });
    } else {
      result = await ShoeItem.updateOne({ _id: id }, { $set: set }, { runValidators: true });
    }
    if (!result.matchedCount) return res.status(404).json({ message: "Item not found." });
    res.json({ id, kind: kind === "group" ? "group" : "item", ...set });
  } catch (err) { serverError(res, err, "Update stock settings"); }
};
