// Bank account register helpers (F17). Pure: no database access.

/** "123456789012" → "••••••••9012" (last 4 shown). */
export const maskAccountNumber = (n) => {
  const s = String(n || "").replace(/\s+/g, "");
  if (s.length <= 4) return s;
  return `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
};

/** Account numbers: 6–20 letters/digits (spaces ignored). */
export const cleanAccountNumber = (n) => String(n || "").replace(/\s+/g, "").toUpperCase();
export const isValidAccountNumber = (n) => /^[A-Z0-9]{6,20}$/.test(cleanAccountNumber(n));

/** IFSC: 4 letters, a zero, 6 letters/digits (e.g. SBIN0070123). Empty is allowed. */
export const isValidIfsc = (s) => !s || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(s).trim().toUpperCase());

/** UPI id like name@bank. Empty is allowed. */
export const isValidUpi = (s) => !s || /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(String(s).trim());

/**
 * Money amount from input: a positive (or, with allowZero, non-negative) number with at most two
 * decimals. Returns the number, or null when invalid.
 */
export const parseAmount = (v, { allowZero = false } = {}) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) return null;
  return Math.round(n * 100) / 100;
};
