import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Download, Plus, Ticket } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { api, formatCurrency, formatDate, isAdminUser, ui, voucherState, voucherValueText, VOUCHER_STATE_STYLES } from "../utils/retailApi";

const scopeText = (s = {}) => {
  const parts = [...(s.brands || []), ...(s.categories || []), ...(s.subCategories || []), ...(s.itemLabels || [])];
  return parts.length ? parts.join(", ") : "All items";
};

const Vouchers = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api("/vouchers", { query: { search, status, kind } });
        if (active) setVouchers(data.vouchers || []);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [search, status, kind]);

  const csvData = useMemo(() => vouchers.map((v) => ({
    Code: v.code, Name: v.name || "", Type: v.kind, Value: voucherValueText(v), "Min Bill": v.minBillAmount || 0,
    Scope: scopeText(v.scope), Customer: v.customerName || "", Used: v.usedCount, "Usage Limit": v.usageLimitTotal || "",
    "Per Customer": v.usageLimitPerCustomer || "", Balance: v.kind === "value" ? v.balance : "", "Valid From": v.validFrom ? formatDate(v.validFrom) : "",
    "Valid To": v.validTo ? formatDate(v.validTo) : "", State: voucherState(v), Batch: v.batchRef || "", Store: v.locCode || "All",
  })), [vouchers]);

  return (
    <>
      <Header title="Vouchers" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Vouchers</h1>
              <p className={ui.sub}>Stored-value or discount vouchers, used from the billing Apply panel. One voucher per bill.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <CSVLink data={csvData} filename={`vouchers-${new Date().toISOString().slice(0, 10)}.csv`} className={ui.btn}><Download size={14} /> Export CSV</CSVLink>
              {isAdminUser() && <Link to="/offers/vouchers/new" className={ui.btnDark}><Plus size={14} /> New Voucher</Link>}
            </div>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, name or batch (VB-)..." className={`${ui.input} pl-9`} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${ui.input} w-36`}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Switched off</option>
            <option value="expired">Expired</option>
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${ui.input} w-40`}>
            <option value="">All types</option>
            <option value="discount">Discount</option>
            <option value="value">Stored value</option>
          </select>
          <span className="inline-flex items-center rounded-none bg-[#F6FCE6] border border-[#ECF9C7] px-3 py-1 text-xs font-bold text-[#15171D]">{vouchers.length} vouchers</span>
        </div>

        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-hidden`}>
            {loading ? (
              <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading vouchers...</p>
            ) : error ? (
              <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
            ) : vouchers.length === 0 ? (
              <div className="px-8 py-16 text-center flex flex-col items-center">
                <Ticket size={28} className="text-[#1C1F26] mb-2" />
                <p className="text-xs text-[#6B7280]">{search || status || kind ? "No vouchers match." : "No vouchers yet."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className={ui.theadRow}>
                      <th className={ui.th}>Code</th>
                      <th className={ui.th}>Value</th>
                      <th className={ui.th}>Applies to</th>
                      <th className={ui.thRight}>Used</th>
                      <th className={ui.thRight}>Balance</th>
                      <th className={ui.th}>Valid</th>
                      <th className="px-3 py-3 text-left whitespace-nowrap">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1F2937]">
                    {vouchers.map((v, i) => {
                      const st = voucherState(v);
                      return (
                        <tr key={v._id} onClick={() => navigate(`/offers/vouchers/${v._id}`)}
                          className={`${i % 2 ? "bg-[#F9FAFB]/40" : "bg-white"} hover:bg-[#F6FCE6]/60 cursor-pointer`}>
                          <td className={ui.td}><span className="font-mono font-semibold text-[#111827]">{v.code}</span>{v.name && <span className="block text-[11px] text-[#6B7280]">{v.name}</span>}</td>
                          <td className={ui.td}>{voucherValueText(v)}{v.minBillAmount ? <span className="block text-[11px] text-[#6B7280]">min bill ₹{v.minBillAmount}</span> : null}</td>
                          <td className={`${ui.td} max-w-[220px] truncate`} title={scopeText(v.scope)}>{scopeText(v.scope)}{v.customerName && <span className="block text-[11px] text-[#6B7280]">only {v.customerName}</span>}</td>
                          <td className={`${ui.td} text-right`}>{v.usedCount}{v.usageLimitTotal ? ` / ${v.usageLimitTotal}` : ""}</td>
                          <td className={`${ui.td} text-right`}>{v.kind === "value" ? formatCurrency(v.balance) : "—"}</td>
                          <td className={`${ui.td} whitespace-nowrap`}>{v.validFrom || v.validTo ? `${v.validFrom ? formatDate(v.validFrom) : "…"} – ${v.validTo ? formatDate(v.validTo) : "…"}` : "Always"}</td>
                          <td className={ui.td}><span className={`${ui.badge} ${VOUCHER_STATE_STYLES[st] || ""}`}>{st}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
};

export default Vouchers;
