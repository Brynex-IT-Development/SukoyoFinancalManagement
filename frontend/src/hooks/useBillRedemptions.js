import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, normalizePhone, round2 } from "../utils/retailApi";

/**
 * Billing-screen state for the customer and their redemptions (loyalty points, store credit).
 * Everything shown here is a preview from POST /redemptions/check; the invoice save
 * recomputes and validates it all on the server.
 *
 * @param phone      customer phone typed by the cashier
 * @param finalTotal bill total from the existing calculation (redemptions come after it)
 * @param locCode    store of the bill (loyalty settings can differ per store)
 * @param invoiceId  when editing: this invoice's own redemptions count as available
 */
export default function useBillRedemptions({ phone, finalTotal, locCode, invoiceId }) {
  const [lookup, setLookup] = useState({ status: "idle" }); // idle | loading | found | new | invalid | error
  const [redemptions, setRedemptions] = useState([]);
  const [owner, setOwner] = useState(null); // customer id the redemptions belong to
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
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
  }, [refreshCustomer]);

  // Redemptions belong to one customer: drop them when the bill's customer changes
  useEffect(() => {
    if (!redemptions.length || lookup.status === "loading") return;
    const currentId = customer?._id || null;
    if (owner && currentId !== owner) {
      setRedemptions([]);
      setOwner(null);
      setNotice("Customer changed, so the applied points / store credit were removed.");
    }
  }, [customer, lookup.status, owner, redemptions.length]);

  const check = useCallback((body) => api("/redemptions/check", {
    method: "POST",
    body: { ...body, phone: normalizePhone(phone), customerId: customer?._id, finalTotal: total, locCode, invoiceId },
  }), [phone, customer, total, locCode, invoiceId]);

  const othersTotal = (list, keep) => round2(list.filter((r) => !keep(r)).reduce((s, r) => s + (Number(r.amount) || 0), 0));

  /** Apply loyalty: pass { points } or { amount }, or nothing to use the most allowed. */
  const applyLoyalty = useCallback(async ({ points, amount } = {}) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await check({ type: "loyalty", points, amount, otherRedeemed: othersTotal(redemptions, (r) => r.type === "loyalty") });
      setRedemptions((list) => [...list.filter((r) => r.type !== "loyalty"), { type: "loyalty", points: res.points, amount: res.amount, label: `${res.points} points` }]);
      setOwner(customer?._id || null);
      return res;
    } catch (e) {
      setNotice(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [check, redemptions, customer]);

  /** Apply store credit: { refId } or { code }, optional { amount } (default: as much as fits). */
  const applyStoreCredit = useCallback(async ({ refId, code, amount } = {}) => {
    setBusy(true);
    setNotice("");
    try {
      const same = (r) => r.type === "storeCredit" && ((refId && String(r.refId) === String(refId)) || (code && r.code === String(code).trim().toUpperCase()));
      const res = await check({ type: "storeCredit", refId, code, amount, otherRedeemed: othersTotal(redemptions, same) });
      setRedemptions((list) => [
        ...list.filter((r) => !(r.type === "storeCredit" && String(r.refId) === String(res.refId))),
        { type: "storeCredit", refId: res.refId, code: res.code, amount: res.amount, label: res.code },
      ]);
      setOwner(customer?._id || null);
      return res;
    } catch (e) {
      setNotice(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [check, redemptions, customer]);

  const remove = useCallback((index) => setRedemptions((list) => list.filter((_, i) => i !== index)), []);
  const clear = useCallback(() => { setRedemptions([]); setOwner(null); setNotice(""); }, []);

  /** Edit mode: start from the invoice's saved redemptions. */
  const loadSaved = useCallback((saved, customerId) => {
    const list = (saved || []).filter((r) => r && r.type).map((r) => ({
      type: r.type, points: r.points || 0, amount: Number(r.amount) || 0, refId: r.refId || null, code: r.code || "",
      label: r.type === "loyalty" ? `${r.points} points` : r.code,
    }));
    setRedemptions(list);
    setOwner(list.length ? (customerId ? String(customerId) : null) : null);
  }, []);

  // ── When the bill total changes, re-check what is applied (limits depend on the total)
  const lastCheckedTotal = useRef(total);
  useEffect(() => {
    if (!redemptions.length || total === lastCheckedTotal.current || lookup.status !== "found") return;
    const t = setTimeout(async () => {
      lastCheckedTotal.current = total;
      const kept = [];
      const dropped = [];
      for (const r of redemptions) {
        try {
          const res = await check({ type: r.type, points: r.type === "loyalty" ? r.points : undefined, amount: r.type === "storeCredit" ? r.amount : undefined,
            refId: r.refId, code: r.code, otherRedeemed: round2(kept.reduce((s, k) => s + k.amount, 0)) });
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
    applyLoyalty, applyStoreCredit, remove, clear, loadSaved, refreshCustomer, setNotice,
  };
}
