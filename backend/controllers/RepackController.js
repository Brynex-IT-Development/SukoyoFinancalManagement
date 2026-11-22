// F19: Repacking — consume source items (−) and produce packs of a target item (+) through the stock
// service in one undoable operation. Deleting a repack reverses both movements.
import mongoose from "mongoose";
import Repack from "../model/Repack.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { requireUser, canSeeLoc, isAdminUser } from "../utils/userScope.js";
import { resolveLine, applyLines, moveStock, undoMovements, StockError } from "../utils/stockService.js";
import { warehousesFor, warehouseMatcher } from "../utils/stockRows.js";
import { repackCost, sourceUnitCost, repackRequestError } from "../utils/repack.js";
import { nextNumber } from "../utils/nextNumber.js";
import { istDateString } from "../utils/ist.js";
import { escapeRegex } from "../utils/reportScope.js";
import { round2 } from "../utils/retailMath.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const fail = (res, err, label) => {
  if (err instanceof StockError) return res.status(409).json({ message: err.message, details: err.details });
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

/** Admins anywhere; a store manager or warehouse user at their own store. */
const canRepackAt = (user, locCode) =>
  isAdminUser(user) || ((user.role === "store_manager" || user.power === "warehouse") && String(user.locCode || "") === String(locCode || ""));

const lineOf = (x) => ({ itemData: { _id: String(x.itemId) }, itemGroupId: x.itemGroupId || undefined });

/** Current cost price and details of a resolved stock target. */
const itemInfo = async (target) => {
  if (target.kind === "group") {
    const g = await ItemGroup.findOne({ _id: target.groupId }, { name: 1, items: { $elemMatch: { _id: target.itemId } } }).lean();
    const gi = g?.items?.[0] || {};
    return { name: gi.name || target.name, sku: gi.sku || "", cost: Number(gi.costPrice) || 0, manageBatch: false };
  }
  const it = await ShoeItem.findById(target.itemId).select("itemName sku costPrice manageBatch").lean();
  return { name: it?.itemName || target.name, sku: it?.sku || "", cost: Number(it?.costPrice) || 0, manageBatch: !!it?.manageBatch };
};

// POST /api/repacks  body { userId, locCode, date?, sources: [{ itemId, itemGroupId?, qty }], target: { itemId, itemGroupId?, packs, batchNo?, expDate? }, charges?, notes? }
export const createRepack = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { locCode, sources, target, charges, notes } = req.body;
    if (!locCode) return res.status(400).json({ message: "Choose the store or warehouse." });
    if (!canSeeLoc(who.scope, locCode)) return res.status(403).json({ message: "That store is outside your access." });
    if (!canRepackAt(who.user, locCode)) return res.status(403).json({ message: "Only an admin, or this store's manager or warehouse user, can repack here." });
    const problem = repackRequestError({ sources, target, charges });
    if (problem) return res.status(400).json({ message: problem });
    const date = req.body.date || istDateString();
    if (!isDay(date) || date > istDateString()) return res.status(400).json({ message: "Date must be today or earlier (YYYY-MM-DD)." });
    if (target.expDate && !isDay(target.expDate)) return res.status(400).json({ message: "Expiry date must be YYYY-MM-DD." });
    const wh = (await warehousesFor(who, { locCode })).names?.[0];
    if (!wh) return res.status(400).json({ message: "Unknown store." });

    // Resolve every item before anything moves
    let targetRef;
    const sourceRefs = [];
    try {
      for (const s of sources) {
        const t = await resolveLine(lineOf(s));
        if (!t) return res.status(400).json({ message: "A source line is not a stock item." });
        sourceRefs.push({ s, t, info: await itemInfo(t) });
      }
      targetRef = await resolveLine(lineOf(target));
      if (!targetRef) return res.status(400).json({ message: "The packed item is not a stock item." });
    } catch (e) {
      if (e instanceof StockError) return res.status(400).json({ message: e.message });
      throw e;
    }
    if (sourceRefs.some(({ t }) => t.key === targetRef.key)) return res.status(400).json({ message: "The packed item cannot also be one of the items repacked." });
    const targetInfo = await itemInfo(targetRef);
    const number = await nextNumber("REPACK", "RPK-");

    // 1. Consume the sources (all-or-nothing; batch-managed sources record their batches on the line)
    const lines = sourceRefs.map(({ s }) => ({ ...lineOf(s), quantity: Number(s.qty) }));
    const consumed = await applyLines(lines, wh, -1);
    const srcRows = sourceRefs.map(({ s, info }, i) => {
      const unitCost = sourceUnitCost(info.cost, lines[i].batchAllocations);
      return { itemId: String(s.itemId), itemGroupId: s.itemGroupId ? String(s.itemGroupId) : "", name: info.name, sku: info.sku, qty: Number(s.qty), unitCost: round2(unitCost), cost: round2(unitCost * Number(s.qty)), batchAllocations: lines[i].batchAllocations || [] };
    });
    const cost = repackCost(srcRows.map((r) => ({ qty: r.qty, unitCost: r.unitCost })), charges, target.packs);
    // A batch-managed pack gets its own batch: given number (or the repack number), expiry given or the
    // earliest expiry among the consumed batches, cost = the repack's unit cost
    const earliestExp = srcRows.flatMap((r) => r.batchAllocations).map((a) => a.expDate).filter(Boolean).sort()[0] || "";
    const batch = targetInfo.manageBatch
      ? { batchNo: String(target.batchNo || number).trim().toUpperCase(), expDate: target.expDate || earliestExp, costPrice: cost.unitCost, source: `repack ${number}` }
      : undefined;

    // 2. Produce the target; undo the consumption if it fails
    let produced;
    try {
      produced = await moveStock(targetRef, wh, Number(target.packs), batch ? { batch } : {});
    } catch (e) {
      await undoMovements(consumed);
      throw e;
    }

    // 3. Record it; undo both movements if saving fails
    try {
      const doc = await Repack.create({
        number, date, locCode: String(locCode), warehouse: wh, sources: srcRows,
        target: { itemId: String(target.itemId), itemGroupId: target.itemGroupId ? String(target.itemGroupId) : "", name: targetInfo.name, sku: targetInfo.sku, packs: Number(target.packs), batchNo: batch?.batchNo || "", expDate: batch?.expDate || "", batchAllocations: produced?.allocations || [] },
        ...cost, notes: String(notes || "").trim().slice(0, 500), createdBy: who.user.email || who.user.username || "",
      });
      res.status(201).json(doc.toObject());
    } catch (e) {
      await undoMovements([{ target: targetRef, warehouse: wh, delta: Number(target.packs), allocations: produced?.allocations || null }]);
      await undoMovements(consumed);
      throw e;
    }
  } catch (err) { fail(res, err, "Create repack"); }
};

// DELETE /api/repacks/:id?userId= — admin. Takes the packs back out and returns the source items.
export const deleteRepack = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid repack id." });
    const rp = await Repack.findById(req.params.id).lean();
    if (!rp) return res.status(404).json({ message: "Repack not found." });
    const targetRef = await resolveLine(lineOf(rp.target));
    if (!targetRef) return res.status(409).json({ message: "The packed item no longer exists, so this repack cannot be reversed." });
    const allocs = rp.target.batchAllocations?.length ? rp.target.batchAllocations : null;
    try {
      await moveStock(targetRef, rp.warehouse, -rp.target.packs, allocs ? { allocations: allocs } : {});
    } catch (e) {
      if (e instanceof StockError) return res.status(409).json({ message: `Cannot reverse ${rp.number}: ${rp.target.packs} pack(s) of ${rp.target.name} are no longer all in stock at ${rp.warehouse} (${e.message}).` });
      throw e;
    }
    try {
      await applyLines(rp.sources.map((s) => ({ ...lineOf(s), quantity: s.qty, batchAllocations: s.batchAllocations })), rp.warehouse, 1);
    } catch (e) {
      await moveStock(targetRef, rp.warehouse, rp.target.packs, allocs ? { allocations: allocs } : {}).catch(() => {});
      throw e;
    }
    await Repack.deleteOne({ _id: rp._id });
    res.json({ message: `${rp.number} reversed: ${rp.target.packs} × ${rp.target.name} removed, source items returned to ${rp.warehouse}.` });
  } catch (err) { fail(res, err, "Delete repack"); }
};

// GET /api/repacks?userId=&locCode=&fromDate=&toDate=&search=
export const listRepacks = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const q = req.query;
    if (q.locCode && !canSeeLoc(who.scope, q.locCode)) return res.status(403).json({ message: "That store is outside your access." });
    const filter = who.scope.all ? {} : { locCode: { $in: who.scope.locCodes } };
    if (q.locCode) filter.locCode = String(q.locCode);
    if (q.fromDate || q.toDate) { filter.date = {}; if (q.fromDate) filter.date.$gte = String(q.fromDate); if (q.toDate) filter.date.$lte = String(q.toDate); }
    const s = String(q.search || "").trim();
    if (s) filter.$or = [{ number: { $regex: escapeRegex(s), $options: "i" } }, { "target.name": { $regex: escapeRegex(s), $options: "i" } }, { "sources.name": { $regex: escapeRegex(s), $options: "i" } }];
    const repacks = await Repack.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
    res.json({ repacks });
  } catch (err) { fail(res, err, "List repacks"); }
};

// GET /api/repacks/:id?userId=
export const getRepack = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid repack id." });
    const rp = await Repack.findById(req.params.id).lean();
    if (!rp) return res.status(404).json({ message: "Repack not found." });
    if (!canSeeLoc(who.scope, rp.locCode)) return res.status(403).json({ message: "This repack belongs to another store." });
    res.json({ ...rp, canDelete: isAdminUser(who.user) });
  } catch (err) { fail(res, err, "Get repack"); }
};

// GET /api/repacks/items?userId=&locCode=&search= — items (standalone and variants) with their stock and cost there
export const searchRepackItems = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const s = String(req.query.search || "").trim();
    if (s.length < 2) return res.json({ items: [] });
    if (req.query.locCode && !canSeeLoc(who.scope, req.query.locCode)) return res.status(403).json({ message: "That store is outside your access." });
    const wh = await warehousesFor(who, { locCode: req.query.locCode });
    const match = warehouseMatcher(wh.names);
    const stockIn = (wss) => (wss || []).filter((w) => match(w.warehouse)).reduce((t, w) => t + (Number(w.stockOnHand) || 0), 0);
    const rx = { $regex: escapeRegex(s), $options: "i" };
    const [items, groups] = await Promise.all([
      ShoeItem.find({ $or: [{ itemName: rx }, { sku: rx }] }).select("itemName sku costPrice manageBatch warehouseStocks.warehouse warehouseStocks.stockOnHand").limit(15).lean(),
      ItemGroup.find({ $or: [{ "items.name": rx }, { "items.sku": rx }] }).select("name items._id items.name items.sku items.costPrice items.warehouseStocks.warehouse items.warehouseStocks.stockOnHand").limit(15).lean(),
    ]);
    const re = new RegExp(escapeRegex(s), "i");
    const out = items.map((i) => ({ itemId: String(i._id), itemGroupId: "", name: i.itemName, sku: i.sku || "", cost: Number(i.costPrice) || 0, stock: stockIn(i.warehouseStocks), manageBatch: !!i.manageBatch }));
    for (const g of groups) for (const gi of g.items || []) {
      if (re.test(gi.name || "") || re.test(gi.sku || "")) out.push({ itemId: String(gi._id), itemGroupId: String(g._id), name: `${g.name} · ${gi.name}`, sku: gi.sku || "", cost: Number(gi.costPrice) || 0, stock: stockIn(gi.warehouseStocks), manageBatch: false });
    }
    res.json({ items: out.slice(0, 20) });
  } catch (err) { fail(res, err, "Search repack items"); }
};
