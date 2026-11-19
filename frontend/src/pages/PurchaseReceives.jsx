import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Send, PackageCheck, Search, X, Boxes, FilePen, Truck, FileText, Plus, ChevronRight } from "lucide-react";
import * as ui from "../components/docDetailStyles";
import Header from "../components/Header";
import baseUrl from "../api/api";
import { mapLocNameToWarehouse as mapWarehouse } from "../utils/warehouseMapping";
import useSidebar from "../hooks/useSidebar";

const currency = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);

const PurchaseReceives = () => {
  const isSidebarOpen = useSidebar();
  const location = useLocation();
  const isNewReceive = location.pathname === "/purchase/receives/new";
  const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";

  const [receives, setReceives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState({});
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (isNewReceive) return;
    const fetchReceives = async () => {
      setLoading(true);
      try {
        const userStr = localStorage.getItem("rootfinuser");
        const user = userStr ? JSON.parse(userStr) : null;
        const userId = user?.email || null;
        const userPower = user?.power || "";

        if (!userId) { setReceives([]); setLoading(false); return; }

        const adminEmails = ['officerootments@gmail.com'];
        const isAdminEmail = adminEmails.some(e => userId.toLowerCase() === e.toLowerCase());
        const isAdmin = isAdminEmail ||
          (userPower && (userPower.toLowerCase() === 'admin' || userPower.toLowerCase() === 'super_admin')) ||
          (user?.locCode && (String(user.locCode) === '858' || String(user.locCode) === '103'));

        const params = new URLSearchParams({ userId });
        if (userPower) params.append("userPower", userPower);
        if (user?.locCode) params.append("locCode", user.locCode);

        if (!isAdmin) {
          const fallbackLocations = [
            { locName: "Warehouse", locCode: "858" },
            { locName: "MG Road", locCode: "718" },
          ];
          const loc = fallbackLocations.find(l => l.locCode === String(user?.locCode));
          const userWarehouse = mapWarehouse(loc?.locName || user?.locName || "");
          if (userWarehouse) params.append("warehouse", userWarehouse);
        }

        const response = await fetch(`${API_URL}/api/purchase/receives?${params.toString()}`);
        if (!response.ok) throw new Error("Failed to fetch purchase receives");
        const data = await response.json();
        setReceives(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error loading purchase receives:", error);
        setReceives([]);
      } finally {
        setLoading(false);
      }
    };

    fetchReceives();
    const handleReceiveSaved = () => fetchReceives();
    window.addEventListener("receiveSaved", handleReceiveSaved);
    return () => window.removeEventListener("receiveSaved", handleReceiveSaved);
  }, [isNewReceive, API_URL]);

  const handleSendReceive = async (receiveId) => {
    setSending(prev => ({ ...prev, [receiveId]: true }));
    try {
      const response = await fetch(`${API_URL}/api/purchase/receives/${receiveId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to send purchase receive");
      }
      setReceives(prev => prev.map(r => r._id === receiveId ? { ...r, status: "received" } : r));
      alert("Purchase receive sent successfully!");
    } catch (error) {
      alert("Failed to send purchase receive: " + error.message);
    } finally {
      setSending(prev => ({ ...prev, [receiveId]: false }));
    }
  };

  const formatDate = (date) => {
    if (!date) return "-";
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    } catch { return "-"; }
  };

  const statusInfo = {
    draft:              { label: "Draft",      chip: ui.chip.neutral },
    in_transit:         { label: "In Transit", chip: ui.chip.warning },
    partially_received: { label: "Partial",    chip: ui.chip.warning },
    received:           { label: "Received",   chip: ui.chip.success },
  };
  const getStatusBadge = (status) => {
    const s = statusInfo[status] || statusInfo.draft;
    return <span className={s.chip}>{s.label}</span>;
  };

  const getTotalReceived = (items) => {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (parseFloat(item.received) || 0), 0);
  };

  const vendorOf = (r) => r.vendorName || r.vendorId?.displayName || r.vendorId?.companyName || "";
  const poOf = (r) => r.purchaseOrderNumber || r.purchaseOrderId?.orderNumber || "";

  const receivedCount = receives.filter(r => r.status === "received").length;
  const inTransitCount = receives.filter(r => r.status === "in_transit").length;
  const draftCount = receives.filter(r => (r.status || "draft") === "draft").length;
  const totalPieces = receives.reduce((sum, r) => sum + getTotalReceived(r.items), 0);

  const term = search.trim().toLowerCase();
  const visibleReceives = receives.filter((r) => {
    if (statusFilter !== "all" && (r.status || "received") !== statusFilter) return false;
    if (!term) return true;
    return [r.receiveNumber, poOf(r), vendorOf(r)].some((v) => String(v || "").toLowerCase().includes(term));
  });

  const stats = [
    { key: "all",        label: "Total Receives", value: receives.length, sub: `${totalPieces} pieces received`, icon: Boxes,        accent: "bg-[#15171D] text-[#C6F135]" },
    { key: "draft",      label: "Draft",          value: draftCount,      sub: "Not confirmed",                 icon: FilePen,      accent: "bg-gray-100 text-gray-600" },
    { key: "in_transit", label: "In Transit",     value: inTransitCount,  sub: "On the way",                    icon: Truck,        accent: "bg-amber-50 text-amber-600" },
    { key: "received",   label: "Received",       value: receivedCount,   sub: "Added to stock",                icon: PackageCheck, accent: "bg-emerald-50 text-emerald-600" },
  ];

  return (
    <>
      <Header title="Purchase Receives" />
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className="p-4 sm:p-6 space-y-5">

          {/* ── Toolbar ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex items-center w-full sm:w-auto">
              <Search size={15} className="absolute left-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search receive #, PO # or vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-10 pr-9 w-full sm:w-80 rounded-full border border-gray-200 bg-white text-sm text-[#15171D] placeholder:text-gray-400 outline-none transition focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30"
              />
              {search && (
                <button onClick={() => setSearch("")} className="no-hover-anim absolute right-3 text-gray-400 hover:text-gray-600" title="Clear">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link to="/purchase/orders" className={`${ui.btnOutline} h-10 px-4 text-sm`}>
                <FileText size={15} /> Purchase Orders
              </Link>
              <Link to="/purchase/receives/new" className={`${ui.btnPrimary} h-10 px-5 text-sm`}>
                <Plus size={15} /> New Receive
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#15171D] border-t-transparent" />
              <p className="text-sm font-medium text-gray-500">Loading receives...</p>
            </div>

          ) : receives.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm flex flex-col items-center justify-center py-16 px-6">
              <div className="w-16 h-16 rounded-2xl bg-[#15171D] flex items-center justify-center mb-5">
                <PackageCheck size={28} className="text-[#C6F135]" />
              </div>
              <h2 className="text-lg font-extrabold tracking-tight text-[#15171D] mb-1.5">No purchase receives yet</h2>
              <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">
                Log items received from your vendors to keep inventory accurate.
              </p>
              <Link to="/purchase/receives/new" className={`${ui.btnPrimary} h-11 px-6 text-sm`}>
                <Plus size={15} /> Receive Items
              </Link>
            </div>

          ) : (
            <>
              {/* ── Stat cards (click to filter) ── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map(({ key, label, value, sub, icon: Icon, accent }) => {
                  const active = statusFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusFilter(key)}
                      className={`no-hover-anim flex flex-col items-stretch justify-start text-left w-full bg-white rounded-2xl border p-5 shadow-sm transition ${
                        active ? "border-[#15171D] ring-2 ring-[#C6F135]/60" : "border-gray-200/80 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
                        <span className={`grid place-items-center w-9 h-9 rounded-xl ${accent}`}><Icon size={17} /></span>
                      </div>
                      <p className="mt-1 text-3xl font-extrabold tracking-tight text-[#15171D]">{value}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
                    </button>
                  );
                })}
              </div>

              {/* ── Receives table ── */}
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <h2 className="text-[15px] font-bold tracking-tight text-[#15171D]">
                    {statusFilter === "all" ? "All receives" : `${statusInfo[statusFilter]?.label} receives`}
                    <span className="ml-2 text-sm font-medium text-gray-400">{visibleReceives.length}</span>
                  </h2>
                  {(statusFilter !== "all" || search) && (
                    <button onClick={() => { setStatusFilter("all"); setSearch(""); }} className={ui.btnLink}>
                      <X size={14} /> Clear filters
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        <th className={`${ui.th} text-center w-12`}>#</th>
                        <th className={`${ui.th} text-left`}>Received Date</th>
                        <th className={`${ui.th} text-left`}>Receive #</th>
                        <th className={`${ui.th} text-left`}>Purchase Order #</th>
                        <th className={`${ui.th} text-left`}>Vendor</th>
                        <th className={`${ui.th} text-left`}>Items Received</th>
                        <th className={`${ui.th} text-left`}>Status</th>
                        <th className={`${ui.th} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReceives.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-sm text-gray-400">No receives match.</td>
                        </tr>
                      )}
                      {visibleReceives.map((receive, index) => {
                        const rid = receive._id || receive.id;
                        const vendor = vendorOf(receive);
                        return (
                          <tr
                            key={rid}
                            onClick={() => navigate(`/purchase/receives/${rid}`)}
                            className={`${ui.tr(index)} cursor-pointer hover:bg-[#F6FCE6]/60 transition-colors group`}
                          >
                            <td className="px-4 py-3.5 text-center text-xs font-medium text-gray-400">{index + 1}</td>
                            <td className="px-4 py-3.5 text-sm text-gray-600 whitespace-nowrap">{formatDate(receive.receivedDate)}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <Link
                                to={`/purchase/receives/${rid}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm font-bold text-[#15171D] underline-offset-4 hover:underline"
                              >
                                {receive.receiveNumber}
                              </Link>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {poOf(receive)
                                ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs font-semibold text-gray-700">{poOf(receive)}</span>
                                : <span className="text-sm text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <span className="grid place-items-center w-7 h-7 rounded-full bg-[#15171D] text-[11px] font-bold text-[#C6F135] uppercase">
                                  {(vendor || "?").trim().charAt(0)}
                                </span>
                                <span className="text-sm font-semibold text-[#15171D]">{vendor || "—"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#15171D]">
                                <Boxes size={14} className="text-gray-400" />
                                {getTotalReceived(receive.items)} <span className="font-normal text-gray-500">pcs</span>
                              </span>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">{getStatusBadge(receive.status || "received")}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap text-right">
                              <div className="inline-flex items-center gap-2">
                                {receive.status === "draft" && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleSendReceive(rid); }}
                                    disabled={sending[rid]}
                                    className={`${ui.btnLime} h-8`}
                                  >
                                    <Send size={12} />
                                    {sending[rid] ? "Sending..." : "Send"}
                                  </button>
                                )}
                                <ChevronRight size={16} className="text-gray-300 group-hover:text-[#15171D] transition" />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default PurchaseReceives;
