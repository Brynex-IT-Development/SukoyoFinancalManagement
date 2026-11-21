import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, todayIST, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const STATUS_STYLE = {
  Profit: "bg-[#DCFCE7] text-[#15803d] border-[#BBF7D0]",
  Loss: "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  "Break even": "bg-[#F3F4F6] text-[#374151] border-[#E5E7EB]",
};
const COST_NOTE = { fallback: "current cost (no snapshot)", none: "no cost" };

// F12: profit on each sale invoice — selling (taxable value after discounts) − cost.
const BillWiseProfit = () => {
  const isSidebarOpen = useSidebar();
  const store = useStoreChoice();
  const [fromDate, setFromDate] = useState(`${todayIST().slice(0, 8)}01`);
  const [toDate, setToDate] = useState(todayIST());
  const [salesperson, setSalesperson] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({}); // id → detail | { error }
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: "Bill-wise profit", pageStyle: PRINT_PAGE_STYLE });

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      api("/profit-reports/bills", { query: { ...store.query, fromDate, toDate, salesperson, status, search } })
        .then((d) => active && setData(d))
        .catch((e) => { if (active) { setError(e.message); setData(null); } })
        .finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [store.query.locCode, fromDate, toDate, salesperson, status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!detail[id]) {
      try { const d = await api(`/profit-reports/bills/${id}`); setDetail((m) => ({ ...m, [id]: d })); }
      catch (e) { setDetail((m) => ({ ...m, [id]: { error: e.message } })); }
    }
  };

  const rows = useMemo(() => data?.rows || [], [data]);
  const t = data?.totals;
  const csvData = useMemo(() => {
    const out = rows.map((r) => ({
      Date: formatDate(r.date), Invoice: r.invoiceNumber, Customer: r.customer, Salesperson: r.salesperson, Store: r.store, Items: r.items, Qty: r.qty,
      Selling: r.selling, Cost: r.cost, Profit: r.profit, "Margin %": r.marginPct, Status: r.status,
      Note: [r.rebuilt ? "counted as sold (later returned)" : "", r.fallbackLines ? `${r.fallbackLines} line(s) at current cost` : ""].filter(Boolean).join("; "),
    }));
    if (t) out.push({ Date: "TOTAL", Invoice: `${t.invoices} invoices`, Items: t.items, Qty: t.qty, Selling: t.selling, Cost: t.cost, Profit: t.profit, "Margin %": t.marginPct });
    return out;
  }, [rows, t]);

  const printLines = [`Store: ${data?.store || store.label}`, `Period: ${formatDate(fromDate)} – ${formatDate(toDate)}`, salesperson && `Salesperson: ${salesperson}`, status && `Status: ${status}`];

  return (
    <>
      <Header title="Bill-wise Profit" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Bill-wise Profit</h1>
              <p className={ui.sub}>Each sale invoice as sold: selling = taxable value after discounts, cost = quantity × cost price. Click an invoice for its lines.</p>
            </div>
            <ReportActions csvData={csvData} csvName="bill-wise-profit" onPrint={() => print()} disabled={!rows.length} />
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[200px]">
            <label className={ui.label}>Search</label>
            <Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice #, customer, phone" className={`${ui.input} pl-9`} />
          </div>
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div>
            <label className={ui.label}>Salesperson</label>
            <select value={salesperson} onChange={(e) => setSalesperson(e.target.value)} className={`${ui.input} w-40`}>
              <option value="">All</option>
              {(data?.salespeople || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={ui.label}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${ui.input} w-32`}>
              <option value="">All</option>
              {Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label className={ui.label}>From</label><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          {t && <span className="inline-flex h-9 items-center bg-[#F6FCE6] border border-[#ECF9C7] px-3 text-xs font-bold text-[#15171D]">{t.byStatus.Profit} profit · {t.byStatus.Loss} loss · {t.byStatus["Break even"]} break even</span>}
        </div>

        <div className="px-6 pb-8 pt-2">
          <div ref={printRef}>
            <PrintHeader title="Bill-wise profit" lines={printLines} />
            <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
              {loading && !data ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
                : error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
                : !rows.length ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">No sale invoices match these filters.</p>
                : (
                  <table className="min-w-full border-collapse">
                    <thead><tr className={ui.theadRow}>
                      <th className={ui.th}>Date</th><th className={ui.th}>Invoice #</th><th className={ui.th}>Customer</th><th className={ui.th}>Salesperson</th><th className={ui.th}>Store</th>
                      <th className={ui.thRight}>Items</th><th className={ui.thRight}>Qty</th><th className={ui.thRight}>Selling</th><th className={ui.thRight}>Cost</th>
                      <th className={ui.thRight}>Profit</th><th className={ui.thRight}>Margin</th><th className="px-3 py-3 text-left">Status</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[#F3F4F6] text-xs">
                      {rows.map((r) => {
                        const d = detail[r._id];
                        return (
                          <Fragment key={r._id}>
                            <tr onClick={() => toggle(r._id)} className={`cursor-pointer hover:bg-[#F6FCE6]/60 ${openId === r._id ? "bg-[#F6FCE6]" : ""}`}>
                              <td className={`${ui.td} whitespace-nowrap`}>
                                <span className="inline-flex items-center gap-1 print:hidden">{openId === r._id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span> {formatDate(r.date)}
                              </td>
                              <td className={`${ui.td} font-semibold whitespace-nowrap`}>
                                <Link to={`/sales/invoices/${r._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.invoiceNumber}</Link>
                                {r.returnStatus !== "none" && <span className="ml-1.5 text-[10px] font-bold uppercase text-[#92400E]" title="Later returned; counted here as sold">{r.returnStatus === "full" ? "returned" : "part returned"}</span>}
                              </td>
                              <td className={ui.td}>{r.customer}</td>
                              <td className={ui.td}>{r.salesperson || "—"}</td>
                              <td className={ui.td}>{r.store || "—"}</td>
                              <td className={`${ui.td} text-right`}>{r.items}</td>
                              <td className={`${ui.td} text-right`}>{r.qty}</td>
                              <td className={`${ui.td} text-right`}>{formatCurrency(r.selling)}</td>
                              <td className={`${ui.td} text-right`} title={r.fallbackLines ? `${r.fallbackLines} line(s) at the item's current cost` : undefined}>{formatCurrency(r.cost)}{r.fallbackLines > 0 && <span className="text-[#92400E]">*</span>}</td>
                              <td className={`${ui.td} text-right font-bold ${r.profit < 0 ? "text-[#B91C1C]" : ""}`}>{formatCurrency(r.profit)}</td>
                              <td className={`${ui.td} text-right`}>{r.marginPct.toFixed(1)}%</td>
                              <td className={ui.td}><span className={`${ui.badge} ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                            </tr>
                            {openId === r._id && (
                              <tr className="bg-[#FAFAFA]">
                                <td colSpan={12} className="px-6 py-3">
                                  {!d ? <p className="text-[#6B7280]">Loading lines…</p> : d.error ? <p className="text-red-600">{d.error}</p> : (
                                    <table className="min-w-full text-[11px]">
                                      <thead><tr className="text-left text-[#6B7280] uppercase tracking-wide">
                                        <th className="py-1 pr-3">Item</th><th className="py-1 pr-3 text-right">Qty</th><th className="py-1 pr-3 text-right">Rate (incl. tax)</th>
                                        <th className="py-1 pr-3 text-right">Discount share</th><th className="py-1 pr-3 text-right">Selling (ex-tax)</th><th className="py-1 pr-3 text-right">Unit cost</th>
                                        <th className="py-1 pr-3 text-right">Cost</th><th className="py-1 pr-3 text-right">Profit</th><th className="py-1 text-right">Margin</th>
                                      </tr></thead>
                                      <tbody>
                                        {d.lines.map((l, i) => (
                                          <tr key={i} className="border-t border-[#EEE]">
                                            <td className="py-1 pr-3">{l.name}{l.sku ? <span className="text-[#9CA3AF]"> · {l.sku}</span> : ""}{COST_NOTE[l.costSource] && <span className="text-[#92400E]"> · {COST_NOTE[l.costSource]}</span>}</td>
                                            <td className="py-1 pr-3 text-right">{l.qty}</td>
                                            <td className="py-1 pr-3 text-right">{formatCurrency(l.unitRate)}</td>
                                            <td className="py-1 pr-3 text-right">{l.discount ? formatCurrency(l.discount) : "—"}</td>
                                            <td className="py-1 pr-3 text-right">{formatCurrency(l.taxable)}</td>
                                            <td className="py-1 pr-3 text-right">{formatCurrency(l.unitCost)}</td>
                                            <td className="py-1 pr-3 text-right">{formatCurrency(l.cost)}</td>
                                            <td className={`py-1 pr-3 text-right font-semibold ${l.profit < 0 ? "text-[#B91C1C]" : ""}`}>{formatCurrency(l.profit)}</td>
                                            <td className="py-1 text-right">{l.marginPct.toFixed(1)}%</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                  {d?.rebuilt && <p className="mt-2 text-[#92400E]">Counted as sold. Returned later on {d.returns.map((x) => x.invoiceNumber).join(", ")} (subtracted in the P&amp;L in the month of the return).</p>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      {t && (
                        <tr className="bg-[#F3F4F6] font-bold">
                          <td className={ui.td} colSpan={5}>Total ({t.invoices} invoices)</td>
                          <td className={`${ui.td} text-right`}>{t.items}</td>
                          <td className={`${ui.td} text-right`}>{t.qty}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.selling)}</td>
                          <td className={`${ui.td} text-right`}>{formatCurrency(t.cost)}</td>
                          <td className={`${ui.td} text-right ${t.profit < 0 ? "text-[#B91C1C]" : ""}`}>{formatCurrency(t.profit)}</td>
                          <td className={`${ui.td} text-right`}>{t.marginPct.toFixed(1)}%</td>
                          <td className={ui.td} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
            </section>
            {rows.some((r) => r.fallbackLines) && <p className="mt-2 text-[11px] text-[#92400E]">* Some lines were saved before cost snapshots existed; their cost uses the item&apos;s current cost price.</p>}
          </div>
        </div>
      </div>
    </>
  );
};

export default BillWiseProfit;
