import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Plus, Download, PackageOpen } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { StoreSelect, useStoreChoice, todayIST } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

// F19: repacking — source items turned into packs of a target item.
const Repacks = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const store = useStoreChoice();
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setError("");
      api("/repacks", { query: { ...store.query, search, fromDate, toDate } }).then((d) => active && setRows(d.repacks)).catch((e) => active && setError(e.message));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [store.query.locCode, search, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const csvData = useMemo(() => (rows || []).map((r) => ({
    Number: r.number, Date: r.date, Warehouse: r.warehouse, Sources: r.sources.map((s) => `${s.name} × ${s.qty}`).join("; "),
    "Packed item": r.target.name, Packs: r.target.packs, "Consumed cost": r.consumedCost, Charges: r.charges, "Total cost": r.totalCost, "Cost per pack": r.unitCost, Notes: r.notes || "",
  })), [rows]);

  return (
    <>
      <Header title="Repacking" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Repacking</h1>
              <p className={ui.sub}>Turn loose stock into packs. Source items leave stock and the packs are added, in one step.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <CSVLink data={csvData} filename={`repacks-${todayIST()}.csv`} className={`${ui.btn} ${csvData.length ? "" : "pointer-events-none opacity-50"}`}><Download size={14} /> Export CSV</CSVLink>
              <Link to="/inventory/repacks/new" className={ui.btnDark}><Plus size={14} /> New Repack</Link>
            </div>
          </div>
        </div>
        <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px]">
            <label className={ui.label}>Search</label>
            <Search size={14} className="absolute left-3 bottom-2.5 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number or item" className={`${ui.input} pl-9`} />
          </div>
          <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
          <div><label className={ui.label}>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
          <div><label className={ui.label}>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
        </div>
        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-x-auto`}>
            {error ? <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
              : !rows ? <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading...</p>
              : !rows.length ? (
                <div className="px-8 py-16 text-center flex flex-col items-center"><PackageOpen size={28} className="text-[#1C1F26] mb-2" /><p className="text-xs text-[#6B7280]">No repacks yet.</p></div>
              ) : (
                <table className="min-w-full border-collapse">
                  <thead><tr className={ui.theadRow}>
                    <th className={ui.th}>Number</th><th className={ui.th}>Date</th><th className={ui.th}>Warehouse</th><th className={ui.th}>From</th><th className={ui.th}>Packed into</th>
                    <th className={ui.thRight}>Packs</th><th className={ui.thRight}>Total cost</th><th className="px-3 py-3 text-right whitespace-nowrap">Cost / pack</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs">
                    {rows.map((r) => (
                      <tr key={r._id} onClick={() => navigate(`/inventory/repacks/${r._id}`)} className="cursor-pointer hover:bg-[#F6FCE6]/60">
                        <td className={`${ui.td} font-semibold`}>{r.number}</td><td className={`${ui.td} whitespace-nowrap`}>{formatDate(r.date)}</td><td className={ui.td}>{r.warehouse}</td>
                        <td className={`${ui.td} max-w-[280px] truncate`} title={r.sources.map((s) => `${s.name} × ${s.qty}`).join(", ")}>{r.sources.map((s) => `${s.name} × ${s.qty}`).join(", ")}</td>
                        <td className={`${ui.td} font-semibold`}>{r.target.name}</td>
                        <td className={`${ui.td} text-right tabular-nums`}>{r.target.packs}</td>
                        <td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(r.totalCost)}</td>
                        <td className={`${ui.td} text-right tabular-nums font-bold`}>{formatCurrency(r.unitCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>
        </div>
      </div>
    </>
  );
};

export default Repacks;
