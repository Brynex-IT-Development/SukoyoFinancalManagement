// Loads sales and returns for the profit reports (P&L, bill-wise profit, ABC) and values them with
// utils/profit.js: trimmed sales are rebuilt from their returns, return lines take the GST rate of
// the sale line they came from, and lines without a cost snapshot use the item's current cost.
import mongoose from "mongoose";
import SalesInvoice from "../model/SalesInvoice.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { storeFilter, dateRange, allOf } from "./reportScope.js";
import { valueSale, valueReturn, isReturnInvoice, isCountableInvoice, isTrimmedSale, returnRateHint } from "./profit.js";

export const RETURN_MATCH = { $or: [{ category: { $regex: "^(return|refund|cancel)$", $options: "i" } }, { invoiceNumber: { $regex: "^(RTN|RET)", $options: "i" } }] };
const NOT_DRAFT = { status: { $nin: ["draft", "Draft"] } };

// Only the fields the reports need (itemData can hold large blobs such as images)
const FIELDS = [
  "invoiceNumber", "invoiceDate", "customer", "customerPhone", "salesperson", "locCode", "warehouse", "branch", "category", "status",
  "returnStatus", "originalInvoiceId", "originalInvoiceNumber", "finalTotal", "subTotal", "totalTax", "discountAmount", "tdsTcsAmount", "adjustmentAmount",
  "isB2B", "taxBreakup", "lineItems.item", "lineItems.itemSku", "lineItems.itemGroupId", "lineItems.size", "lineItems.quantity", "lineItems.rate",
  "lineItems.amount", "lineItems.tax", "lineItems.costPrice", "lineItems.itemData._id", "lineItems.itemData.id", "lineItems.itemData.itemName",
  "lineItems.itemData.name", "lineItems.itemData.sku", "lineItems.itemData.taxRateIntra", "lineItems.itemData.taxRateInter", "lineItems.itemData.itemGroupId",
].join(" ");

const validIds = (ids) => [...new Set(ids.map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id);
const itemIdOf = (l) => String(l?.itemData?._id || l?.itemData?.id || "");
const skuOf = (l) => String(l?.itemSku || l?.itemData?.sku || "").trim();

/** Current cost of the items on lines that have no cost snapshot → fallbackCost(line). */
const buildCostFallback = async (lines) => {
  const missing = lines.filter((l) => l && (l.costPrice === undefined || l.costPrice === null || l.costPrice === ""));
  const ids = validIds(missing.map(itemIdOf).filter(Boolean));
  const skus = [...new Set(missing.filter((l) => !itemIdOf(l)).map(skuOf).filter(Boolean))];
  const byId = new Map();
  const bySku = new Map();
  if (ids.length) {
    for (const it of await ShoeItem.find({ _id: { $in: ids } }).select("costPrice").lean()) byId.set(String(it._id), it.costPrice);
    for (const g of await ItemGroup.find({ "items._id": { $in: ids } }).select("items._id items.costPrice").lean()) {
      for (const gi of g.items || []) if (ids.includes(String(gi._id))) byId.set(String(gi._id), gi.costPrice);
    }
  }
  if (skus.length) {
    for (const it of await ShoeItem.find({ sku: { $in: skus } }).select("sku costPrice").lean()) if (!bySku.has(it.sku)) bySku.set(it.sku, it.costPrice);
  }
  const ok = (v) => (v === undefined || v === null || v === "" ? null : Number(v) || 0);
  return (line) => ok(byId.get(itemIdOf(line))) ?? ok(bySku.get(skuOf(line))) ?? null;
};

/**
 * Sales and returns in a period, valued.
 * q: { fromDate, toDate, locCode, warehouse, salesperson }
 * Returns { sales: [{ inv, v }], returns: [{ inv, v }] } where v is the valueSale / valueReturn result.
 */
export const loadValuedSales = async (who, q = {}) => {
  const scope = storeFilter(who, q);
  const period = dateRange("invoiceDate", q.fromDate, q.toDate);
  const salesperson = q.salesperson ? { salesperson: String(q.salesperson) } : {};

  const [rawSales, rawReturns] = await Promise.all([
    SalesInvoice.find(allOf(scope, period, NOT_DRAFT, salesperson, { $nor: [RETURN_MATCH] })).select(FIELDS).sort({ invoiceDate: 1 }).lean(),
    SalesInvoice.find(allOf(scope, period, NOT_DRAFT, salesperson, RETURN_MATCH)).select(FIELDS).sort({ invoiceDate: 1 }).lean(),
  ]);
  const sales = rawSales.filter((i) => isCountableInvoice(i) && !isReturnInvoice(i));
  const returns = rawReturns.filter((i) => isCountableInvoice(i) && isReturnInvoice(i));

  // Returns of trimmed sales (any date or store) to rebuild those sales as sold
  const trimmed = sales.filter(isTrimmedSale);
  const returnsOf = new Map();
  if (trimmed.length) {
    const ids = trimmed.map((s) => String(s._id));
    const numbers = trimmed.map((s) => s.invoiceNumber).filter(Boolean);
    const linked = await SalesInvoice.find(allOf(RETURN_MATCH, NOT_DRAFT, { $or: [{ originalInvoiceId: { $in: ids } }, { originalInvoiceNumber: { $in: numbers } }] })).select(FIELDS).lean();
    for (const s of trimmed) {
      returnsOf.set(String(s._id), linked.filter((r) => isCountableInvoice(r) && (String(r.originalInvoiceId || "") === String(s._id) || (!r.originalInvoiceId && r.originalInvoiceNumber === s.invoiceNumber))));
    }
  }

  // Sale lines of the returns' original invoices, for their GST rate
  const origIds = validIds(returns.map((r) => r.originalInvoiceId).filter(Boolean));
  const originals = new Map();
  if (origIds.length) {
    for (const o of await SalesInvoice.find({ _id: { $in: origIds } }).select(FIELDS).lean()) originals.set(String(o._id), o);
  }
  const rateHintFor = (ret) => returnRateHint(originals.get(String(ret.originalInvoiceId || "")) || null);

  const allLines = [...sales, ...returns, ...[...returnsOf.values()].flat()].flatMap((i) => i.lineItems || []);
  const fallbackCost = await buildCostFallback(allLines);

  return {
    sales: sales.map((inv) => ({ inv, v: valueSale(inv, returnsOf.get(String(inv._id)) || [], { fallbackCost }) })),
    returns: returns.map((inv) => ({ inv, v: valueReturn(inv, { fallbackCost, rateHint: rateHintFor(inv) }) })),
  };
};

/** One invoice (sale or return), valued the same way, with its lines. null when not found. */
export const loadValuedInvoice = async (id) => {
  if (!validIds([id]).length) return null;
  const inv = await SalesInvoice.findById(id).select(FIELDS).lean();
  if (!inv) return null;
  if (isReturnInvoice(inv)) {
    const orig = validIds([inv.originalInvoiceId || ""]).length ? await SalesInvoice.findById(inv.originalInvoiceId).select(FIELDS).lean() : null;
    const fallbackCost = await buildCostFallback(inv.lineItems || []);
    return { inv, v: valueReturn(inv, { fallbackCost, rateHint: returnRateHint(orig) }), isReturn: true };
  }
  const returns = isTrimmedSale(inv)
    ? (await SalesInvoice.find(allOf(RETURN_MATCH, NOT_DRAFT, { $or: [{ originalInvoiceId: String(inv._id) }, { originalInvoiceNumber: inv.invoiceNumber }] })).select(FIELDS).lean()).filter(isCountableInvoice)
    : [];
  const fallbackCost = await buildCostFallback([...(inv.lineItems || []), ...returns.flatMap((r) => r.lineItems || [])]);
  return { inv, v: valueSale(inv, returns, { fallbackCost }), isReturn: false, returns };
};
