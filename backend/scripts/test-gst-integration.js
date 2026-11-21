// End-to-end checks for Phase 3 (company profile, business GST invoices) against a THROWAWAY database.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test3 node scripts/test-gst-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import ShoeItem from "../model/ShoeItem.js";
import BusinessCustomer from "../model/BusinessCustomer.js";
import Transaction from "../model/Transaction.js";
import { createSalesInvoice, updateSalesInvoice } from "../controllers/SalesInvoiceController.js";
import { saveCompanyProfile, getCompanyProfileApi, lookupGstin } from "../controllers/GstController.js";
import { gstinCheckChar } from "../utils/gst.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test3");
  process.exit(2);
}

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};
const call = (handler, { body = {}, params = {}, query = {} } = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  handler({ body, params, query, headers: {} }, res).catch(reject);
});
const settle = () => new Promise((r) => setTimeout(r, 500));
const ADMIN = "admin@test.local", STAFF = "staff@test.local", WH = "Test Store";
const gstinFor = (first14) => first14 + gstinCheckChar(first14);
const KERALA_SELLER = gstinFor("32AAACR5055K1Z"); // valid checksum, state 32
const KERALA_BUYER = gstinFor("32AABCT1332L1Z");
const MAHA_BUYER = "27AAPFU0939F1ZV";               // spec example (valid)

await mongoose.connect(uri);
await mongoose.connection.db.dropDatabase();
await BusinessCustomer.syncIndexes();
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin", locCode: "T01" });
await User.create({ username: "staff", email: STAFF, password: "x", power: "normal", role: "store_user", locCode: "T01", storeName: WH });
const stock = (q) => [{ warehouse: WH, stockOnHand: q, availableForSale: q, physicalStockOnHand: q, physicalAvailableForSale: q }];
const ring = await ShoeItem.create({ itemName: "Gold Ring", sku: "RING-1", hsnCode: "7113", taxRateIntra: "GST5 [5%]", sellingPrice: 2100, costPrice: 1500, trackInventory: true, warehouseStocks: stock(50) });
const chain = await ShoeItem.create({ itemName: "Fashion Chain", sku: "CHAIN-1", hsnCode: "7117", taxRateIntra: "GST12 [12%]", sellingPrice: 1120, costPrice: 700, trackInventory: true, warehouseStocks: stock(50) });
const line = (item, qty = 1) => ({ item: item.itemName, itemData: { _id: String(item._id), itemName: item.itemName, sku: item.sku }, itemSku: item.sku, quantity: qty, rate: item.sellingPrice, amount: item.sellingPrice * qty });
const bill = (lines, o = {}) => {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { customer: "", customerPhone: "", branch: WH, warehouse: WH, salesperson: "S1", category: "income", locCode: "T01",
    paymentMethod: "Bank", status: "sent", invoiceDate: new Date(), userId: ADMIN, lineItems: lines, subTotal: total, finalTotal: total, ...o };
};
const ringStock = async () => (await ShoeItem.findById(ring._id).lean()).warehouseStocks[0].stockOnHand;

// ── F8 needs the company state code first
let r = await call(createSalesInvoice, { body: bill([line(ring)], { customer: "Acme", isB2B: true, buyerGstin: KERALA_BUYER, buyer: { legalName: "Acme Traders" } }) });
eq("B2B refused before company profile exists", [r.status, /Company Profile/.test(r.body.message)], [400, true]);

// ── F7 company profile
r = await call(saveCompanyProfile, { body: { userId: STAFF, companyName: "X" } });
eq("profile save needs admin", r.status, 403);
r = await call(saveCompanyProfile, { body: { userId: ADMIN, companyName: "Sukoyo Jewels", gstin: "27AAPFU0939F1ZX" } });
eq("profile: bad GSTIN refused", [r.status, /check digit/.test(r.body.message)], [400, true]);
r = await call(saveCompanyProfile, { body: { userId: ADMIN, companyName: "Sukoyo Jewels", gstin: KERALA_SELLER, stateCode: "29" } });
eq("profile: GSTIN state vs state code mismatch refused", r.status, 400);
r = await call(saveCompanyProfile, { body: { userId: ADMIN, companyName: "Sukoyo Jewels", gstin: KERALA_SELLER.toLowerCase(), ifsc: "SBIN000123" } });
eq("profile: bad IFSC refused", r.status, 400);
r = await call(saveCompanyProfile, { body: { userId: ADMIN, companyName: "Sukoyo Jewels", gstin: KERALA_SELLER.toLowerCase(), address: "MG Road", city: "Kochi", pincode: "682001",
  bankName: "SBI", accountNumber: "1234567890", ifsc: "sbin0001234", logo: "data:image/png;base64,iVBORw0KGgo=" } });
eq("profile saved; state code, state and PAN taken from GSTIN", [r.status, r.body.profile?.stateCode, r.body.profile?.state, r.body.profile?.pan, r.body.profile?.gstin],
  [200, "32", "Kerala", KERALA_SELLER.slice(2, 12), KERALA_SELLER]);
r = await call(getCompanyProfileApi, {});
eq("profile readable for printouts", [r.body.profile?.companyName, r.body.profile?.ifsc], ["Sukoyo Jewels", "SBIN0001234"]);

// ── F8 intra-state (Kerala → Kerala): ring ₹2,100 (5%) + chain ₹1,120 (12%), 10% discount → ₹2,898
const before = await ringStock();
r = await call(createSalesInvoice, { body: bill([line(ring), line(chain)], { customer: "", isB2B: true, buyerGstin: " " + KERALA_BUYER.toLowerCase(),
  buyer: { legalName: "Acme Traders Pvt Ltd", tradeName: "Acme", address: "Broadway, Kochi" }, discountAmount: 322, finalTotal: 2898 }) });
eq("intra-state B2B saved", r.status, 201);
const b2b = r.body;
eq("buyer snapshot + place of supply", [b2b.isB2B, b2b.buyerGstin, b2b.customer, b2b.placeOfSupply?.stateCode, b2b.sellerGstin], [true, KERALA_BUYER, "Acme Traders Pvt Ltd", "32", KERALA_SELLER]);
eq("intra → CGST + SGST, no IGST", [b2b.taxBreakup?.intra, b2b.taxBreakup?.cgst, b2b.taxBreakup?.sgst, b2b.taxBreakup?.igst], [true, 99, 99, 0]); // ring 45 + chain 54
eq("taxable + tax = bill total", Math.round((b2b.taxBreakup.taxable + b2b.taxBreakup.tax) * 100) / 100, 2898);
eq("rates and HSN read from the items", b2b.gstLines.map((l) => `${l.hsnCode}@${l.rate}`), ["7113@5", "7117@12"]);
eq("ring line: ₹2,100 − ₹210 discount = ₹1,890 → taxable 1800, tax 90", [b2b.gstLines[0].discount, b2b.gstLines[0].taxable, b2b.gstLines[0].tax], [210, 1800, 90]);
eq("HSN summary", b2b.hsnSummary.map((h) => `${h.hsnCode}@${h.rate}:${h.taxable}`), ["7113@5:1800", "7117@12:900"]);
eq("stock still moved", await ringStock(), before - 1);
await settle();
eq("daybook unchanged by GST (amount = bill total)", (await Transaction.findOne({ invoiceNo: b2b.invoiceNumber }).lean())?.amount, "2898");

// ── Inter-state (Maharashtra buyer) → IGST
r = await call(createSalesInvoice, { body: bill([line(ring)], { isB2B: true, buyerGstin: MAHA_BUYER, buyer: { legalName: "Mumbai Gems LLP" } }) });
eq("inter-state → IGST only", [r.status, r.body.taxBreakup?.intra, r.body.taxBreakup?.igst, r.body.taxBreakup?.cgst, r.body.placeOfSupply?.stateName], [201, false, 100, 0, "Maharashtra"]);
const interInv = r.body;

// ── Errors leave nothing behind
const s1 = await ringStock();
r = await call(createSalesInvoice, { body: bill([line(ring)], { customer: "X", isB2B: true, buyerGstin: "27AAPFU0939F1ZX", buyer: { legalName: "Bad" } }) });
eq("invalid GSTIN refused", [r.status, /check digit/.test(r.body.message)], [400, true]);
r = await call(createSalesInvoice, { body: bill([line(ring)], { customer: "X", isB2B: true, buyerGstin: gstinFor("29AAGCB7383J1Z").replace(/.$/, (c) => c) }) });
eq("new GSTIN without legal name refused", [r.status, /legal name/.test(r.body.message)], [400, true]);
eq("refused bills moved no stock", await ringStock(), s1);

// ── One business record per GSTIN; blank fields never wipe saved ones
r = await call(createSalesInvoice, { body: bill([line(ring)], { customer: "Acme", isB2B: true, buyerGstin: KERALA_BUYER, buyer: { legalName: "", address: "" } }) });
eq("repeat buyer: saved details used", [r.status, r.body.buyerLegalName, r.body.buyerAddress], [201, "Acme Traders Pvt Ltd", "Broadway, Kochi"]);
r = await call(createSalesInvoice, { body: bill([line(ring)], { customer: "Acme", isB2B: true, buyerGstin: KERALA_BUYER, buyer: { legalName: "Acme Traders Private Limited" } }) });
eq("repeat buyer with new name: updated, not duplicated", [await BusinessCustomer.countDocuments({ gstin: KERALA_BUYER }), r.body.buyerLegalName], [1, "Acme Traders Private Limited"]);
eq("old invoice keeps its own buyer snapshot", b2b.buyerLegalName, "Acme Traders Pvt Ltd");
r = await call(lookupGstin, { params: { gstin: KERALA_BUYER.toLowerCase() }, query: { userId: STAFF } });
eq("GSTIN lookup: saved business + intra flag", [r.status, r.body.business?.legalName, r.body.intra, r.body.pan], [200, "Acme Traders Private Limited", true, KERALA_BUYER.slice(2, 12)]);
r = await call(lookupGstin, { params: { gstin: "27AAPFU0939F1ZX" }, query: { userId: STAFF } });
eq("GSTIN lookup: invalid → 400 with reason", [r.status, r.body.valid], [400, false]);

// ── Without GSTIN = a normal invoice with the business name
r = await call(createSalesInvoice, { body: bill([line(ring)], { customer: "Corner Shop (no GSTIN)", isB2B: false }) });
eq("business without GSTIN is a normal invoice", [r.status, r.body.isB2B, r.body.taxBreakup?.taxable ?? null], [201, false, null]);

// ── Edit: lines change → breakup recomputed; switch off → cleared
r = await call(updateSalesInvoice, { params: { id: String(interInv._id) }, body: { ...bill([line(ring, 2)]), userId: ADMIN } });
eq("edit recomputes IGST for 2 rings", [r.status, r.body.taxBreakup?.igst, r.body.gstLines?.[0]?.quantity], [200, 200, 2]);
r = await call(updateSalesInvoice, { params: { id: String(interInv._id) }, body: { isB2B: false, userId: ADMIN } });
eq("edit can switch GST invoice off", [r.status, r.body.isB2B, r.body.buyerGstin, r.body.gstLines?.length], [200, false, "", 0]);

// ── Return of a business invoice = credit note for the same buyer
r = await call(createSalesInvoice, { body: bill([line(chain)], { customer: b2b.customer, category: "Return", originalInvoiceId: String(b2b._id), originalInvoiceNumber: b2b.invoiceNumber, finalTotal: -1008, subTotal: 1008, lineItems: [{ ...line(chain), amount: 1008 }] }) });
eq("return carries buyer GSTIN and its own breakup", [r.status, r.body.isB2B, r.body.buyerGstin, r.body.taxBreakup?.taxable, r.body.taxBreakup?.cgst], [201, true, KERALA_BUYER, 900, 54]);

// ── Lines shaped like the billing screen sends them: line.amount is the price WITHOUT tax
r = await call(createSalesInvoice, { body: bill([{ ...line(ring), amount: 2000 }], { isB2B: true, buyerGstin: MAHA_BUYER, finalTotal: 2100, subTotal: 2100 }) });
eq("screen-style line (amount without tax): taxable 2000, IGST 100 on ₹2,100", [r.status, r.body.taxBreakup?.taxable, r.body.taxBreakup?.igst, r.body.gstLines?.[0]?.total], [201, 2000, 100, 2100]);

await settle(); // let background daybook writes finish before disconnecting
await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll GST integration checks passed");
process.exit(failed ? 1 : 0);
