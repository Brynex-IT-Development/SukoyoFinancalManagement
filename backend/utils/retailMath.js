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
