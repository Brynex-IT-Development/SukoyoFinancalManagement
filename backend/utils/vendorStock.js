// Per-vendor stock for items that share ONE SKU across several vendors.
//
// item.vendorPrices[] holds one entry per vendor code (e.g. "HMC", "UMC") and its
// `quantity` = pieces of this item currently in stock from that vendor:
//   - purchase bills add to it   (BillController.recordVendorQuantities)
//   - sales invoices take from it (this file)
//   - returns / deleted invoices put it back (this file)
import mongoose from "mongoose";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";

const lineQty = (line) => Math.abs(parseFloat(line?.quantity) || 0);

// Locate the item a sales line refers to. Returns { vendorPrices, save } or null.
const loadLineItem = async (line) => {
  const data = line?.itemData || {};
  const itemId = String(data._id || data.id || line.itemId || "");
  const sku = String(line.itemSku || data.sku || "").trim();
  const groupId = line.itemGroupId || data.itemGroupId || null;

  if (groupId && mongoose.Types.ObjectId.isValid(String(groupId))) {
    const group = await ItemGroup.findById(groupId);
    const gi = group?.items?.find((it) => (itemId && String(it._id) === itemId) || (sku && it.sku === sku));
    if (gi) {
      if (!gi.vendorPrices) gi.vendorPrices = [];
      return {
        vendorPrices: gi.vendorPrices,
        save: async () => { group.markModified("items"); await group.save(); },
      };
    }
  }

  let item = null;
  if (itemId && mongoose.Types.ObjectId.isValid(itemId)) item = await ShoeItem.findById(itemId);
  if (!item && sku) item = await ShoeItem.findOne({ sku });
  if (!item) return null;
  if (!item.vendorPrices) item.vendorPrices = [];
  return {
    vendorPrices: item.vendorPrices,
    save: async () => { item.markModified("vendorPrices"); await item.save(); },
  };
};

// Oldest stock first (by lastPurchaseDate), only vendors that still have pieces.
const fifoOrder = (vendorPrices) =>
  [...vendorPrices]
    .filter((v) => v.vendorCode && (Number(v.quantity) || 0) > 0)
    .sort((a, b) => new Date(a.lastPurchaseDate || 0) - new Date(b.lastPurchaseDate || 0));

/**
 * Decide which vendor(s) each sales line is taken from. Read-only (no DB writes).
 * - Line already has vendorCode (cashier picked it)  -> whole quantity from that vendor.
 * - Otherwise                                         -> oldest stock first, spilling into the next vendor if needed.
 * Mutates lines in place: sets line.vendorCode (first vendor) and line.vendorAllocations.
 * Items with no vendor stock tracked are left untouched.
 */
export const assignVendorsToLines = async (lines = []) => {
  for (const line of lines || []) {
    try {
      const qty = lineQty(line);
      if (!qty) continue;
      const found = await loadLineItem(line);
      if (!found || found.vendorPrices.length === 0) continue;

      if (line.vendorCode) {
        line.vendorAllocations = [{ vendorCode: line.vendorCode, quantity: qty }];
        continue;
      }

      let remaining = qty;
      const allocations = [];
      for (const v of fifoOrder(found.vendorPrices)) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(v.quantity) || 0);
        allocations.push({ vendorCode: v.vendorCode, quantity: take });
        remaining -= take;
      }
      if (allocations.length === 0) continue; // no vendor stock left -> don't guess
      if (remaining > 0) allocations[allocations.length - 1].quantity += remaining;
      line.vendorAllocations = allocations;
      line.vendorCode = allocations[0].vendorCode;
    } catch (err) {
      console.error(`⚠️ assignVendorsToLines failed for "${line?.item}":`, err.message);
    }
  }
  return lines;
};

/**
 * Apply already-assigned vendor allocations to stock.
 * sign = -1 for a sale, +1 for a return / deleted invoice.
 * Never throws.
 */
export const applyVendorAllocations = async (lines = [], sign = -1) => {
  for (const line of lines || []) {
    try {
      const allocations = Array.isArray(line?.vendorAllocations) && line.vendorAllocations.length
        ? line.vendorAllocations
        : (line?.vendorCode ? [{ vendorCode: line.vendorCode, quantity: lineQty(line) }] : []);
      if (allocations.length === 0) continue;

      const found = await loadLineItem(line);
      if (!found) continue;
      let changed = false;
      for (const a of allocations) {
        const vp = found.vendorPrices.find((v) => v.vendorCode === a.vendorCode);
        if (!vp) continue;
        vp.quantity = Math.max(0, (Number(vp.quantity) || 0) + sign * (Number(a.quantity) || 0));
        changed = true;
      }
      if (changed) await found.save();
    } catch (err) {
      console.error(`⚠️ applyVendorAllocations failed for "${line?.item}":`, err.message);
    }
  }
};
