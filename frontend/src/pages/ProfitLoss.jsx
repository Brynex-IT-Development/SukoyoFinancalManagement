import { useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { ChevronDown, ChevronRight } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, todayIST, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const GROUP_LABEL = { direct: "Direct expenses", indirect: "Indirect expenses", other: "Other expenses (not tagged direct/indirect)" };

/** Quick periods (IST): this month, last month, this financial year (April–March). */
const quickRange = (kind) => {
  const t = todayIST();
  const [y, m] = t.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  if (kind === "month") return [`${y}-${pad(m)}-01`, t];
  if (kind === "lastMonth") {
    const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
    const last = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
    return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${pad(last)}`];
  }
  const fy = m >= 4 ? y : y - 1;
  return [`${fy}-04-01`, t];
};

const Row = ({ label, value, bold, indent, negative, note, onToggle, open, className = "" }) => (
  <div className={`flex items-center justify-between gap-4 px-4 py-2 text-xs ${bold ? "font-bold text-[#111827] bg-[#F9FAFB]" : "text-[#374151]"} ${className}`}>
    <span className={`flex items-center gap-1.5 ${indent ? "pl-5" : ""}`}>
      {onToggle && (
        <button type="button" onClick={onToggle} className="text-[#6B7280] print:hidden" aria-label={open ? "Hide details" : "Show details"}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      )}
      {label}{note && <span className="font-normal text-[#6B7280]"> · {note}</span>}
    </span>
    <span className={`tabular-nums ${negative ? "text-[#B91C1C]" : ""}`}>{negative && value > 0 ? `(${formatCurrency(value)})` : formatCurrency(value)}</span>
  </div>
);

// F11: profit & loss for a period and store.
const ProfitLoss = () => {
  const isSidebarOpen = useSidebar();
  const store = useStoreChoice();
  const [[fromDate, toDate], setRange] = useState(() => quickRange("month"));
  const [data, setData] = useState(null);
  const [stock, setStock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: "Profit and loss", pageStyle: PRINT_PAGE_STYLE.replace("landscape", "portrait") });

  useEffect(() => {
    let active = true;
    const query = { ...store.query, fromDate, toDate };
    setLoading(true);
    setError("");
    setStock(null);
    api("/profit-reports/pnl", { query })
      .then((d) => active && setData(d))
      .catch((e) => { if (active) { setError(e.message); setData(null); } })
      .finally(() => active && setLoading(false));
    // Stock values are slower (the opening/closing figures replay stock movements), so they load separately
    api("/profit-reports/pnl/stock", { query }).then((d) => active && setStock(d)).catch(() => active && setStock({ failed: true }));
    return () => { active = false; };
  }, [store.query.locCode, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const csvData = useMemo(() => {
    if (!data) return [];
    const r = (Line, Amount) => ({ Line, Amount });
    return [
      r("Sales (taxable value)", data.salesTaxable), r("Less: returns", -data.returnsTaxable), r("Net sales", data.netSales),
      r("Cost of goods sold", data.costSold), r("Less: cost of returned goods", -data.costReturned), r("COGS", data.cogs),
      r("Gross profit", data.grossProfit), r("Gross margin %", data.grossMarginPct),
      ...data.incomeByCategory.map((c) => r(`Other income: ${c.category}`, c.amount)), r("Other income", data.otherIncome),
      ...data.expensesByCategory.map((c) => r(`Expense (${c.group}): ${c.category}`, c.amount)), r("Expenses", data.expenses),
      r("Net profit", data.netProfit),
      r("Purchases (bills)", data.purchases.bills), r("Less: vendor credits", -data.purchases.vendorCredits), r("Net purchases", data.purchases.net),
      r("Output tax", data.gst.outputTax), r("Input tax", data.gst.inputTax), r("Net GST payable", data.gst.netPayable),
      ...(stock && !stock.failed ? [r("Stock value (current)", stock.current), ...(stock.opening != null ? [r("Opening stock (Stock On Hand report)", stock.opening), r("Closing stock (Stock On Hand report)", stock.closing)] : [])] : []),
    ];
  }, [data, stock]);

  const period = `${formatDate(fromDate)} – ${formatDate(toDate)}`;

  return (
    <>
      <Header title="Profit & Loss" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Profit &amp; Loss</h1>
              <p className={ui.sub}>Sales and costs ex-tax, from invoices, bills and the daybook. Draft and cancelled documents are left out.</p>
            </div>
            <ReportActions csvData={csvData} csvName="profit-and-loss" onPrint={() => print()} disabled={!data} />
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div><label className={ui.label}>From</label><input type="date" value={fromDate} max={toDate} onChange={(e) => setRange([e.target.value, toDate])} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} min={fromDate} onChange={(e) => setRange([fromDate, e.target.value])} className={`${ui.input} w-36`} /></div>
          <div className="flex gap-1.5">
            <button type="button" className={ui.btn} onClick={() => setRange(quickRange("month"))}>This month</button>
            <button type="button" className={ui.btn} onClick={() => setRange(quickRange("lastMonth"))}>Last month</button>
            <button type="button" className={ui.btn} onClick={() => setRange(quickRange("fy"))}>This financial year</button>
          </div>
        </div>

        <div className="px-6 pb-8 pt-2">
          {loading && !data ? <p className={`${ui.card} px-8 py-16 text-center text-xs text-[#6B7280]`}>Loading...</p>
            : error ? <p className={`${ui.card} px-8 py-16 text-center text-xs font-semibold text-red-500`}>{error}</p>
            : data && (
              <div ref={printRef} className="max-w-4xl space-y-5">
                <PrintHeader title="Profit & loss" lines={[`Store: ${data.store}`, `Period: ${period}`]} />

                <section className={`${ui.card} print:shadow-none divide-y divide-[#F3F4F6]`}>
                  <p className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Profit &amp; loss · {period} · {data.store}</p>
                  <Row label="Sales (taxable value, after discounts)" value={data.salesTaxable} />
                  <Row label="Less: returns" value={data.returnsTaxable} negative indent />
                  <Row label="Net sales" value={data.netSales} bold />
                  <Row label="Cost of goods sold" value={data.costSold} />
                  <Row label="Less: cost of returned goods" value={data.costReturned} negative indent />
                  <Row label="COGS" value={data.cogs} bold />
                  <Row label="Gross profit" value={data.grossProfit} bold note={`margin ${data.grossMarginPct.toFixed(2)}%`} className={data.grossProfit < 0 ? "text-[#B91C1C]" : ""} />
                  <Row label="Other income" value={data.otherIncome} onToggle={data.incomeByCategory.length ? () => toggle("income") : null} open={open.income} />
                  {open.income && data.incomeByCategory.map((c) => <Row key={c.category} label={`${c.category} (${c.count})`} value={c.amount} indent />)}
                  <Row label="Expenses" value={data.expenses} negative onToggle={data.expensesByCategory.length ? () => toggle("expenses") : null} open={open.expenses} />
                  {open.expenses && ["direct", "indirect", "other"].filter((g) => data.expenseGroups[g] > 0).map((g) => (
                    <div key={g}>
                      <Row label={GROUP_LABEL[g]} value={data.expenseGroups[g]} indent className="font-semibold" />
                      {data.expensesByCategory.filter((c) => c.group === g).map((c) => <Row key={`${g}-${c.category}`} label={`${c.category} (${c.count})`} value={c.amount} indent className="pl-6" />)}
                    </div>
                  ))}
                  <div className={`flex items-center justify-between px-4 py-3 text-sm font-extrabold ${data.netProfit < 0 ? "bg-[#FEE2E2] text-[#B91C1C]" : "bg-[#DCFCE7] text-[#15803d]"}`}>
                    <span>Net {data.netProfit < 0 ? "loss" : "profit"}</span>
                    <span className="tabular-nums">{formatCurrency(Math.abs(data.netProfit))}</span>
                  </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <section className={`${ui.card} print:shadow-none divide-y divide-[#F3F4F6]`}>
                    <p className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Purchases &amp; GST (for information)</p>
                    <Row label="Purchases (bills)" value={data.purchases.bills} />
                    <Row label="Less: vendor credits" value={data.purchases.vendorCredits} negative indent />
                    <Row label="Net purchases" value={data.purchases.net} bold />
                    <Row label="Output tax (sales − returns)" value={data.gst.outputTax} />
                    <Row label="Input tax (bills − vendor credits)" value={data.gst.inputTax} />
                    <Row label={data.gst.netPayable < 0 ? "Input tax credit left over" : "Net GST payable"} value={Math.abs(data.gst.netPayable)} bold />
                  </section>
                  <section className={`${ui.card} print:shadow-none divide-y divide-[#F3F4F6]`}>
                    <p className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#1C1F26]">Stock value</p>
                    {!stock ? <p className="px-4 py-3 text-xs text-[#6B7280]">Loading stock values…</p>
                      : stock.failed ? <p className="px-4 py-3 text-xs text-red-600">Could not load stock values.</p>
                      : (
                        <>
                          <Row label="Current stock (stock on hand × cost price)" value={stock.current} bold />
                          {stock.opening != null ? (
                            <>
                              <Row label={`Opening stock on ${formatDate(fromDate)}`} value={stock.opening} />
                              <Row label={`Closing stock on ${formatDate(toDate)}`} value={stock.closing} />
                              <p className="px-4 py-2 text-[11px] text-[#6B7280]">Opening and closing come from the Stock On Hand report (stock rebuilt from receipts, sales and transfers) and are valued at today&apos;s cost price.</p>
                            </>
                          ) : <p className="px-4 py-2 text-[11px] text-[#6B7280]">Opening and closing stock are shown for one store or all stores.</p>}
                        </>
                      )}
                  </section>
                </div>

                <section className={`${ui.card} print:shadow-none px-4 py-3 text-[11px] leading-5 text-[#4B5563]`}>
                  <p className="font-bold uppercase tracking-wider text-[#1C1F26] mb-1">Notes</p>
                  <p>{data.notes.saleInvoices} sale invoice(s) and {data.notes.returnInvoices} return(s) in this period. Returns are subtracted in the period they were made.</p>
                  {data.notes.rebuiltSales > 0 && <p>{data.notes.rebuiltSales} sale(s) had been trimmed by the return screen and were counted as originally sold.</p>}
                  {data.notes.fallbackCostLines > 0 && <p className="text-[#92400E]">{data.notes.fallbackCostLines} line(s) were saved before cost snapshots existed; their cost uses the item&apos;s current cost price.</p>}
                  {data.notes.noCostLines > 0 && <p className="text-[#B91C1C]">{data.notes.noCostLines} line(s) have no cost at all (free-text or deleted items) and count as zero cost.</p>}
                  <p>Loyalty points, vouchers, gift cards and store credit are payments: they do not reduce sales. Vendor payments are not expenses (the bills are purchases). Gift card sales are not income.</p>
                </section>
              </div>
            )}
        </div>
      </div>
    </>
  );
};

export default ProfitLoss;
