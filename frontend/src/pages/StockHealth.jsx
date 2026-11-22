import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Search } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, todayIST, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, isAdminUser, ui } from "../utils/retailApi";

const TABS = [
  { key: "dead", label: "Dead stock" },
  { key: "overstock", label: "Overstock" },
  { key: "abc", label: "ABC analysis" },
];
// Ordinal blue steps (A darkest) — validated one-hue ramp, light end ≥ 2:1 on white
const ABC_COLOR = { A: "#104281", B: "#2a78d6", C: "#86b6ef" };
const DAY_CHOICES = [30, 60, 90, 180];
const yearAgo = () => { const d = new Date(Date.now() - 364 * 86400000); return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); };
const itemLabel = (r) => (r.groupName ? `${r.groupName} · ${r.name}` : r.name);
const R = ({ children, bold, className = "" }) => <td className={`${ui.td} text-right tabular-nums ${bold ? "font-bold" : ""} ${className}`}>{children}</td>;

/** Inline max-stock editor (admins). Saves on Enter or when the field loses focus. */
const MaxStockInput = ({ row, onSaved }) => {
  const [v, setV] = useState(row.maxStock ?? "");
  const [state, setState] = useState("");
  useEffect(() => setV(row.maxStock ?? ""), [row.maxStock]);
  const save = async () => {
    const next = v === "" ? null : Number(v);
    if ((row.maxStock ?? null) === next) return;
    setState("saving");
    try {
      await api(`/stock-health/items/${row.id}`, { method: "PATCH", body: { kind: row.kind, groupId: row.groupId, maxStock: next } });
      setState("saved");
      onSaved();
    } catch (e) { setState(e.message); }
  };
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <input type="number" min="0" value={v} onChange={(e) => { setV(e.target.value); setState(""); }} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="—" className={`${ui.input} w-20 text-right h-8`} aria-label={`Max stock for ${row.name}`} />
      {state === "saving" ? <span className="text-[10px] text-[#6B7280]">…</span> : state && state !== "saved" ? <span className="text-[10px] text-red-600" title={state}>!</span> : null}
    </span>
  );
};

// F14: dead stock, overstock (max stock per item) and ABC analysis.
const StockHealth = () => {
  const isSidebarOpen = useSidebar();
  const admin = isAdminUser();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab")) || TABS[0];
  const store = useStoreChoice();
  const [days, setDays] = useState(90);
  const [customDays, setCustomDays] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [fromDate, setFromDate] = useState(yearAgo());
  const [toDate, setToDate] = useState(todayIST());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: () => `Stock health - ${tab.label}`, pageStyle: PRINT_PAGE_STYLE });
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const effectiveDays = days === "custom" ? Number(customDays) || 0 : days;
  useEffect(() => {
    if (tab.key === "dead" && !(effectiveDays >= 1)) return undefined;
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      const q = { ...store.query };
      const req = tab.key === "dead" ? api("/stock-health/dead", { query: { ...q, days: effectiveDays, search } })
        : tab.key === "overstock" ? api("/stock-health/overstock", { query: { ...q, search, all: showAll ? "1" : "" } })
        : api("/stock-health/abc", { query: { ...q, fromDate, toDate } });
      req.then((d) => active && setData({ ...d, tab: tab.key }))
        .catch((e) => { if (active) { setError(e.message); setData(null); } })
        .finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [tab.key, store.query.locCode, effectiveDays, search, showAll, fromDate, toDate, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = data?.tab === tab.key ? data : null;
  const rows = useMemo(() => current?.rows || [], [current]);

  const setOverride = async (row, value) => {
    try {
      await api(`/stock-health/items/${row.id}`, { method: "PATCH", body: { kind: row.kind, groupId: row.groupId, abcOverride: value } });
      reload();
    } catch (e) { window.alert(e.message); }
  };

  const csvData = useMemo(() => {
    if (!current) return [];
    if (tab.key === "dead") return rows.map((r) => ({ Item: itemLabel(r), SKU: r.sku, Category: r.category, Stock: r.stock, "Cost price": r.cost, "Stock value": r.value, "Last sale": r.lastSaleDate ? formatDate(r.lastSaleDate) : "Never", "Days since last sale": r.daysSinceLastSale ?? "" }));
    if (tab.key === "overstock") return rows.map((r) => ({ Item: itemLabel(r), SKU: r.sku, Stock: r.stock, "Max stock": r.maxStock ?? "", Excess: r.excess, "Excess value": r.excessValue, "Stock value": r.value }));
    return rows.map((r) => ({ Rank: r.rank, Item: itemLabel(r), SKU: r.sku, "Sales value": r.salesValue, "Share %": r.share, "Cumulative %": r.cumulative, "Computed class": r.computedClass, Override: r.abcOverride || "", Class: r.abcClass, Stock: r.stock }));
  }, [current, rows, tab.key]);

  const printLines = [`Store: ${current?.store || store.label}`,
    tab.key === "dead" && `No sale in the last ${effectiveDays} days`, tab.key === "abc" && `Sales ${formatDate(fromDate)} – ${formatDate(toDate)}`];
  const t = current?.totals;

  return (
    <>
      <Header title="Stock Health" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Stock Health</h1>
              <p className={ui.sub}>Stock that is not selling, stock above its maximum, and items ranked by sales value. Stock value = stock on hand × cost price.</p>
            </div>
            <ReportActions csvData={csvData} csvName={`stock-${tab.key}`} onPrint={() => print()} disabled={!rows.length} />
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {TABS.map((x) => (
              <button key={x.key} type="button" onClick={() => setParams({ tab: x.key }, { replace: true })}
                className={`h-8 px-3.5 text-xs font-bold uppercase tracking-wider border ${x.key === tab.key ? "bg-[#1C1F26] text-white border-[#1C1F26]" : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F3F4F6]"}`}>{x.label}</button>
            ))}
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div><label className={ui.label}>Store / warehouse</label><StoreSelect store={store} /></div>
          {tab.key !== "abc" && (
            <div className="relative min-w-[200px]">
              <label className={ui.label}>Item</label>
              <Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or SKU" className={`${ui.input} pl-9`} />
            </div>
          )}
          {tab.key === "dead" && (
            <>
              <div>
                <label className={ui.label}>No sale in the last</label>
                <select value={days} onChange={(e) => setDays(e.target.value === "custom" ? "custom" : Number(e.target.value))} className={`${ui.input} w-32`}>
                  {DAY_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
                  <option value="custom">Custom…</option>
                </select>
              </div>
              {days === "custom" && <div><label className={ui.label}>Days</label><input type="number" min="1" max="3650" value={customDays} onChange={(e) => setCustomDays(e.target.value)} className={`${ui.input} w-24`} /></div>}
            </>
          )}
          {tab.key === "overstock" && (
            <label className="inline-flex h-9 items-center gap-2 text-xs font-semibold text-[#374151]">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all items{admin ? " (to set max stock)" : ""}
            </label>
          )}
          {tab.key === "abc" && (
            <>
              <div><label className={ui.label}>Sales from</label><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
              <div><label className={ui.label}>To</label><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
            </>
          )}
        </div>

        <div className="px-6 pb-8 pt-2">
          <div ref={printRef} className="space-y-5">
            <PrintHeader title={`Stock health — ${tab.label}`} lines={printLines} />

            {tab.key === "abc" && current && (
              <section className={`${ui.card} print:shadow-none p-4 flex flex-wrap items-center gap-8`}>
                <div className="relative w-[220px] h-[220px]" role="img" aria-label={`Sales value share: ${current.summary.map((s) => `${s.abcClass} ${s.share}%`).join(", ")}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={current.summary.filter((s) => s.value > 0)} dataKey="value" nameKey="abcClass" innerRadius={62} outerRadius={96} stroke="#ffffff" strokeWidth={2}
                        isAnimationActive={false} label={false} labelLine={false}>
                        {current.summary.filter((s) => s.value > 0).map((s) => <Cell key={s.abcClass} fill={ABC_COLOR[s.abcClass]} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [formatCurrency(value), `Class ${name}`]} contentStyle={{ fontSize: 12, borderRadius: 0, borderColor: "#E5E7EB", color: "#111827" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-extrabold text-[#111827] tabular-nums">{(current.summary.find((s) => s.abcClass === "A")?.share ?? 0).toFixed(0)}%</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">of sales in A</span>
                  </div>
                </div>
                <table className="text-xs">
                  <thead><tr className="text-left text-[#6B7280] uppercase tracking-wide"><th className="py-1 pr-6">Class</th><th className="py-1 pr-6 text-right">Items</th><th className="py-1 pr-6 text-right">Sales value</th><th className="py-1 text-right">Share</th></tr></thead>
                  <tbody>
                    {current.summary.map((s) => (
                      <tr key={s.abcClass} className="border-t border-[#F3F4F6]">
                        <td className="py-1.5 pr-6 font-bold text-[#111827]"><span className="inline-block w-2.5 h-2.5 mr-2 align-middle" style={{ background: ABC_COLOR[s.abcClass] }} />{s.abcClass}</td>
                        <td className="py-1.5 pr-6 text-right tabular-nums">{s.items}</td>
                        <td className="py-1.5 pr-6 text-right tabular-nums">{formatCurrency(s.value)}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.share.toFixed(1)}%</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#E5E7EB] font-bold"><td className="py-1.5 pr-6">Total</td><td className="py-1.5 pr-6 text-right">{rows.length}</td><td className="py-1.5 pr-6 text-right">{formatCurrency(current.total)}</td><td className="py-1.5 text-right">100%</td></tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-[#6B7280] max-w-xs leading-5">Items are ranked by sales value (taxable, net of returns). Running share up to 80% is A, up to 95% B, the rest C; items with no sales are C. A manual class replaces the computed one.</p>
              </section>
            )}

            <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
              {loading && !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
                : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
                : tab.key === "dead" && !(effectiveDays >= 1) ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Enter the number of days.</p>
                : !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">{tab.key === "dead" ? "No dead stock — every item in stock sold within this period." : tab.key === "overstock" ? (current?.itemsWithLimit ? "No item is above its max stock." : "No item has a max stock yet. Tick “Show all items” to set limits.") : "No sales or stock in this period."}</p>
                : tab.key === "dead" ? (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Item</th><th className={ui.th}>SKU</th><th className={ui.th}>Category</th><th className={ui.thRight}>Stock</th><th className={ui.thRight}>Cost price</th>
                      <th className={ui.thRight}>Stock value</th><th className={ui.th}>Last sale</th><th className="px-3 py-3 text-right whitespace-nowrap">Days since</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <td className={`${ui.td} font-semibold`}>{itemLabel(r)}</td><td className={ui.td}>{r.sku || "—"}</td><td className={ui.td}>{r.category || "—"}</td>
                          <R>{r.stock}</R><R>{formatCurrency(r.cost)}</R><R bold>{formatCurrency(r.value)}</R>
                          <td className={`${ui.td} whitespace-nowrap`}>{r.lastSaleDate ? formatDate(r.lastSaleDate) : <span className="text-[#B91C1C] font-semibold">Never sold</span>}</td>
                          <R>{r.daysSinceLastSale ?? "—"}</R>
                        </tr>
                      ))}
                      {t && <tr className="bg-[#F3F4F6] font-bold"><td className={ui.td} colSpan={3}>Total ({t.items} items)</td><R>{t.qty}</R><td className={ui.td} /><R>{formatCurrency(t.value)}</R><td className={ui.td} colSpan={2} /></tr>}
                    </tbody>
                  </table>
                ) : tab.key === "overstock" ? (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Item</th><th className={ui.th}>SKU</th><th className={ui.thRight}>Stock</th><th className={ui.thRight}>Max stock</th>
                      <th className={ui.thRight}>Excess</th><th className={ui.thRight}>Excess value</th><th className="px-3 py-3 text-right whitespace-nowrap">Stock value</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <td className={`${ui.td} font-semibold`}>{itemLabel(r)}</td><td className={ui.td}>{r.sku || "—"}</td><R>{r.stock}</R>
                          <td className={`${ui.td} text-right`}>{admin ? <MaxStockInput row={r} onSaved={reload} /> : (r.maxStock ?? "—")}</td>
                          <R className={r.excess > 0 ? "text-[#B91C1C]" : ""}>{r.excess || "—"}</R><R bold>{r.excessValue ? formatCurrency(r.excessValue) : "—"}</R><R>{formatCurrency(r.value)}</R>
                        </tr>
                      ))}
                      {t && <tr className="bg-[#F3F4F6] font-bold"><td className={ui.td} colSpan={2}>Total ({t.items} items)</td><R>{t.qty}</R><td className={ui.td} /><R>{t.excess}</R><R>{formatCurrency(t.excessValue)}</R><R>{formatCurrency(t.value)}</R></tr>}
                    </tbody>
                  </table>
                ) : (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.thRight}>#</th><th className={ui.th}>Item</th><th className={ui.th}>SKU</th><th className={ui.thRight}>Sales value</th><th className={ui.thRight}>Share</th>
                      <th className={ui.thRight}>Cumulative</th><th className={ui.th}>Computed</th><th className={ui.th}>Manual class</th><th className={ui.th}>Class</th><th className="px-3 py-3 text-right whitespace-nowrap">Stock</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <R>{r.rank}</R><td className={`${ui.td} font-semibold`}>{itemLabel(r)}</td><td className={ui.td}>{r.sku || "—"}</td>
                          <R bold>{formatCurrency(r.salesValue)}</R><R>{r.share.toFixed(1)}%</R><R>{r.cumulative.toFixed(1)}%</R>
                          <td className={ui.td}>{r.computedClass}</td>
                          <td className={ui.td}>
                            {admin && r.id ? (
                              <select value={r.abcOverride || ""} onChange={(e) => setOverride(r, e.target.value)} className={`${ui.input} w-24 h-8`} aria-label={`Manual ABC class for ${r.name}`}>
                                <option value="">Computed</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
                              </select>
                            ) : (r.abcOverride || "—")}
                          </td>
                          <td className={ui.td}><span className="inline-flex items-center gap-1.5 font-bold text-[#111827]"><span className="inline-block w-2.5 h-2.5" style={{ background: ABC_COLOR[r.abcClass] }} />{r.abcClass}</span></td>
                          <R>{r.stock}</R>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default StockHealth;
