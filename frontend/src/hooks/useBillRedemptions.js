import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, normalizePhone, round2 } from "../utils/retailApi";

// Redemptions tied to the bill's customer. Gift cards are bearer cards and stay when the customer changes.
const CUSTOMER_BOUND = new Set(["loyalty", "storeCredit", "voucher"]);

const labelOf = (r) =>
  r.type === "loyalty" ? `${r.points} points` : r.label || r.code || "";

/**
 * Billing-screen state for the customer and their redemptions (loyalty points, store credit,
 * gift cards, voucher). Everything shown here is a preview from POST /redemptions/check; the
 * invoice save recomputes and validates it all on the server.
 *
 * @param phone      customer phone typed by the cashier
 * @param finalTotal bill total from the existing calculation (redemptions come after it)
 * @param locCode    store of the bill (loyalty settings and store-only vouchers depend on it)
 * @param lines      bill lines (voucher scope is checked against them)
 * @param invoiceId  when editing: this invoice's own redemptions count as available
 */
export default function useBillRedemptions({ phone, finalTotal, locCode, lines = [], invoiceId }) {
  const [lookup, setLookup] = useState({ status: "idle" }); // idle | loading | found | new | invalid | error
  const [redemptions, setRedemptions] = useState([]);
  const [owner, setOwner] = useState(null); // customer id the customer-bound redemptions belong to
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // bumped when a bill tab is restored → fresh lookup
  const total = round2(finalTotal);

  const customer = lookup.status === "found" ? lookup.customer : null;
  const totalRedeemed = useMemo(() => round2(redemptions.reduce((s, r) => s + (Number(r.amount) || 0), 0)), [redemptions]);
  const amountDue = round2(total - totalRedeemed);

  // ── Customer lookup as the phone is typed
  const lookupSeq = useRef(0);
  const refreshCustomer = useCallback(async () => {
    const normalized = normalizePhone(phone);
    const seq = ++lookupSeq.current;
    if (!String(phone || "").trim()) { setLookup({ status: "idle" }); return; }
    if (!normalized) { setLookup({ status: "invalid" }); return; }
    setLookup((l) => ({ ...l, status: "loading" }));
    try {
      const data = await api("/customers/lookup", { query: { phone: normalized, locCode } });
      if (seq !== lookupSeq.current) return; // a newer lookup started
      setLookup(data.customer
        ? { status: "found", customer: data.customer, storeCredits: data.storeCredits || [], loyalty: data.loyalty }
        : { status: "new", loyalty: data.loyalty });
    } catch (e) {
      if (seq === lookupSeq.current) setLookup({ status: "error", message: e.message });
    }
  }, [phone, locCode]);

  useEffect(() => {
    const t = setTimeout(refreshCustomer, 450);
    return () => clearTimeout(t);
  }, [refreshCustomer, reloadKey]);

  // Customer-bound redemptions are dropped when the bill's customer changes
  useEffect(() => {
    if (!redemptions.length || lookup.status === "loading") return;
    const currentId = customer?._id || null;
    if (owner && currentId !== owner) {
      const kept = redemptions.filter((r) => !CUSTOMER_BOUND.has(r.type));
      if (kept.length !== redemptions.length) {
        setRedemptions(kept);
        setNotice("Customer changed, so their points / store credit / voucher were removed. Gift cards stay.");
      }
      setOwner(null);
    }
  }, [customer, lookup.status, owner, redemptions]);

  // Lines in the shape the server resolves items from (voucher scope)
  const scopeLines = useMemo(() => (lines || []).filter((l) => l && (l.item || l.itemData)).map((l) => ({
    item: l.item, itemData: l.itemData ? { _id: l.itemData._id, itemName: l.itemData.itemName, sku: l.itemData.sku, itemGroupId: l.itemData.itemGroupId } : null,
    itemGroupId: l.itemGroupId || l.itemData?.itemGroupId || null, itemSku: l.itemSku || l.itemData?.sku || "",
    quantity: l.quantity, rate: l.rate, amount: l.amount,
  })), [lines]);

  const check = useCallback((body) => api("/redemptions/check", {
    method: "POST",
    body: { ...body, phone: normalizePhone(phone), customerId: customer?._id, finalTotal: total, locCode, invoiceId, lines: scopeLines },
  }), [phone, customer, total, locCode, invoiceId, scopeLines]);

  const othersTotal = (list, isSame) => round2(list.filter((r) => !isSame(r)).reduce((s, r) => s + (Number(r.amount) || 0), 0));

  // Shared apply: run the check, replace the matching entry, remember the customer
  const apply = useCallback(async (isSame, body, toEntry) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await check({ ...body, otherRedeemed: othersTotal(redemptions, isSame) });
      const entry = toEntry(res);
      setRedemptions((list) => [...list.filter((r) => !isSame(r) && !(r.type === entry.type && entry.refId && String(r.refId) === String(entry.refId))), entry]);
      if (CUSTOMER_BOUND.has(entry.type) && customer?._id) setOwner(customer._id);
      return res;
    } catch (e) {
      setNotice(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [check, redemptions, customer]);

  /** Loyalty: pass { points } or { amount }, or nothing to use the most allowed. */
  const applyLoyalty = useCallback(({ points, amount } = {}) => apply(
    (r) => r.type === "loyalty", { type: "loyalty", points, amount },
    (res) => ({ type: "loyalty", points: res.points, amount: res.amount, label: `${res.points} points` })
  ), [apply]);

  /** Store credit: { refId } or { code }, optional { amount } (default: as much as fits). */
  const applyStoreCredit = useCallback(({ refId, code, amount } = {}) => apply(
    (r) => r.type === "storeCredit" && ((refId && String(r.refId) === String(refId)) || (code && r.code === String(code).trim().toUpperCase())),
    { type: "storeCredit", refId, code, amount },
    (res) => ({ type: "storeCredit", refId: res.refId, code: res.code, amount: res.amount, label: res.code })
  ), [apply]);

  /** Gift card: { code }, optional { amount } (default: as much as fits). Several cards allowed. */
  const applyGiftCard = useCallback(({ code, amount } = {}) => apply(
    (r) => r.type === "giftCard" && r.code === String(code || "").trim().toUpperCase(),
    { type: "giftCard", code, amount },
    (res) => ({ type: "giftCard", refId: res.refId, code: res.code, amount: res.amount, label: res.code })
  ), [apply]);

  /** Voucher: { code }. One voucher per bill, so it replaces any voucher already applied. */
  const applyVoucher = useCallback(({ code } = {}) => apply(
    (r) => r.type === "voucher", { type: "voucher", code },
    (res) => ({ type: "voucher", refId: res.refId, code: res.code, amount: res.amount, label: res.label || res.code })
  ), [apply]);

  const remove = useCallback((index) => setRedemptions((list) => list.filter((_, i) => i !== index)), []);
  const clear = useCallback(() => { setRedemptions([]); setOwner(null); setNotice(""); }, []);

  /** Edit mode / bill tabs: start from saved redemptions. */
  const loadSaved = useCallback((saved, customerId) => {
    const list = (saved || []).filter((r) => r && r.type).map((r) => ({
      type: r.type, points: r.points || 0, amount: Number(r.amount) || 0, refId: r.refId || null, code: r.code || "",
      label: labelOf(r),
    }));
    setRedemptions(list);
    setOwner(list.some((r) => CUSTOMER_BOUND.has(r.type)) && customerId ? String(customerId) : null);
    setNotice("");
  }, []);

  /** Bill tabs: everything needed to restore this bill's redemptions later. */
  const exportState = useCallback(() => ({ redemptions, owner }), [redemptions, owner]);
  const importState = useCallback((s) => {
    setRedemptions(Array.isArray(s?.redemptions) ? s.redemptions : []);
    setOwner(s?.owner || null);
    setNotice("");
    // The other tab's customer is still in `lookup` until the new phone is looked up; mark it
    // loading so the "customer changed" check does not drop the restored redemptions meanwhile.
    setLookup({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  // ── When the bill total changes, re-check what is applied (limits depend on the total)
  const lastCheckedTotal = useRef(total);
  useEffect(() => {
    if (!redemptions.length || total === lastCheckedTotal.current || lookup.status === "loading") return;
    const t = setTimeout(async () => {
      lastCheckedTotal.current = total;
      const kept = [];
      const dropped = [];
      for (const r of redemptions) {
        try {
          const res = await check({
            type: r.type, refId: r.refId, code: r.code,
            points: r.type === "loyalty" ? r.points : undefined,
            amount: r.type === "storeCredit" || r.type === "giftCard" ? r.amount : undefined,
            otherRedeemed: round2(kept.reduce((s, k) => s + k.amount, 0)),
          });
          kept.push({ ...r, amount: res.amount, points: res.points ?? r.points });
        } catch (e) {
          dropped.push(`${r.label}: ${e.message}`);
        }
      }
      setRedemptions(kept);
      if (dropped.length) setNotice(`Bill total changed. Removed ${dropped.join("; ")}`);
    }, 600);
    return () => clearTimeout(t);
  }, [total, redemptions, check, lookup.status]);

  /** What the invoice save sends (the server recomputes amounts and points). */
  const payload = useMemo(() => redemptions.map(({ type, points, amount, refId, code }) => ({ type, points, amount, refId, code })), [redemptions]);

  return {
    lookup, customer, redemptions, totalRedeemed, amountDue, notice, busy, payload,
    applyLoyalty, applyStoreCredit, applyGiftCard, applyVoucher, remove, clear, loadSaved,
    exportState, importState, refreshCustomer, setNotice,
  };
}
