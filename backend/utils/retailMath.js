// Pure retail formulas (no database access) — phone normalisation, loyalty points,
// and how a return of an invoice that used redemptions is refunded.
// Checked against the worked examples by scripts/test-retail-math.js.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Normalise a phone number: digits only; 12 digits starting with 91 → last 10.
 * Accepts a 10-digit Indian mobile (starts 6–9), otherwise any 6–15 digit number.
 * Returns the normalised string, or null when the input is not a valid phone.
 */
export const normalizePhone = (raw) => {
  if (raw === undefined || raw === null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length >= 6 && digits.length <= 15) return digits;
  return null;
};

export const DEFAULT_LOYALTY_SETTINGS = Object.freeze({
  earnAmount: 100,
  earnPoints: 1,
  minInvoiceForEarning: 0,
  redeemAmount: 1,
  redeemPoints: 1,
  maxRedeemPercent: 50,
  minInvoiceForRedeem: 0,
  enabled: true,
});

const isOff = (s) => s.enabled === false;

/** ₹ value of one point. */
export const valuePerPoint = (s) => {
  const amt = Number(s.redeemAmount), pts = Number(s.redeemPoints);
  return amt > 0 && pts > 0 ? amt / pts : 0;
};

export const pointsToAmount = (points, s) => round2(Math.floor(Number(points) || 0) * valuePerPoint(s));

export const amountToPoints = (amount, s) => {
  const vpp = valuePerPoint(s);
  // Small epsilon so e.g. 0.3 / 0.1 does not floor to 2
  return vpp > 0 ? Math.floor((Number(amount) || 0) / vpp + 1e-9) : 0;
};

/**
 * Most a customer can redeem on a bill.
 * Returns { allowed, reason?, maxAmount, maxPoints }.
 */
export const maxRedeemable = ({ finalTotal, balance, settings: s }) => {
  const total = Number(finalTotal) || 0;
  const vpp = valuePerPoint(s);
  if (isOff(s)) return { allowed: false, reason: "Loyalty is switched off", maxAmount: 0, maxPoints: 0 };
  if (vpp <= 0) return { allowed: false, reason: "Loyalty redeem rate is not set", maxAmount: 0, maxPoints: 0 };
  if (total < (Number(s.minInvoiceForRedeem) || 0)) {
    return { allowed: false, reason: `Bill must be at least ₹${s.minInvoiceForRedeem} to redeem points`, maxAmount: 0, maxPoints: 0 };
  }
  const maxAmount = Math.floor(total * (Number(s.maxRedeemPercent) || 0) / 100);
  const maxPoints = Math.max(0, Math.min(Math.floor(maxAmount / vpp + 1e-9), Math.floor(Number(balance) || 0)));
  return { allowed: true, maxAmount, maxPoints };
};

/** Amount points are earned on: real money only (gift card / store credit count, loyalty and vouchers do not). */
export const earnBaseOf = ({ finalTotal, loyaltyAmount = 0, voucherAmount = 0 }) =>
  round2(Math.max(0, (Number(finalTotal) || 0) - (Number(loyaltyAmount) || 0) - (Number(voucherAmount) || 0)));

export const pointsEarned = (earnBase, s) => {
  if (isOff(s)) return 0;
  const base = Number(earnBase) || 0;
  const per = Number(s.earnAmount) || 0;
  if (per <= 0 || base < (Number(s.minInvoiceForEarning) || 0)) return 0;
  return Math.floor(base / per + 1e-9) * (Math.floor(Number(s.earnPoints)) || 0);
};

// ─── Vouchers (F5) ──────────────────────────────────────────────────────────

const lowerSet = (arr) => new Set((arr || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean));

/** True when the voucher scope has no lists set (applies to every item). */
export const isOpenScope = (scope = {}) =>
  !["brands", "categories", "subCategories", "itemIds"].some((k) => (scope?.[k] || []).length > 0);

/**
 * Sum of line amounts whose item matches the voucher scope. A line matches when ANY set
 * scope list matches (brand, category, sub category or item id). Empty scope = every line.
 * lines: [{ amount, itemIds: [ids…], brand, categories: [..], subCategory }]
 */
export const voucherEligibleTotal = (lines, scope = {}) => {
  const open = isOpenScope(scope);
  const brands = lowerSet(scope.brands), cats = lowerSet(scope.categories), subs = lowerSet(scope.subCategories);
  const ids = new Set((scope.itemIds || []).map(String));
  let total = 0;
  for (const l of lines || []) {
    const amount = Number(l.amount) || 0;
    if (amount <= 0) continue;
    const match = open
      || (l.brand && brands.has(String(l.brand).trim().toLowerCase()))
      || (l.categories || []).some((c) => c && cats.has(String(c).trim().toLowerCase()))
      || (l.subCategory && subs.has(String(l.subCategory).trim().toLowerCase()))
      || (l.itemIds || []).some((id) => id && ids.has(String(id)));
    if (match) total += amount;
  }
  return round2(total);
};

/**
 * What a voucher is worth on this bill (before checking dates, owner and usage limits).
 *  - value kind: min(balance, eligible total)
 *  - discount kind: flat = min(value, eligible); percent = min(eligible × value / 100, maxDiscount)
 * Both need finalTotal ≥ minBillAmount. Returns { allowed, reason?, amount }.
 */
export const voucherUsableAmount = ({ voucher: v, eligibleTotal, finalTotal }) => {
  const eligible = Number(eligibleTotal) || 0;
  if ((Number(finalTotal) || 0) < (Number(v.minBillAmount) || 0)) {
    return { allowed: false, reason: `Bill must be at least ₹${v.minBillAmount} to use this voucher`, amount: 0 };
  }
  if (eligible <= 0) return { allowed: false, reason: "No item on this bill qualifies for this voucher", amount: 0 };
  let amount;
  if (v.kind === "value") {
    amount = Math.min(Number(v.balance) || 0, eligible);
    if (amount <= 0) return { allowed: false, reason: "This voucher has no balance left", amount: 0 };
  } else if (v.discountType === "percent") {
    const raw = eligible * (Number(v.value) || 0) / 100;
    const cap = v.maxDiscount !== undefined && v.maxDiscount !== null && v.maxDiscount !== "" ? Number(v.maxDiscount) : Infinity;
    amount = Math.min(raw, cap);
  } else {
    amount = Math.min(Number(v.value) || 0, eligible);
  }
  amount = round2(amount);
  return amount > 0 ? { allowed: true, amount } : { allowed: false, reason: "This voucher gives no discount on this bill", amount: 0 };
};

// ─── Codes (gift cards / vouchers) ──────────────────────────────────────────

// No 0/O, 1/I/L so codes read cleanly off a printed card
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** e.g. randomCode("GC-", [4, 4], rnd) → "GC-7KQ2-M9XA". `rnd` returns 0 ≤ x < 1 (injectable for tests). */
export const randomCode = (prefix, groups = [4, 4], rnd = Math.random) =>
  prefix + groups.map((n) => Array.from({ length: n }, () => CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)]).join("")).join("-");

/** Uppercase, trim, and allow only letters, digits and dashes. */
export const cleanCode = (raw) => String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
export const isValidCode = (code) => /^[A-Z0-9][A-Z0-9-]{2,39}$/.test(code);

/** Sum redemption amounts of one or more types. */
export const redeemedOfType = (redemptions, ...types) =>
  round2((redemptions || []).filter((r) => types.includes(r.type)).reduce((s, r) => s + (Number(r.amount) || 0), 0));

/**
 * How a return of (part of) an invoice is refunded when the invoice used redemptions.
 *  - moneyShare = (base − loyalty − voucher) / base; refundable = returnValue × moneyShare
 *  - the gift-card / store-credit share is refunded as store credit only, never cash
 *  - refundMode "storeCredit" turns the whole refundable value into store credit
 *  - points used are restored round(), points earned are reversed floor(), both capped
 *    by what earlier returns already restored / reversed
 */
export const returnRefundSplit = ({
  baseTotal,
  returnValue,
  redemptions = [],
  pointsUsed = 0,
  pointsEarned: earned = 0,
  alreadyRestored = 0,
  alreadyReversed = 0,
  refundMode = "cash",
}) => {
  const base = Number(baseTotal) || 0;
  const rv = Math.abs(Number(returnValue) || 0);
  if (base <= 0 || rv <= 0) {
    return { returnValue: round2(rv), refundable: round2(rv), cashRefund: refundMode === "storeCredit" ? 0 : round2(rv),
      storeCreditAmount: refundMode === "storeCredit" ? round2(rv) : 0, nonRefundable: 0, pointsRestore: 0, pointsReverse: 0 };
  }
  const loyalty = redeemedOfType(redemptions, "loyalty");
  const voucher = redeemedOfType(redemptions, "voucher");
  const giftOrCredit = redeemedOfType(redemptions, "giftCard", "storeCredit");
  const ratio = rv / base;

  const refundableRaw = rv * ((base - loyalty - voucher) / base);
  const creditOnlyRaw = rv * (giftOrCredit / base);
  const refundable = round2(refundableRaw);
  const storeCreditAmount = round2(refundMode === "storeCredit" ? refundableRaw : creditOnlyRaw);
  // Derived from the rounded figures so cash + store credit always equals refundable exactly
  const cashRefund = round2(Math.max(0, refundable - storeCreditAmount));

  const pointsRestore = Math.max(0, Math.min(Math.round(pointsUsed * ratio), pointsUsed - alreadyRestored));
  const pointsReverse = Math.max(0, Math.min(Math.floor(earned * ratio + 1e-9), earned - alreadyReversed));

  return {
    returnValue: round2(rv),
    refundable,
    cashRefund,
    storeCreditAmount,
    nonRefundable: round2(rv - refundable),
    pointsRestore,
    pointsReverse,
  };
};
