import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CSVLink } from "react-csv";
import { Search, Plus, Download, Users } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { api, formatCurrency, formatDate, ui } from "../utils/retailApi";

const Customers = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api("/customers", { query: { search, status, limit: 1000 } });
        if (!active) return;
        setCustomers(data.customers || []);
        setTotal(data.total || 0);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250); // wait for typing to pause
    return () => { active = false; clearTimeout(t); };
  }, [search, status]);

  const toggleStatus = async (c) => {
    const next = c.status === "inactive" ? "active" : "inactive";
    setBusyId(c._id);
    try {
      const saved = await api(`/customers/${c._id}/status`, { method: "PATCH", body: { status: next } });
      setCustomers((list) => list.map((x) => (x._id === c._id ? saved : x)));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const csvData = useMemo(() => customers.map((c) => ({
    Name: c.name, Phone: c.phone, Email: c.email || "", City: c.city || "", State: c.state || "",
    GSTIN: c.gstin || "", "Loyalty Points": c.loyaltyPoints || 0, "Store Credit": c.storeCreditBalance || 0,
    Status: c.status, Store: c.locCode || "", Created: formatDate(c.createdAt),
  })), [customers]);

  return (
    <>
      <Header title="Customers" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Customers</h1>
              <p className={ui.sub}>Customers are created automatically when a bill is saved with a phone number.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <CSVLink data={csvData} filename={`customers-${new Date().toISOString().slice(0, 10)}.csv`} className={ui.btn}>
                <Download size={14} /> Export CSV
              </CSVLink>
              <Link to="/sales/customers/new" className={ui.btnDark}>
                <Plus size={14} /> New Customer
              </Link>
            </div>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone..." className={`${ui.input} pl-9`} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${ui.input} w-40`}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="inline-flex items-center rounded-none bg-[#F6FCE6] border border-[#ECF9C7] px-3 py-1 text-xs font-bold text-[#15171D]">
            {total} {total === 1 ? "customer" : "customers"}
          </span>
        </div>

        <div className="px-6 pb-8 pt-2">
          <section className={`${ui.card} overflow-hidden`}>
            {loading ? (
              <p className="px-8 py-16 text-center text-xs text-[#6B7280]">Loading customers...</p>
            ) : error ? (
              <p className="px-8 py-16 text-center text-xs font-semibold text-red-500">{error}</p>
            ) : customers.length === 0 ? (
              <div className="px-8 py-16 text-center flex flex-col items-center">
                <Users size={28} className="text-[#1C1F26] mb-2" />
                <p className="text-xs text-[#6B7280]">{search || status ? "No customers match your search." : "No customers yet."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className={ui.theadRow}>
                      <th className={ui.th}>Name</th>
                      <th className={ui.th}>Phone</th>
                      <th className={ui.th}>City</th>
                      <th className={ui.thRight}>Points</th>
                      <th className={ui.thRight}>Store Credit</th>
                      <th className={ui.th}>Store</th>
                      <th className={ui.th}>Since</th>
                      <th className="px-3 py-3 text-left whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1F2937]">
                    {customers.map((c, i) => (
                      <tr key={c._id} onClick={() => navigate(`/sales/customers/${c._id}`)}
                        className={`${i % 2 ? "bg-[#F9FAFB]/40" : "bg-white"} hover:bg-[#F6FCE6]/60 cursor-pointer`}>
                        <td className={`${ui.td} font-semibold text-[#111827]`}>{c.name}</td>
                        <td className={ui.td}>{c.phone}</td>
                        <td className={ui.td}>{c.city || "—"}</td>
                        <td className={`${ui.td} text-right font-semibold`}>{c.loyaltyPoints || 0}</td>
                        <td className={`${ui.td} text-right`}>{formatCurrency(c.storeCreditBalance)}</td>
                        <td className={ui.td}>{c.locCode || "—"}</td>
                        <td className={`${ui.td} whitespace-nowrap`}>{formatDate(c.createdAt)}</td>
                        <td className={ui.td} onClick={(e) => e.stopPropagation()}>
                          <button type="button" disabled={busyId === c._id} onClick={() => toggleStatus(c)}
                            title={c.status === "inactive" ? "Mark active" : "Mark inactive"}
                            className={`${ui.badge} cursor-pointer disabled:opacity-50 ${c.status === "inactive" ? "bg-[#F3F4F6] border-[#E5E7EB] text-[#6B7280]" : "bg-[#F6FCE6] border-[#DEF39A] text-[#15171D]"}`}>
                            {c.status === "inactive" ? "Inactive" : "Active"}
                          </button>
                        </td>
                      </tr>
                    ))}
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

export default Customers;
