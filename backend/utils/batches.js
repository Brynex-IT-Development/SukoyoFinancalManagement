// Batch & expiry (F18). Called only from utils/stockService.js moveStock for items with
// manageBatch: true, so batch quantities always move together with the item's stock.
//
//  - Taking stock out: the cashier's chosen batch, else the unexpired batch that expires first
//    (FEFO). A sale never takes from an expired batch. Other movements (transfers, adjustments,
//    returns to vendor) use expired batches only when the unexpired ones run out.
//  - Putting stock in: the batches a line came from (restoring a sale, an undo, the receiving
//    side of a transfer), a new batch (purchase receive, repack), else "UNASSIGNED".
//  - Before every change the item's batches in that warehouse are reconciled with its stock, which
//    heals differences left by screens that write stock directly.
import mongoose from "mongoose";
import Batch from "../model/Batch.js";
import ShoeItem from "../model/ShoeItem.js";
import { istDateString } from "./ist.js";

export const UNASSIGNED = "UNASSIGNED";
const EPS = 1e-9;
const num = (v) => Number(v) || 0;
export const normBatchNo = (s) => String(s ?? "").trim().toUpperCase();
export const isExpired = (b, today = istDateString()) => !!b?.expDate && b.expDate < today;

/** FEFO order: earliest expiry first (no expiry last), then oldest batch. */
export const fefoSort = (a, b) =>
  (a.expDate || "9999-12-31").localeCompare(b.expDate || "9999-12-31")
  || (new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
  || String(a.batchNo).localeCompare(String(b.batchNo));

/**
 * Pure: which batches to take `need` from.
 * opts.batchNo     only that batch (the cashier's choice)
 * opts.allocations take these batches first (undoing an increment), the rest FEFO
 * opts.forSale     skip expired batches (a chosen expired batch is an error)
 * Returns { plan: [{ batchNo, take }], short, expiredQty, error }.
 */
export const planTake = (batches, need, { batchNo, allocations, forSale = false, today = istDateString() } = {}) => {
  const left = new Map(batches.map((b) => [b.batchNo, num(b.qty)]));
  const plan = [];
  let remaining = need;
  const take = (no, q) => {
    if (q <= EPS) return;
    left.set(no, (left.get(no) || 0) - q);
    const p = plan.find((x) => x.batchNo === no);
    if (p) p.take += q; else plan.push({ batchNo: no, take: q });
    remaining -= q;
  };
  const expiredQty = batches.filter((b) => isExpired(b, today)).reduce((s, b) => s + num(b.qty), 0);

  if (batchNo) {
    const b = batches.find((x) => x.batchNo === normBatchNo(batchNo));
    if (!b) return { plan: [], short: need, expiredQty, error: `Batch ${normBatchNo(batchNo)} was not found here.` };
    if (forSale && isExpired(b, today)) return { plan: [], short: need, expiredQty, error: `Batch ${b.batchNo} expired on ${b.expDate} and cannot be sold.` };
    take(b.batchNo, Math.min(need, num(b.qty)));
    return { plan, short: Math.max(0, remaining), expiredQty, error: remaining > EPS ? `Batch ${b.batchNo} has only ${num(b.qty)} left.` : null };
  }
  for (const a of allocations || []) {
    if (remaining <= EPS) break;
    const no = normBatchNo(a.batchNo);
    const b = batches.find((x) => x.batchNo === no);
    if (!b || (forSale && isExpired(b, today))) continue; // a sale never takes an expired batch
    take(no, Math.min(remaining, num(a.qty), Math.max(0, left.get(no) || 0)));
  }
  // Unexpired batches first (earliest expiry first); other movements use expired ones only as a last resort
  const fresh = batches.filter((b) => !isExpired(b, today)).sort(fefoSort);
  const eligible = forSale ? fresh : [...fresh, ...batches.filter((b) => isExpired(b, today)).sort(fefoSort)];
  for (const b of eligible) {
    if (remaining <= EPS) break;
    take(b.batchNo, Math.min(remaining, Math.max(0, left.get(b.batchNo) || 0)));
  }
  return { plan, short: Math.max(0, remaining), expiredQty, error: null };
};

/** Pure: split allocations over lines in order (each line gets exactly its quantity). */
export const splitAllocations = (lineQtys, allocations) => {
  const pool = allocations.map((a) => ({ ...a }));
  return lineQtys.map((q) => {
    let need = q;
    const out = [];
    for (const a of pool) {
      if (need <= EPS) break;
      const t = Math.min(need, a.qty);
      if (t <= EPS) continue;
      out.push({ ...a, qty: t });
      a.qty -= t;
      need -= t;
    }
    return out;
  });
};

/** Pure: allocations for a return of `qty`, taken from the end of the sale line's allocations. */
export const returnAllocations = (saleAllocations = [], qty) => {
  const out = [];
  let need = qty;
  for (const a of [...saleAllocations].reverse()) {
    if (need <= EPS) break;
    const t = Math.min(need, num(a.qty));
    if (t > EPS) { out.unshift({ ...a, qty: t }); need -= t; }
  }
  return out;
};

const toAlloc = (b, qty) => ({ batchNo: b.batchNo, qty, expDate: b.expDate || "", mfgDate: b.mfgDate || "", costPrice: b.costPrice ?? null });

export const isBatchManaged = async (itemId) => {
  if (!mongoose.Types.ObjectId.isValid(String(itemId))) return false;
  return !!(await ShoeItem.findById(itemId).select("manageBatch").lean())?.manageBatch;
};

const loadBatches = (itemId, whKey) => Batch.find({ itemId, warehouseKey: whKey }).lean();

/** Add qty to a batch (created when missing). A batch number keeps one expiry date. */
const addToBatch = async (target, wh, whKey, batchNo, qty, details, StockError) => {
  const no = normBatchNo(batchNo) || UNASSIGNED;
  const key = { itemId: target.itemId, warehouseKey: whKey, batchNo: no };
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await Batch.findOne(key).lean();
    if (existing && details.expDate && existing.expDate && existing.expDate !== details.expDate && no !== UNASSIGNED) {
      throw new StockError(`Batch ${no} of "${target.name}" already exists here with expiry ${existing.expDate} (not ${details.expDate}).`);
    }
    try {
      if (existing) {
        const fill = {};
        for (const k of ["expDate", "mfgDate"]) if (!existing[k] && details[k]) fill[k] = details[k];
        for (const k of ["costPrice", "sellingPrice"]) if ((existing[k] === null || existing[k] === undefined) && details[k] !== undefined && details[k] !== null) fill[k] = details[k];
        await Batch.updateOne({ _id: existing._id }, { $inc: { qty }, ...(Object.keys(fill).length ? { $set: fill } : {}) });
        return { ...toAlloc({ ...existing, ...fill }, qty) };
      }
      const doc = {
        ...key, warehouse: wh, itemName: target.name || "", sku: details.sku || "", qty,
        expDate: details.expDate || "", mfgDate: details.mfgDate || "", costPrice: details.costPrice ?? null, sellingPrice: details.sellingPrice ?? null, source: details.source || "",
      };
      await Batch.create(doc);
      return toAlloc(doc, qty);
    } catch (e) {
      if (e.code !== 11000) throw e; // created by a parallel request: retry as an increment
    }
  }
  throw new StockError(`Could not update batch ${no} of "${target.name}", please retry.`);
};

/** Take a plan from the batches with conditional decrements; on a lost race the taken part is put back. */
const takePlan = async (target, whKey, plan) => {
  const done = [];
  for (const p of plan) {
    const r = await Batch.updateOne({ itemId: target.itemId, warehouseKey: whKey, batchNo: p.batchNo, qty: { $gte: p.take - EPS } }, { $inc: { qty: -p.take } });
    if (!r.modifiedCount) {
      for (const d of done) await Batch.updateOne({ itemId: target.itemId, warehouseKey: whKey, batchNo: d.batchNo }, { $inc: { qty: d.take } });
      return false;
    }
    done.push(p);
  }
  return true;
};

/** Align Σ batch qty with the item's stock in this warehouse (UNASSIGNED first). Returns the difference fixed. */
export const reconcileBatches = async (target, wh, whKey, stock, StockError) => {
  const batches = await loadBatches(target.itemId, whKey);
  const sum = batches.reduce((s, b) => s + num(b.qty), 0);
  const diff = Math.round((num(stock) - sum) * 1e6) / 1e6;
  if (Math.abs(diff) <= EPS) return 0;
  if (diff > 0) {
    await addToBatch(target, wh, whKey, UNASSIGNED, diff, { source: "reconciled with stock" }, StockError);
  } else {
    const order = [...batches.filter((b) => b.batchNo === UNASSIGNED), ...batches.filter((b) => b.batchNo !== UNASSIGNED).sort(fefoSort)];
    let excess = -diff;
    for (const b of order) {
      if (excess <= EPS) break;
      const t = Math.min(excess, num(b.qty));
      if (t <= EPS) continue;
      const r = await Batch.updateOne({ _id: b._id, qty: { $gte: t - EPS } }, { $inc: { qty: -t } });
      if (r.modifiedCount) excess -= t;
    }
  }
  console.warn(`⚖️ Batches of "${target.name}" at ${wh} reconciled with stock (${diff > 0 ? "+" : ""}${diff}).`);
  return diff;
};

/**
 * Move stock of a batch-managed item and its batches together.
 * deps: { rawMove(target, wh, delta), rawGetStock(target, wh), whKey, StockError }
 * Returns { allocations: [{ batchNo, qty, expDate, mfgDate, costPrice }] }.
 */
export const moveBatched = async (target, wh, delta, opts, { rawMove, rawGetStock, whKey, StockError }) => {
  await reconcileBatches(target, wh, whKey, await rawGetStock(target, wh), StockError);

  if (delta < 0) {
    const need = -delta;
    for (let attempt = 0; attempt < 3; attempt++) {
      const batches = await loadBatches(target.itemId, whKey);
      const { plan, short, expiredQty, error } = planTake(batches, need, { batchNo: opts.batchNo, allocations: opts.allocations, forSale: opts.forSale });
      if (error) throw new StockError(`"${target.name}": ${error}`, { item: target.name, warehouse: wh, requested: need });
      if (short > EPS) {
        const usable = need - short;
        throw new StockError(opts.forSale && expiredQty > EPS
          ? `Not enough unexpired stock of "${target.name}" at ${wh}: ${usable} in unexpired batches (${expiredQty} expired), needed ${need}`
          : `Not enough stock of "${target.name}" at ${wh}: available ${usable}, needed ${need}`, { item: target.name, warehouse: wh, available: usable, requested: need });
      }
      if (!(await takePlan(target, whKey, plan))) continue; // another request took from a batch first
      try {
        await rawMove(target, wh, delta);
      } catch (e) {
        for (const p of plan) await Batch.updateOne({ itemId: target.itemId, warehouseKey: whKey, batchNo: p.batchNo }, { $inc: { qty: p.take } });
        throw e;
      }
      const byNo = new Map(batches.map((b) => [b.batchNo, b]));
      return { allocations: plan.map((p) => toAlloc(byNo.get(p.batchNo) || { batchNo: p.batchNo }, p.take)) };
    }
    throw new StockError(`Could not take "${target.name}" from its batches at ${wh}, please retry`);
  }

  await rawMove(target, wh, delta);
  const added = [];
  try {
    let remaining = delta;
    for (const a of opts.allocations || []) {
      if (remaining <= EPS) break;
      const q = Math.min(remaining, num(a.qty));
      if (q <= EPS) continue;
      added.push(await addToBatch(target, wh, whKey, a.batchNo, q, a, StockError));
      remaining -= q;
    }
    if (remaining > EPS && opts.batch?.batchNo) {
      added.push(await addToBatch(target, wh, whKey, opts.batch.batchNo, remaining, opts.batch, StockError));
      remaining = 0;
    }
    if (remaining > EPS) added.push(await addToBatch(target, wh, whKey, UNASSIGNED, remaining, { source: opts.source || "" }, StockError));
  } catch (e) {
    for (const a of added) await Batch.updateOne({ itemId: target.itemId, warehouseKey: whKey, batchNo: a.batchNo }, { $inc: { qty: -a.qty } });
    try { await rawMove(target, wh, -delta); } catch (e2) { console.error(`❌ Could not undo stock for "${target.name}":`, e2.message); }
    throw e;
  }
  return { allocations: added };
};
