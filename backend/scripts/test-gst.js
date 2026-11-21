// Checks the GST helpers against the spec examples, and that the frontend copy matches.
// Run: node scripts/test-gst.js   (exits 1 on any failure)
import * as be from "../utils/gst.js";
import * as fe from "../../frontend/src/utils/gst.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};

for (const [label, g] of [["backend", be], ["frontend", fe]]) {
  // ── GSTIN validation (spec test cases)
  eq(`${label}: 27AAPFU0939F1ZV valid`, g.validateGstin("27AAPFU0939F1ZV").valid, true);
  eq(`${label}: 29AAGCB7383J1Z4 valid`, g.validateGstin("29AAGCB7383J1Z4").valid, true);
  eq(`${label}: 27AAPFU0939F1ZX fails checksum`, [g.validateGstin("27AAPFU0939F1ZX").valid, /check digit/.test(g.validateGstin("27AAPFU0939F1ZX").error)], [false, true]);
  eq(`${label}: lower case + spaces accepted`, g.validateGstin(" 27aapfu0939f1zv ").gstin, "27AAPFU0939F1ZV");
  eq(`${label}: state + PAN from GSTIN`, (({ stateCode, stateName, pan }) => ({ stateCode, stateName, pan }))(g.validateGstin("27AAPFU0939F1ZV")),
    { stateCode: "27", stateName: "Maharashtra", pan: "AAPFU0939F" });
  eq(`${label}: bad state code 40`, g.validateGstin("40AAPFU0939F1ZV").valid, false);
  eq(`${label}: wrong length`, /15 characters/.test(g.validateGstin("27AAPFU0939F1Z").error), true);
  eq(`${label}: 14th char must be Z`, g.validateGstin("27AAPFU0939F1YV").valid, false);
  eq(`${label}: state codes 38, 97, 99 known`, ["38", "97", "99"].map(g.isValidStateCode), [true, true, true]);

  // ── Tax split (inclusive, the billing screen's convention)
  eq(`${label}: ₹1050 incl 5% intra`, g.splitInclusive(1050, 5, true), { taxable: 1000, tax: 50, cgst: 25, sgst: 25, igst: 0 });
  eq(`${label}: ₹1050 incl 5% inter`, g.splitInclusive(1050, 5, false), { taxable: 1000, tax: 50, cgst: 0, sgst: 0, igst: 50 });
  eq(`${label}: odd paise split adds up`, (() => { const t = g.splitInclusive(1001, 3, true); return g.round2(t.taxable + t.cgst + t.sgst); })(), 1001);
  eq(`${label}: 0% line`, g.splitInclusive(500, 0, true), { taxable: 500, tax: 0, cgst: 0, sgst: 0, igst: 0 });

  // ── Breakup with an invoice discount shared across lines, HSN summary
  const b = g.computeGstBreakup({
    lines: [
      { amount: 2100, rate: 5, hsnCode: "7113", description: "Gold ring", quantity: 1 },
      { amount: 1120, rate: 12, hsnCode: "7117", description: "Fashion chain", quantity: 2 },
      { amount: 1050, rate: 5, hsnCode: "7113", description: "Earrings", quantity: 1 },
    ],
    saleValue: 4270 - 427, // 10% discount
    intra: true,
  });
  eq(`${label}: discount shared in proportion`, b.lines.map((l) => l.discount), [210, 112, 105]);
  eq(`${label}: totals add up to the sale value`, [b.totals.total, g.round2(b.totals.taxable + b.totals.tax)], [3843, 3843]);
  eq(`${label}: line 1 taxable/tax`, [b.lines[0].taxable, b.lines[0].cgst, b.lines[0].sgst], [1800, 45, 45]);
  eq(`${label}: HSN summary groups by HSN + rate`, b.hsnSummary.map((h) => `${h.hsnCode}@${h.rate}:${h.taxable}/${h.tax}`), ["7113@5:2700/135", "7117@12:900/108"]);
  const inter = g.computeGstBreakup({ lines: [{ amount: 1050, rate: 5, hsnCode: "7113" }], intra: false });
  eq(`${label}: inter-state → IGST only`, [inter.totals.igst, inter.totals.cgst, inter.totals.sgst], [50, 0, 0]);

  // ── Amount in words (Indian numbering)
  eq(`${label}: words lakh`, g.amountInWords(123456.78), "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only");
  eq(`${label}: words crore`, g.amountInWords(12500000), "Rupees One Crore Twenty Five Lakh Only");
  eq(`${label}: words small`, g.amountInWords(1350), "Rupees One Thousand Three Hundred Fifty Only");
  eq(`${label}: words zero`, g.amountInWords(0), "Rupees Zero Only");

  eq(`${label}: parse "GST5 [5%]"`, [g.parseTaxRate("GST5 [5%]"), g.parseTaxRate("GST 12%"), g.parseTaxRate(""), g.parseTaxRate("IGST18 [18%]")], [5, 12, null, 18]);
}

// ── The two copies must agree on everything
const sample = { lines: [{ amount: 999.99, rate: 18, hsnCode: "1" }, { amount: 333.33, rate: 3, hsnCode: "2" }], saleValue: 1200, intra: true };
eq("frontend copy gives the same breakup", JSON.stringify(fe.computeGstBreakup(sample)), JSON.stringify(be.computeGstBreakup(sample)));
eq("frontend copy has the same state table", JSON.stringify(fe.GST_STATES), JSON.stringify(be.GST_STATES));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll GST checks passed");
process.exit(failed ? 1 : 0);
