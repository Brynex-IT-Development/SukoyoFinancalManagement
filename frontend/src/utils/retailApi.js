// Shared helpers for the customer / loyalty / store credit screens.
import baseUrl from "../api/api";

export const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";

export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem("rootfinuser") || "null") || {};
  } catch {
    return {};
  }
};

export const userIdOf = (u = getCurrentUser()) => u?.email || u?.username || "";

export const isAdminUser = (u = getCurrentUser()) =>
  u?.power === "admin" || u?.role === "admin" || u?.role === "superadmin";

/**
 * fetch wrapper: adds userId (query for GET, body otherwise), parses JSON,
 * throws Error(message) with .status and .data on a non-2xx response.
 */
export const api = async (path, { method = "GET", body, query = {} } = {}) => {
  const userId = userIdOf();
  const params = new URLSearchParams();
  Object.entries(method === "GET" ? { ...query, userId } : query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.append(k, v);
  });
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify({ ...(body || {}), userId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

export const formatCurrency = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

export const formatDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

/** Same rule as the server (backend/utils/retailMath.js normalizePhone). */
export const normalizePhone = (raw) => {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 10 && /^[6-9]/.test(d)) return d;
  if (d.length >= 6 && d.length <= 15) return d;
  return null;
};

export const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

export const STORE_CREDIT_STATUS_STYLES = {
  open: "bg-[#F6FCE6] border-[#DEF39A] text-[#15171D]",
  used: "bg-[#F3F4F6] border-[#E5E7EB] text-[#6B7280]",
  expired: "bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]",
  void: "bg-red-50 border-red-200 text-red-700",
};

export const GIFT_CARD_STATUS_STYLES = {
  active: "bg-[#F6FCE6] border-[#DEF39A] text-[#15171D]",
  blocked: "bg-red-50 border-red-200 text-red-700",
  expired: "bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]",
};

/** Human label for one invoice redemption (loyalty / store credit / gift card / voucher). */
export const redemptionLabel = (r) =>
  r.type === "loyalty" ? `Loyalty points (${r.points} pts)`
    : r.type === "storeCredit" ? `Store credit ${r.code}`
    : r.type === "giftCard" ? `Gift card ${r.code}`
    : r.type === "voucher" ? `Voucher ${r.code}`
    : `${r.type} ${r.code || ""}`;

/** Voucher value as text: "₹500 stored value", "10% off (max ₹150)", "₹100 off". */
export const voucherValueText = (v) =>
  v.kind === "value" ? `₹${v.value} stored value`
    : v.discountType === "percent" ? `${v.value}% off${v.maxDiscount ? ` (max ₹${v.maxDiscount})` : ""}`
    : `₹${v.value} off`;

/** Voucher state for lists: inactive | expired | not started | active. */
export const voucherState = (v) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const day = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (!v.active) return "inactive";
  if (v.validTo && day(v.validTo) < today) return "expired";
  if (v.validFrom && day(v.validFrom) > today) return "not started";
  if (v.kind === "value" && !(v.balance > 0)) return "used up";
  if (v.usageLimitTotal && v.usedCount >= v.usageLimitTotal) return "used up";
  return "active";
};

export const VOUCHER_STATE_STYLES = {
  active: "bg-[#F6FCE6] border-[#DEF39A] text-[#15171D]",
  inactive: "bg-[#F3F4F6] border-[#E5E7EB] text-[#6B7280]",
  expired: "bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]",
  "not started": "bg-blue-50 border-blue-200 text-blue-700",
  "used up": "bg-[#F3F4F6] border-[#E5E7EB] text-[#6B7280]",
};

export const LEDGER_LABELS = {
  earn: "Earned",
  redeem: "Redeemed",
  reverse_earn: "Earn reversed",
  restore_redeem: "Redeem restored",
  adjust: "Adjustment",
};

// Shared class names, matching the existing list pages (SalesReturns.jsx)
export const ui = {
  page: "invoice-page-wrapper transition-all duration-300 min-h-screen bg-[#F9FAFB] flex flex-col",
  topBar: "px-6 pt-5 pb-4 border-b border-[#E5E7EB] bg-white",
  h1: "text-xl font-bold tracking-tight text-[#111827] uppercase",
  sub: "text-xs text-[#6B7280] mt-0.5",
  btn: "inline-flex h-9 items-center gap-2 rounded-none border border-[#E5E7EB] bg-[#EEEEEE] hover:bg-[#E2E2E2] px-3.5 text-xs font-semibold text-[#111827] shadow-sm transition-colors cursor-pointer disabled:opacity-50",
  btnDark: "inline-flex h-9 items-center gap-2 rounded-none bg-[#1C1F26] hover:bg-[#15171D] px-4 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50",
  input: "w-full h-9 px-3 rounded-none border border-[#E5E7EB] bg-white text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#1C1F26] focus:outline-none transition-colors",
  label: "block text-xs font-semibold text-[#374151] mb-1",
  card: "rounded-none border border-[#E5E7EB] bg-white shadow-sm",
  th: "px-3 py-3 text-left border-r border-[#333333] whitespace-nowrap",
  thRight: "px-3 py-3 text-right border-r border-[#333333] whitespace-nowrap",
  theadRow: "bg-[#1e1e1e] text-white text-xs uppercase tracking-wide font-bold",
  td: "px-3 py-2.5",
  badge: "inline-flex items-center rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
  sectionTitle: "text-xs font-bold uppercase tracking-wider text-[#1C1F26] mb-3",
};
