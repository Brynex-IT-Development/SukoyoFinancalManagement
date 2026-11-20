import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { useActiveStores } from "../utils/storeService.js";
import { api, formatDateTime, isAdminUser, ui } from "../utils/retailApi";

const FIELDS = [
  ["earnAmount", "Spend (₹)", "Earn: every this many rupees…"],
  ["earnPoints", "Earns points", "…earns this many points"],
  ["minInvoiceForEarning", "Min bill to earn (₹)", "Bills below this earn nothing"],
  ["redeemPoints", "Points", "Redeem: this many points…"],
  ["redeemAmount", "Are worth (₹)", "…are worth this many rupees"],
  ["maxRedeemPercent", "Max % of bill", "Most of a bill points can pay"],
  ["minInvoiceForRedeem", "Min bill to redeem (₹)", "Points can't be used below this"],
];

const toForm = (s) => ({ ...Object.fromEntries(FIELDS.map(([k]) => [k, String(s?.[k] ?? "")])), enabled: s?.enabled !== false });

// Admin page: loyalty rules (default + per-store overrides, kept as versions) and store credit expiry.
const LoyaltySettings = () => {
  const isSidebarOpen = useSidebar();
  const { stores } = useActiveStores();
  const [data, setData] = useState(null);
  const [scope, setScope] = useState(""); // "" = default for all stores
  const [form, setForm] = useState(toForm(null));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [expirySaving, setExpirySaving] = useState(false);

  const load = useCallback(async () => {
    const [d, sc] = await Promise.all([api("/loyalty/settings"), api("/store-credits/settings")]);
    setData(d);
    setExpiryDays(String(sc.expiryDays));
    return d;
  }, []);

  useEffect(() => { load().catch((e) => setMsg(e.message)); }, [load]);

  // When the scope changes, show that scope's current row (or what it currently falls back to)
  useEffect(() => {
    if (!data) return;
    const own = data.active.find((r) => (r.locCode || "") === scope);
    const fallback = data.active.find((r) => !r.locCode) || data.defaults;
    setForm(toForm(own || fallback));
  }, [scope, data]);

  const storeName = useMemo(() => {
    const m = new Map((stores || []).map((s) => [String(s.locCode), s.locName || s.name]));
    return (code) => (code ? `${m.get(String(code)) || "Store"} (${code})` : "Default (all stores)");
  }, [stores]);

  if (!isAdminUser()) return <Navigate to="/" />;

  const vpp = Number(form.redeemAmount) / Number(form.redeemPoints) || 0;
  const example = (() => {
    const bill = 1250, bal = 900;
    const maxAmt = Math.floor(bill * (Number(form.maxRedeemPercent) || 0) / 100);
    const maxPts = vpp > 0 ? Math.min(Math.floor(maxAmt / vpp + 1e-9), bal) : 0;
    const paid = bill - maxPts * vpp;
    const earned = Number(form.earnAmount) > 0 && paid >= Number(form.minInvoiceForEarning || 0) ? Math.floor(paid / Number(form.earnAmount) + 1e-9) * (Number(form.earnPoints) || 0) : 0;
    return { maxPts, paid, earned, canRedeem: bill >= Number(form.minInvoiceForRedeem || 0) };
  })();

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      await api("/loyalty/settings", { method: "POST", body: { ...form, locCode: scope || null } });
      await load();
      setMsg(`Saved new settings for ${storeName(scope)}.`);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeOverride = async () => {
    if (!window.confirm(`${storeName(scope)} will use the default settings again. Continue?`)) return;
    try {
      await api("/loyalty/settings/remove-override", { method: "POST", body: { locCode: scope } });
      await load();
      setMsg(`${storeName(scope)} now uses the default settings.`);
    } catch (err) {
      setMsg(err.message);
    }
  };

  const saveExpiry = async () => {
    setExpirySaving(true);
    try {
      const r = await api("/store-credits/settings", { method: "PUT", body: { expiryDays: Number(expiryDays) } });
      setExpiryDays(String(r.expiryDays));
      setMsg("Store credit expiry saved. It applies to store credit issued from now on.");
    } catch (err) {
      setMsg(err.message);
    } finally {
      setExpirySaving(false);
    }
  };

  const hasOverride = !!data?.active.find((r) => r.locCode && r.locCode === scope);

  return (
    <>
      <Header title="Loyalty Settings" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <h1 className={ui.h1}>Loyalty & Store Credit Settings</h1>
          <p className={ui.sub}>Each save creates a new version; the previous one is kept in the history below.</p>
        </div>

        <div className="px-6 py-5 space-y-5 max-w-5xl">
          {msg && <p className="text-xs font-semibold text-[#1C1F26] bg-[#F6FCE6] border border-[#ECF9C7] px-3 py-2">{msg}</p>}

          <form onSubmit={save} className={`${ui.card} p-5 space-y-4`}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <label className={ui.label}>Applies to</label>
                <select value={scope} onChange={(e) => setScope(e.target.value)} className={ui.input}>
                  <option value="">Default (all stores)</option>
                  {(stores || []).filter((s) => s.locCode).map((s) => (
                    <option key={s.locCode} value={String(s.locCode)}>{s.locName || s.name} ({s.locCode})</option>
                  ))}
                </select>
              </div>
              {scope && <span className="text-xs text-[#6B7280] pb-2">{hasOverride ? "This store has its own settings." : "This store uses the default. Saving creates its own settings."}</span>}
              <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-[#111827] pb-2 cursor-pointer">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4 accent-[#1C1F26]" />
                Loyalty switched on
              </label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {FIELDS.map(([k, label, hint]) => (
                <div key={k}>
                  <label className={ui.label}>{label}</label>
                  <input type="number" min="0" step="any" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={ui.input} />
                  <p className="text-[10px] text-[#9CA3AF] mt-0.5">{hint}</p>
                </div>
              ))}
            </div>

            <div className="text-xs bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-[#374151]">
              <b>Example:</b> 1 point = ₹{vpp.toFixed(2)}. A ₹1,250 bill for a customer with 900 points{" "}
              {example.canRedeem
                ? <>can use up to <b>{example.maxPts}</b> points (₹{(example.maxPts * vpp).toFixed(2)}), pays ₹{example.paid.toFixed(2)} and earns <b>{example.earned}</b> points.</>
                : <>cannot redeem (below the minimum bill).</>}
            </div>

            <div className="flex justify-end gap-2.5">
              {scope && hasOverride && <button type="button" onClick={removeOverride} className={ui.btn}>Use default for this store</button>}
              <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving..." : "Save new version"}</button>
            </div>
          </form>

          <div className={`${ui.card} p-5 flex flex-wrap items-end gap-3`}>
            <div className="w-56">
              <label className={ui.label}>Store credit valid for (days)</label>
              <input type="number" min="0" step="1" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} className={ui.input} />
            </div>
            <p className="text-xs text-[#6B7280] pb-2 flex-1">0 = never expires. Applies to store credit issued from now on (all stores).</p>
            <button type="button" onClick={saveExpiry} disabled={expirySaving} className={ui.btnDark}>{expirySaving ? "Saving..." : "Save"}</button>
          </div>

          <section className={`${ui.card} overflow-x-auto`}>
            <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">History</p>
            <table className="min-w-full border-collapse mt-3">
              <thead><tr className={ui.theadRow}>
                <th className={ui.th}>Saved</th><th className={ui.th}>Applies to</th><th className={ui.th}>Earn</th>
                <th className={ui.th}>Redeem</th><th className={ui.th}>Limits</th><th className={ui.th}>By</th><th className="px-3 py-3 text-left">State</th>
              </tr></thead>
              <tbody className="divide-y divide-[#F3F4F6] text-xs">
                {(data?.history || []).length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-[#6B7280]">No settings saved yet — the built-in defaults apply (₹100 → 1 pt, 1 pt = ₹1, max 50%).</td></tr>}
                {(data?.history || []).map((r) => (
                  <tr key={r._id} className={r.active ? "" : "text-[#9CA3AF]"}>
                    <td className={`${ui.td} whitespace-nowrap`}>{formatDateTime(r.createdAt)}</td>
                    <td className={ui.td}>{storeName(r.locCode)}</td>
                    <td className={ui.td}>₹{r.earnAmount} → {r.earnPoints} pt{r.minInvoiceForEarning ? `, min ₹${r.minInvoiceForEarning}` : ""}</td>
                    <td className={ui.td}>{r.redeemPoints} pt = ₹{r.redeemAmount}</td>
                    <td className={ui.td}>max {r.maxRedeemPercent}%{r.minInvoiceForRedeem ? `, min bill ₹${r.minInvoiceForRedeem}` : ""}</td>
                    <td className={ui.td}>{r.updatedBy || "—"}</td>
                    <td className={ui.td}>{r.active ? (r.enabled === false ? "Current (switched off)" : "Current") : "Old version"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </>
  );
};

export default LoyaltySettings;
