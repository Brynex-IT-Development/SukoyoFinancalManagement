// GST helpers (pure, no database, no network) — F7/F8.
// An identical copy lives at frontend/src/utils/gst.js for live checks on screen;
// scripts/test-gst.js verifies both copies give the same answers. Keep them in sync.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// GST state / UT codes (first two digits of a GSTIN)
export const GST_STATES = Object.freeze({
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar",
  "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
});

export const stateName = (code) => GST_STATES[String(code || "").padStart(2, "0")] || "";
export const isValidStateCode = (code) => /^\d{2}$/.test(String(code || "")) && !!GST_STATES[String(code)];

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const normalizeGstin = (raw) => String(raw ?? "").toUpperCase().replace(/\s+/g, "").trim();

/** Check character for the first 14 characters of a GSTIN. */
export const gstinCheckChar = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARSET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
};

/**
 * Offline GSTIN check: format, state code, checksum.
 * Returns { valid, gstin, stateCode, stateName, pan, error }.
 */
export const validateGstin = (raw) => {
  const gstin = normalizeGstin(raw);
  const base = { valid: false, gstin, stateCode: "", stateName: "", pan: "" };
  if (!gstin) return { ...base, error: "Enter a GSTIN." };
  if (gstin.length !== 15) return { ...base, error: `GSTIN must be 15 characters (this has ${gstin.length}).` };
  if (!GSTIN_RE.test(gstin)) return { ...base, error: "GSTIN format is not valid (e.g. 27AAPFU0939F1ZV)." };
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATES[stateCode]) return { ...base, error: `${stateCode} is not a valid GST state code.` };
  const expected = gstinCheckChar(gstin.slice(0, 14));
  if (gstin[14] !== expected) return { ...base, stateCode, stateName: GST_STATES[stateCode], error: "GSTIN check digit does not match. Please re-check the number." };
  return { valid: true, gstin, stateCode, stateName: GST_STATES[stateCode], pan: gstin.slice(2, 12), error: "" };
};

/** Split a tax-inclusive amount into taxable value and tax at `rate` %. */
export const splitInclusive = (inclusiveAmount, rate, intra) => {
  const gross = round2(inclusiveAmount);
  const r = Number(rate) || 0;
  const taxable = r > 0 ? round2(gross / (1 + r / 100)) : gross;
  const tax = round2(gross - taxable); // difference, so taxable + tax = gross exactly
  if (intra) {
    const cgst = round2(tax / 2);
    return { taxable, tax, cgst, sgst: round2(tax - cgst), igst: 0 };
  }
  return { taxable, tax, cgst: 0, sgst: 0, igst: tax };
};

/**
 * GST breakup of a tax-inclusive bill (the convention the billing screen uses).
 * lines: [{ amount (qty × rate, tax included), rate (%), hsnCode, description, quantity, unitRate }]
 * saleValue: what the goods were actually sold for, tax included (bill total + TDS − round-off).
 *   The difference to the sum of line amounts is the invoice discount, shared across lines
 *   in proportion to their amounts (the last line takes the rounding remainder).
 * intra: true → CGST + SGST (half each), false → IGST.
 */
export const computeGstBreakup = ({ lines = [], saleValue, intra }) => {
  const valid = lines.filter((l) => (Number(l.amount) || 0) > 0);
  const gross = round2(valid.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const target = saleValue === undefined || saleValue === null ? gross : round2(Math.max(0, Math.min(Number(saleValue) || 0, gross)));
  const discount = round2(gross - target);

  let shared = 0;
  const out = valid.map((l, i) => {
    const amount = round2(l.amount);
    const share = i === valid.length - 1 ? round2(discount - shared) : (gross > 0 ? round2(discount * amount / gross) : 0);
    shared = round2(shared + share);
    const net = round2(amount - share);
    const rate = Number(l.rate) || 0;
    const t = splitInclusive(net, rate, intra);
    return {
      description: l.description || "", hsnCode: String(l.hsnCode || "").trim(), quantity: Number(l.quantity) || 0,
      unitRate: Number(l.unitRate) || 0, rate, gross: amount, discount: share, total: net, ...t,
    };
  });

  const sum = (k) => round2(out.reduce((s, l) => s + (l[k] || 0), 0));
  const totals = { gross, discount, taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), tax: sum("tax"), total: sum("total") };

  const groups = new Map();
  for (const l of out) {
    const key = `${l.hsnCode || "—"}|${l.rate}`;
    const g = groups.get(key) || { hsnCode: l.hsnCode || "", rate: l.rate, quantity: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    g.quantity += l.quantity;
    for (const k of ["taxable", "cgst", "sgst", "igst", "tax"]) g[k] = round2(g[k] + l[k]);
    groups.set(key, g);
  }
  const hsnSummary = [...groups.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rate - b.rate);

  return { intra: !!intra, lines: out, totals, hsnSummary };
};

// ─── Amount in words (Indian numbering: thousand, lakh, crore) ──────────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n) => {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
};
const integerWords = (n) => {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
};

/** 123456.78 → "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only" */
export const amountInWords = (amount) => {
  const value = Math.abs(round2(Number(amount) || 0));
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  return `Rupees ${integerWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
};

// Tax rate from item tax fields like "GST5 [5%]", "GST 12%", "IGST18 [18%]"
export const parseTaxRate = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value);
  const bracket = s.match(/\[(\d+(?:\.\d+)?)%?\]/);
  if (bracket) return Number(bracket[1]);
  const num = s.match(/(\d+(?:\.\d+)?)/);
  return num ? Number(num[1]) : null;
};
