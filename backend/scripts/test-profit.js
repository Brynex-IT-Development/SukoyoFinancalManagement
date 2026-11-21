// Checks the Phase 5 formulas (profit, P&L, purchase register, stock health) on worked examples.
// Run: node scripts/test-profit.js   (exits 1 on any failure)
import {
  valueSale, valueReturn, valueInvoice, saleLinesAsSold, taxableShare, lineTaxRate, profitStatus,
  isReturnInvoice, isCountableInvoice, expenseGroup, isRecordedExpense, isOtherIncome, buildProfitAndLoss,
  purchaseRegisterRows, itemPurchasesByVendor, documentTax, deadStock, overstock, abcClassify, istDaysBetween,
  invoiceTaxableShare, returnRateHint,
} from "../utils/profit.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};
const IST = (d) => new Date(`${d}T12:00:00+05:30`);
const gst = (r) => ({ _id: `item${r}`, taxRateIntra: `GST${r} [${r}%]` });
const pick = (v, keys) => keys.map((k) => v[k]);

// ── Invoice kinds
eq("return by category or RTN- number", [isReturnInvoice({ category: "Return" }), isReturnInvoice({ invoiceNumber: "RTN-0004" }), isReturnInvoice({ category: "Shoe Sales", invoiceNumber: "INV-1" })], [true, true, false]);
eq("drafts and cancelled left out", [isCountableInvoice({ status: "draft" }), isCountableInvoice({ status: "Draft" }), isCountableInvoice({ status: "cancelled" }), isCountableInvoice({ status: "sent" }), isCountableInvoice({ status: "paid" })], [false, false, false, true, true]);

// ── Tax rate of a line (billing screen order)
eq("rate from itemData, then tax choice, else null", [lineTaxRate({ itemData: gst(18) }), lineTaxRate({ tax: "gst12" }), lineTaxRate({ tax: "GST 5%" }), lineTaxRate({ tax: "gst0" }), lineTaxRate({})], [18, 12, 5, 0, null]);
eq("unknown rate: the billing screen's base amount gives the share", taxableShare({ quantity: 1, rate: 1120, amount: 1000 }), 1000 / 1120);
eq("unknown rate and inclusive amount: no tax", taxableShare({ quantity: 1, rate: 1120, amount: 1120 }), 1);
eq("return line uses the sale line's rate hint", taxableShare({ quantity: 1, rate: 1120, amount: 1120 }, 12), 1 / 1.12);

// ── Example 1: one line, GST 18%, no discount
// 2 × ₹1,180 (tax incl.) = ₹2,360 → taxable ₹2,000, tax ₹360; cost 2 × ₹600 → profit ₹800, margin 40%
const inv1 = { finalTotal: 2360, lineItems: [{ item: "Ring", quantity: 2, rate: 1180, amount: 2000, costPrice: 600, itemData: gst(18) }] };
const v1 = valueSale(inv1);
eq("example 1: taxable, tax, cost, profit, margin", pick(v1, ["taxable", "tax", "cost", "profit", "marginPct"]), [2000, 360, 1200, 800, 40]);
eq("example 1: status", profitStatus(v1.profit), "Profit");

// ── Example 2: invoice discount shared over lines at different rates
// A ₹1,050 (5%) + B ₹1,180 (18%) = ₹2,230; discount ₹223 → sold for ₹2,007.
// Shares: A 223 × 1050/2230 = ₹105 → net ₹945 → taxable ₹900, tax ₹45; B ₹118 → net ₹1,062 → taxable ₹900, tax ₹162
const inv2 = { finalTotal: 2007, discountAmount: 223, lineItems: [
  { item: "A", quantity: 1, rate: 1050, amount: 1000, costPrice: 700, itemData: gst(5) },
  { item: "B", quantity: 1, rate: 1180, amount: 1000, costPrice: 950, itemData: gst(18) },
] };
const v2 = valueSale(inv2);
eq("example 2: line discount shares", v2.lines.map((l) => l.discount), [105, 118]);
eq("example 2: line taxable / tax", v2.lines.map((l) => [l.taxable, l.tax]), [[900, 45], [900, 162]]);
eq("example 2: totals", [v2.taxable, v2.tax, v2.cost, v2.profit, profitStatus(v2.profit)], [1800, 207, 1650, 150, "Profit"]);
eq("break even within half a paisa", [profitStatus(0.004), profitStatus(-0.01)], ["Break even", "Loss"]);

// ── Example 3: partial return. Sale X 3 × ₹1,050 + Y 1 × ₹2,100 (all 5%) = ₹5,250; 1 X returned later.
// The return screen trimmed the sale to X 2 (amount now 2,100 incl.) and rescaled finalTotal to 4,100.
// As sold: taxable 3,150/1.05 + 2,100/1.05 = 5,000, cost 3 × 500 + 1,200 = 2,700. Return: taxable 1,000, cost 500.
// Net sales 4,000, COGS 2,200 — the return is subtracted once, in the month it happened.
const X = { _id: "X", taxRateIntra: "GST5 [5%]" }, Y = { _id: "Y", taxRateIntra: "GST5 [5%]" };
const ret3 = { invoiceNumber: "RTN-1", category: "Return", finalTotal: -1050, lineItems: [{ item: "X", quantity: 1, rate: 1050, amount: 1050, costPrice: 500, itemData: X }] };
const sale3 = { invoiceNumber: "INV-3", returnStatus: "partial", finalTotal: 4100, subTotal: 4100, discountAmount: 0, lineItems: [
  { item: "X", quantity: 2, rate: 1050, amount: 2100, costPrice: 500, itemData: X },
  { item: "Y", quantity: 1, rate: 2100, amount: 2000, costPrice: 1200, itemData: Y },
] };
const v3 = valueSale(sale3, [ret3]);
eq("example 3: sale rebuilt as sold", [v3.rebuilt, v3.lines.map((l) => l.qty), v3.taxable, v3.cost], [true, [3, 1], 5000, 2700]);
const r3 = valueReturn(ret3);
eq("example 3: return valued from its own lines", [r3.taxable, r3.tax, r3.cost], [1000, 50, 500]);
const pl3 = buildProfitAndLoss({ sales: [v3], returns: [r3] });
eq("example 3: net sales, COGS, gross profit, margin", pick(pl3, ["netSales", "cogs", "grossProfit", "grossMarginPct"]), [4000, 2200, 1800, 45]);

// Full return: the sale's lines were emptied (finalTotal left as it was) → rebuilt entirely from the return
const ret4 = { invoiceNumber: "RTN-2", category: "Return", finalTotal: -5250, lineItems: [
  { item: "X", quantity: 3, rate: 1050, amount: 3150, costPrice: 500, itemData: X },
  { item: "Y", quantity: 1, rate: 2100, amount: 2100, costPrice: 1200, itemData: Y },
] };
const v4 = valueSale({ returnStatus: "full", finalTotal: 5250, discountAmount: 0, lineItems: [] }, [ret4]);
eq("full return: rebuilt from the return lines", [v4.rebuilt, v4.taxable, v4.cost], [true, 5000, 2700]);
eq("full return nets to zero", buildProfitAndLoss({ sales: [v4], returns: [valueReturn(ret4)] }).netSales, 0);
// A sale whose trim never happened (returnStatus none) is not rebuilt
eq("untrimmed sale is not rebuilt", saleLinesAsSold({ returnStatus: "none", lineItems: [{ item: "X", quantity: 3, itemData: X }] }, [ret3]).lines[0].quantity, 3);
// Rebuilt sale with an invoice discount keeps the discount (finalTotal was rescaled by the trim)
const v5 = valueSale({ returnStatus: "partial", finalTotal: 1000, discountAmount: 100, lineItems: [{ item: "X", quantity: 1, rate: 1050, amount: 1000, costPrice: 500, itemData: X }] }, [ret3]);
eq("rebuilt sale: 2 × 1,050 − discount 100 = 2,000 incl. → taxable 1,904.76", v5.taxable, 1904.76);

// Return line with no rate of its own: the sale line's rate, else the original invoice's average
// (a full return empties the sale's lines but leaves subTotal 1,180 / totalTax 180 → 18%)
eq("invoice average share survives a trim (totalTax and subTotal rescaled together)", [invoiceTaxableShare({ subTotal: 1180, totalTax: 180 }), invoiceTaxableShare({ subTotal: 590, totalTax: 90 })].map((x) => Math.round(x * 1e6) / 1e6), [0.847458, 0.847458]);
const hintOrig = { subTotal: 1180, totalTax: 180, lineItems: [] };
eq("return rate hint from the original's average", Math.round(returnRateHint(hintOrig)({ item: "Ring", itemData: { _id: "r" } }) * 100) / 100, 18);
eq("return rate hint from the matching sale line first", returnRateHint({ subTotal: 1180, totalTax: 180, lineItems: [{ item: "X", tax: "gst12", itemData: { _id: "x" } }] })({ itemData: { _id: "x" } }), 12);
eq("return valued with the hint: 1,180 → taxable 1,000", valueReturn({ finalTotal: -1180, lineItems: [{ item: "Ring", quantity: 1, rate: 1180, amount: 1180, costPrice: 600, itemData: { _id: "r" } }] }, { rateHint: returnRateHint(hintOrig) }).taxable, 1000);

// ── Cost: snapshot, else current item cost (noted), else none
const v6 = valueInvoice({ finalTotal: 300, lineItems: [
  { item: "snap", quantity: 1, rate: 100, costPrice: 40 },
  { item: "old", quantity: 1, rate: 100, itemData: { _id: "old1" } },
  { item: "free text", quantity: 1, rate: 100 },
] }, { fallbackCost: (l) => (l.itemData?._id === "old1" ? 55 : null) });
eq("cost sources and counts", [v6.lines.map((l) => l.costSource), v6.cost, v6.fallbackLines, v6.noCostLines], [["snapshot", "fallback", "none"], 95, 1, 1]);

// ── Business invoice keeps its stored breakup
const v7 = valueSale({ isB2B: true, taxBreakup: { taxable: 1695.0, tax: 305.1 }, finalTotal: 2000.1, lineItems: [{ item: "B2B", quantity: 1, rate: 2000.1, amount: 1695, costPrice: 1000, itemData: gst(18) }] });
eq("B2B: totals from the stored breakup", [v7.taxable, v7.tax], [1695, 305.1]);

// ── Daybook rows
const tx = (type, category, amount, extra = {}) => ({ type, category, amount: String(amount), ...extra });
const expenses = [
  tx("Expense", "Rent", "-20000", { remark: "[INDIRECT] November rent" }),
  tx("Expense", "Packing", "-1500", { remark: "[DIRECT] boxes" }),
  tx("expense", "Tea", "-300", { remark: "staff tea" }),
  tx("Expense", "Vendor Payment", "-60000", { invoiceNo: "PAY-000001" }),
  tx("Expense", "Cash to Bank", "-5000"),
  tx("Expense", "Refund", "-1000", { invoiceNo: "RTN-0001" }),
].filter(isRecordedExpense);
eq("expenses: vendor payments, transfers and refunds left out", expenses.map((t) => t.category), ["Rent", "Packing", "Tea"]);
eq("expense groups from the remark tag", expenses.map(expenseGroup), ["indirect", "direct", "other"]);
const income = [tx("Income", "Commission", "2500"), tx("Income", "Gift Card Sale", "5000", { invoiceNo: "GCS-1" }), tx("Income", "Bank to Cash", "1000")].filter(isOtherIncome);
eq("other income: gift card money and transfers left out", income.map((t) => t.category), ["Commission"]);

// ── P&L with tax lines: net GST = output − input (purchase TAX, not the purchase total)
const bills = [{ finalTotal: 11800, items: [{ cgstAmount: 900, sgstAmount: 900 }] }, { finalTotal: 5000, totalTax: 238.1, items: [{}] }];
const credits = [{ finalTotal: 1180, items: [{ igstAmount: 180 }] }];
eq("document tax from lines, else stored total", bills.map(documentTax), [1800, 238.1]);
const pl = buildProfitAndLoss({ sales: [v1, v2], returns: [], expenses, income, bills, credits });
eq("P&L: net sales, COGS, gross profit", pick(pl, ["netSales", "cogs", "grossProfit"]), [3800, 2850, 950]);
eq("P&L: other income, expenses, net profit", pick(pl, ["otherIncome", "expenses", "netProfit"]), [2500, 21800, -18350]);
eq("P&L: expense groups", pl.expenseGroups, { direct: 1500, indirect: 20000, other: 300 });
eq("P&L: purchases = bills − vendor credits", pl.purchases, { bills: 16800, vendorCredits: 1180, net: 15620 });
eq("P&L: output 567, input 2,038.10 − 180, net GST payable", pl.gst, { outputTax: 567, inputTax: 1858.1, netPayable: -1291.1 });

// ── GST purchase register: one row per bill per rate, stored tax amounts
const regBills = [
  { _id: "b1", billDate: IST("2026-11-02"), billNumber: "B-1", vendorName: "Acme", vendorGstin: "32ABCDE1234F1Z5", items: [
    { baseAmount: 1000, cgstAmount: 25, sgstAmount: 25, taxPercent: 5 },
    { baseAmount: 2000, cgstAmount: 180, sgstAmount: 180, taxPercent: 18 },
    { baseAmount: 500, cgstAmount: 12.5, sgstAmount: 12.5, taxPercent: 5 },
  ] },
  { _id: "b2", billDate: IST("2026-11-03"), billNumber: "B-2", vendorName: "No GST Traders", vendorGstin: "", items: [{ baseAmount: 900, taxPercent: 0 }] },
  { _id: "b3", billDate: IST("2026-11-04"), billNumber: "B-3", vendorName: "Delhi Gold", vendorGstin: "07ABCDE1234F1Z5", items: [{ baseAmount: 10000, igstAmount: 300, taxPercent: 3, isInterState: true }] },
];
const reg = purchaseRegisterRows(regBills);
eq("register rows (no-GSTIN vendor left out)", reg.map((r) => [r.billNumber, r.rate, r.taxable, r.cgst, r.sgst, r.igst, r.cess, r.total]),
  [["B-1", 5, 1500, 37.5, 37.5, 0, 0, 1575], ["B-1", 18, 2000, 180, 180, 0, 0, 2360], ["B-3", 3, 10000, 0, 0, 300, 0, 10300]]);
const ipv = itemPurchasesByVendor([
  { _id: "p1", vendorId: "v1", vendorName: "Acme", items: [{ itemId: "i1", itemName: "Ring", quantity: 2, rate: 1050, baseAmount: 2000 }] },
  { _id: "p2", vendorId: "v1", vendorName: "Acme", items: [{ itemId: "i1", itemName: "Ring", quantity: 3, rate: 1100, baseAmount: 3142.86 }] },
  { _id: "p3", vendorId: "v2", vendorName: "Beta", items: [{ itemId: "i1", itemName: "Ring", quantity: 1, rate: 1000, baseAmount: 952.38 }] },
]);
eq("item purchases by vendor: qty, value, average rate", ipv.map((r) => [r.vendorName, r.qty, r.value, r.averageRate, r.bills]), [["Acme", 5, 5400, 1080, 2], ["Beta", 1, 1000, 1000, 1]]);

// ── Stock health
const TODAY = IST("2026-11-20");
eq("IST days between", istDaysBetween(IST("2026-11-01"), TODAY), 19);
const stockRows = [
  { key: "never", name: "Never sold", stock: 4, cost: 100, value: 400 },
  { key: "old", name: "Sold 100 days ago", stock: 2, cost: 1000, value: 2000 },
  { key: "recent", name: "Sold 10 days ago", stock: 5, cost: 10, value: 50 },
  { key: "empty", name: "No stock", stock: 0, cost: 10, value: 0 },
];
const last = new Map([["old", IST("2026-08-12")], ["recent", IST("2026-11-10")], ["empty", IST("2025-01-01")]]);
eq("dead stock at 90 days", deadStock(stockRows, last, 90, TODAY).map((r) => [r.key, r.daysSinceLastSale]), [["old", 100], ["never", null]]);
eq("dead stock at 120 days", deadStock(stockRows, last, 120, TODAY).map((r) => r.key), ["never"]);
eq("overstock: above maxStock only", overstock([{ key: "a", stock: 12, maxStock: 10, cost: 50 }, { key: "b", stock: 5, maxStock: 10, cost: 50 }, { key: "c", stock: 99, cost: 1 }]).map((r) => [r.key, r.excess, r.excessValue]), [["a", 2, 100]]);

// ABC: values 500, 300, 100, 60, 40 (total 1,000) → cumulative 50 A, 80 A, 90 B, 96 C, 100 C
const abc = abcClassify([
  { key: "e", name: "E", salesValue: 40, abcOverride: "A" }, { key: "a", name: "A", salesValue: 500 }, { key: "c", name: "C", salesValue: 100 },
  { key: "b", name: "B", salesValue: 300 }, { key: "d", name: "D", salesValue: 60 }, { key: "z", name: "Z", salesValue: 0 },
]);
eq("ABC: rank, cumulative share, computed class", abc.rows.map((r) => [r.key, r.cumulative, r.computedClass]), [["a", 50, "A"], ["b", 80, "A"], ["c", 90, "B"], ["d", 96, "C"], ["e", 100, "C"], ["z", 100, "C"]]);
eq("ABC: manual override wins", abc.rows.find((r) => r.key === "e").abcClass, "A");
eq("ABC: per-class items and value share", abc.summary, [{ abcClass: "A", items: 3, value: 840, share: 84 }, { abcClass: "B", items: 1, value: 100, share: 10 }, { abcClass: "C", items: 2, value: 60, share: 6 }]);
eq("ABC: one item over 80% on its own is B (rule applied as written)", abcClassify([{ key: "x", salesValue: 850 }, { key: "y", salesValue: 150 }]).rows.map((r) => r.computedClass), ["B", "C"]);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll profit checks passed");
process.exit(failed ? 1 : 0);
