// Business (B2B) GST invoice support (F8): reads rates/HSN from the database, validates
// the buyer GSTIN offline, keeps one BusinessCustomer per GSTIN, and computes the breakup.
import CompanyProfile from "../model/CompanyProfile.js";
import BusinessCustomer from "../model/BusinessCustomer.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { resolveLine } from "./stockService.js";
import { HttpError } from "./redemptions.js";
import { validateGstin, computeGstBreakup, parseTaxRate, round2, isValidStateCode, stateName } from "./gst.js";

export const getCompanyProfile = () => CompanyProfile.findOne({ key: "default" }).lean();

// Rates of the billing screen's built-in tax choices (SalesInvoiceCreate taxOptions)
const TAX_OPTION_RATES = { gst0: 0, gst5: 5, gst12: 12, gst18: 18, gst28: 28 };

/**
 * Tax rate and HSN of each invoice line, read from the item in the database (same priority
 * as the billing screen: the item's own tax rate, else the line's tax choice).
 * Returns lines for computeGstBreakup: [{ amount, rate, hsnCode, description, quantity, unitRate }].
 */
export const gstLinesFrom = async (lineItems) => {
  const out = [];
  for (const line of lineItems || []) {
    const quantity = Number(line?.quantity) || 0;
    const unitRate = Number(line?.rate) || 0;
    // Tax-inclusive line price = qty × rate. (The billing screen stores line.amount WITHOUT tax,
    // so it is only a fallback for lines that have no rate.)
    const amount = quantity > 0 && unitRate > 0 ? round2(quantity * unitRate) : round2(Math.abs(Number(line?.amount) || 0));
    let rate = null;
    let hsnCode = "";
    try {
      const target = await resolveLine(line);
      if (target?.kind === "standalone") {
        const it = await ShoeItem.findById(target.itemId).select("taxRateIntra taxRateInter hsnCode").lean();
        rate = parseTaxRate(it?.taxRateIntra) ?? parseTaxRate(it?.taxRateInter);
        hsnCode = it?.hsnCode || "";
      } else if (target?.kind === "group") {
        const g = await ItemGroup.findOne({ _id: target.groupId }, { intraStateTaxRate: 1, interStateTaxRate: 1, hsnCode: 1, items: { $elemMatch: { _id: target.itemId } } }).lean();
        rate = parseTaxRate(g?.intraStateTaxRate) ?? parseTaxRate(g?.interStateTaxRate);
        hsnCode = g?.items?.[0]?.hsnCode || g?.hsnCode || "";
      }
    } catch { /* free-text line: falls back to the line's own tax choice */ }
    if (rate === null || rate === undefined) {
      rate = TAX_OPTION_RATES[line?.tax] ?? (/GST/i.test(String(line?.tax || "")) ? parseTaxRate(line.tax) : null) ?? 0;
    }
    if (!hsnCode) hsnCode = String(line?.hsnCode || line?.itemData?.hsnCode || "").trim();
    out.push({ amount, rate: Number(rate) || 0, hsnCode, description: line?.item || line?.itemData?.itemName || "", quantity, unitRate });
  }
  return out;
};

/**
 * What the goods were actually sold for, tax included: bill total plus TDS deducted by the
 * buyer, minus the round-off adjustment. The difference to the line amounts is the discount.
 */
export const saleValueOf = (inv) =>
  round2(Math.abs(Number(inv.finalTotal) || 0) + (Number(inv.tdsTcsAmount) || 0) - (Number(inv.adjustmentAmount) || 0));

const B2B_FIELDS = ["isB2B", "businessCustomerId", "buyerGstin", "buyerLegalName", "buyerTradeName", "buyerAddress", "buyerPan",
  "placeOfSupply", "sellerGstin", "sellerStateCode", "taxBreakup", "hsnSummary", "gstLines"];
export const stripB2BFields = (body) => { for (const f of B2B_FIELDS) delete body[f]; };

/** Fields that switch a business invoice off again (edit). */
export const clearedB2BFields = () => ({
  isB2B: false, businessCustomerId: null, buyerGstin: "", buyerLegalName: "", buyerTradeName: "", buyerAddress: "", buyerPan: "",
  placeOfSupply: { stateCode: "", stateName: "" }, sellerGstin: "", sellerStateCode: "", taxBreakup: null, hsnSummary: [], gstLines: [],
});

/**
 * Validate a business invoice request and build its fields.
 * buyer: { gstin, legalName, tradeName, address, phone, email, natureOfBusiness } (client input)
 * Upserts the BusinessCustomer (one per GSTIN; blank inputs never wipe saved details).
 * Throws HttpError(400) for an invalid GSTIN, missing legal name or missing company state code.
 */
export const buildB2BFields = async ({ buyer = {}, invoice }) => {
  const profile = await getCompanyProfile();
  if (!profile || !isValidStateCode(profile.stateCode)) {
    throw new HttpError(400, "Set the company's GST state code in Manage Users → Company Profile before making a business (GST) invoice.");
  }
  const v = validateGstin(buyer.gstin);
  if (!v.valid) throw new HttpError(400, `Buyer GSTIN: ${v.error}`);

  const clean = (s) => String(s ?? "").trim();
  const set = { stateCode: v.stateCode, stateName: v.stateName, pan: v.pan };
  for (const k of ["legalName", "tradeName", "address", "phone", "email", "natureOfBusiness"]) if (clean(buyer[k])) set[k] = clean(buyer[k]);
  const existing = await BusinessCustomer.findOne({ gstin: v.gstin }).lean();
  if (!existing && !set.legalName) throw new HttpError(400, "Enter the business's legal name for this GSTIN.");
  let bc;
  try {
    bc = await BusinessCustomer.findOneAndUpdate({ gstin: v.gstin }, { $set: set, $setOnInsert: { gstin: v.gstin } }, { upsert: true, new: true, runValidators: true }).lean();
  } catch (e) {
    if (e.code !== 11000) throw e;
    bc = await BusinessCustomer.findOneAndUpdate({ gstin: v.gstin }, { $set: set }, { new: true }).lean(); // created by a parallel bill
  }

  const intra = v.stateCode === profile.stateCode;
  const breakup = computeGstBreakup({ lines: await gstLinesFrom(invoice.lineItems), saleValue: saleValueOf(invoice), intra });
  return {
    fields: {
      isB2B: true,
      businessCustomerId: bc._id,
      buyerGstin: v.gstin,
      buyerLegalName: bc.legalName,
      buyerTradeName: bc.tradeName || "",
      buyerAddress: bc.address || "",
      buyerPan: v.pan,
      placeOfSupply: { stateCode: v.stateCode, stateName: v.stateName },
      sellerGstin: profile.gstin || "",
      sellerStateCode: profile.stateCode,
      taxBreakup: { intra, taxable: breakup.totals.taxable, cgst: breakup.totals.cgst, sgst: breakup.totals.sgst, igst: breakup.totals.igst, tax: breakup.totals.tax },
      hsnSummary: breakup.hsnSummary,
      gstLines: breakup.lines,
    },
    businessCustomer: bc,
  };
};

/** Recompute the breakup of an existing business invoice (lines or totals changed). */
export const recomputeB2BBreakup = async (invoice) => {
  const intra = String(invoice.placeOfSupply?.stateCode || "") === String(invoice.sellerStateCode || "");
  const breakup = computeGstBreakup({ lines: await gstLinesFrom(invoice.lineItems), saleValue: saleValueOf(invoice), intra });
  return {
    taxBreakup: { intra, taxable: breakup.totals.taxable, cgst: breakup.totals.cgst, sgst: breakup.totals.sgst, igst: breakup.totals.igst, tax: breakup.totals.tax },
    hsnSummary: breakup.hsnSummary,
    gstLines: breakup.lines,
  };
};

export { validateGstin, stateName };
