import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Send, Search, X, ShoppingCart, ArrowRight, FileText, FilePen, Truck, PackageCheck, ChevronRight, Plus } from "lucide-react";
import * as ui from "../components/docDetailStyles";
import Header from "../components/Header";
import baseUrl from "../api/api";
import { mapLocNameToWarehouse as mapWarehouse } from "../utils/warehouseMapping";
import useSidebar from "../hooks/useSidebar";

const currency = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);

const fallbackLocations = [
  { locName: "Warehouse", locCode: "858" },
  { locName: "MG Road", locCode: "718" },
];

const PurchaseOrders = () => {
  const isSidebarOpen = useSidebar();
  const location = useLocation();
  const isNewOrder = location.pathname === "/purchase/orders/new";
  const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchOrderNumber, setSearchOrderNumber] = useState("");
  const [sending, setSending] = useState({});
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    if (isNewOrder) return;
    const fetchOrders = async () => {
      setLoading(true);
      try {
        const userStr = localStorage.getItem("rootfinuser");
        const user = userStr ? JSON.parse(userStr) : null;
        const userId = user?.email || null;
        const userPower = user?.power || "";

        let searchParam;
        if (searchOrderNumber) {
          searchParam = `orderNumber=${encodeURIComponent(searchOrderNumber)}`;
        } else if (userId) {
          const params = new URLSearchParams({ userId });
          if (userPower) params.append("userPower", userPower);
          if (user?.locCode) params.append("locCode", user.locCode);
          let userLocName = "";
          if (user?.locCode) {
            const loc = fallbackLocations.find(l => l.locCode === user.locCode || l.locCode === String(user.locCode));
            if (loc) userLocName = loc.locName;
          }
          if (!userLocName) userLocName = user?.username || user?.locName || "";
          const userWarehouse = mapWarehouse(userLocName);
          if (userWarehouse) params.append("warehouse", userWarehouse);
          searchParam = params.toString();
        } else {
          searchParam = "";
        }

        const url = `${API_URL}/api/purchase/orders${searchParam ? `?${searchParam}` : ""}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch purchase orders");
        const data = await response.json();
        setOrders(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error loading purchase orders:", error);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
    const handleOrderSaved = () => fetchOrders();
    window.addEventListener("orderSaved", handleOrderSaved);
    return () => window.removeEventListener("orderSaved", handleOrderSaved);
  }, [isNewOrder, API_URL, searchOrderNumber]);

  const handleSendOrder = async (orderId) => {
    setSending(prev => ({ ...prev, [orderId]: true }));
    try {
      const response = await fetch(`${API_URL}/api/purchase/orders/${orderId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to send purchase order");
      }
      setOrders(prev => prev.map(order => order._id === orderId ? { ...order, status: "sent" } : order));
      alert("Purchase order sent successfully!");
    } catch (error) {
      alert("Failed to send purchase order: " + error.message);
    } finally {
      setSending(prev => ({ ...prev, [orderId]: false }));
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
    draft:     { label: "Draft",     chip: ui.chip.neutral },
    sent:      { label: "Sent",      chip: ui.chip.brand },
    received:  { label: "Received",  chip: ui.chip.success },
    cancelled: { label: "Cancelled", chip: ui.chip.danger },
  };
  const getStatusBadge = (status) => {
    const s = statusInfo[status] || statusInfo.draft;
    return <span className={s.chip}>{s.label}</span>;
  };

  // Counts + value
  const draftCount = orders.filter(o => (o.status || "draft") === "draft").length;
  const sentCount = orders.filter(o => o.status === "sent").length;
  const receivedCount = orders.filter(o => o.status === "received").length;
  const totalValue = orders.reduce((sum, o) => sum + (parseFloat(o.finalTotal) || 0), 0);

  const visibleOrders = statusFilter === "all"
    ? orders
    : orders.filter(o => (o.status || "draft") === statusFilter);

  const stats = [
    { key: "all",      label: "Total Orders", value: orders.length, sub: currency(totalValue), icon: FileText,     accent: "bg-[#15171D] text-[#C6F135]" },
    { key: "draft",    label: "Draft",        value: draftCount,    sub: "Not sent yet",       icon: FilePen,      accent: "bg-gray-100 text-gray-600" },
    { key: "sent",     label: "Sent",         value: sentCount,     sub: "Awaiting goods",     icon: Truck,        accent: "bg-[#F6FCE6] text-[#15171D]" },
    { key: "received", label: "Received",     value: receivedCount, sub: "Goods received",     icon: PackageCheck, accent: "bg-emerald-50 text-emerald-600" },
  ];

  return (
    <>
      <Header title="Purchase Orders" />
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className="p-4 sm:p-6 space-y-5">

          {/* ── Toolbar ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex items-center w-full sm:w-auto">
              <Search size={15} className="absolute left-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by order number..."
                value={searchOrderNumber}
                onChange={(e) => setSearchOrderNumber(e.target.value)}
                className="h-10 pl-10 pr-9 w-full sm:w-72 rounded-full border border-gray-200 bg-white text-sm text-[#15171D] placeholder:text-gray-400 outline-none transition focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30"
              />
              {searchOrderNumber && (
                <button onClick={() => setSearchOrderNumber("")} className="no-hover-anim absolute right-3 text-gray-400 hover:text-gray-600" title="Clear">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link to="/purchase/receives" className={`${ui.btnOutline} h-10 px-4 text-sm`}>
                <Truck size={15} /> In Transit Receives
              </Link>
              <Link to="/purchase/orders/new" className={`${ui.btnPrimary} h-10 px-5 text-sm`}>
                <Plus size={15} /> New Order
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#15171D] border-t-transparent" />
              <p className="text-sm font-medium text-gray-500">Loading orders...</p>
            </div>

          ) : orders.length === 0 ? (
            /* ── Empty State ── */
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm flex flex-col items-center justify-center py-16 px-6">
              <div className="w-16 h-16 rounded-2xl bg-[#15171D] flex items-center justify-center mb-5">
                <ShoppingCart size={28} className="text-[#C6F135]" />
              </div>
              <h2 className="text-lg font-extrabold tracking-tight text-[#15171D] mb-1.5">No purchase orders yet</h2>
              <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">
                Create, customize, and send professional purchase orders to your vendors.
              </p>
              <Link to="/purchase/orders/new" className={`${ui.btnPrimary} h-11 px-6 text-sm`}>
                <Plus size={15} /> Create Purchase Order
              </Link>

              <div className="mt-12 w-full max-w-3xl">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 text-center mb-4">Life cycle of a purchase order</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {["Raise Purchase Order", "Convert to Open", "Receive Goods", "Convert to Bill", "Record Payment"].map((step, i, arr) => (
                    <div key={step} className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#DEF39A] bg-[#F6FCE6] text-xs font-semibold text-[#15171D]">
                        <span className="grid place-items-center w-4 h-4 rounded-full bg-[#15171D] text-[9px] font-bold text-[#C6F135]">{i + 1}</span>
                        {step}
                      </span>
                      {i < arr.length - 1 && <ArrowRight size={13} className="text-gray-300" />}
                    </div>
                  ))}
                </div>
              </div>
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

              {/* ── Orders table ── */}
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <h2 className="text-[15px] font-bold tracking-tight text-[#15171D]">
                    {statusFilter === "all" ? "All orders" : `${statusInfo[statusFilter]?.label} orders`}
                    <span className="ml-2 text-sm font-medium text-gray-400">{visibleOrders.length}</span>
                  </h2>
                  {statusFilter !== "all" && (
                    <button onClick={() => setStatusFilter("all")} className={ui.btnLink}>
                      <X size={14} /> Clear filter
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        <th className={`${ui.th} text-center w-12`}>#</th>
                        <th className={`${ui.th} text-left`}>Date</th>
                        <th className={`${ui.th} text-left`}>Order #</th>
                        <th className={`${ui.th} text-left`}>Vendor</th>
                        <th className={`${ui.th} text-left`}>Reference #</th>
                        <th className={`${ui.th} text-left`}>Delivery Date</th>
                        <th className={`${ui.th} text-right`}>Total</th>
                        <th className={`${ui.th} text-left`}>Status</th>
                        <th className={`${ui.th} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOrders.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-sm text-gray-400">No orders with this status.</td>
                        </tr>
                      )}
                      {visibleOrders.map((order, index) => {
                        const oid = order._id || order.id;
                        return (
                          <tr
                            key={oid}
                            onClick={() => navigate(`/purchase/orders/${oid}`)}
                            className={`${ui.tr(index)} cursor-pointer hover:bg-[#F6FCE6]/60 transition-colors group`}
                          >
                            <td className="px-4 py-3.5 text-center text-xs font-medium text-gray-400">{index + 1}</td>
                            <td className="px-4 py-3.5 text-sm text-gray-600 whitespace-nowrap">{formatDate(order.date)}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <Link
                                to={`/purchase/orders/${oid}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm font-bold text-[#15171D] underline-offset-4 hover:underline"
                              >
                                {order.orderNumber}
                              </Link>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <span className="grid place-items-center w-7 h-7 rounded-full bg-[#15171D] text-[11px] font-bold text-[#C6F135] uppercase">
                                  {(order.vendorName || "?").trim().charAt(0)}
                                </span>
                                <span className="text-sm font-semibold text-[#15171D]">{order.vendorName || "—"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-sm text-gray-500 whitespace-nowrap">{order.referenceNumber || "—"}</td>
                            <td className="px-4 py-3.5 text-sm text-gray-500 whitespace-nowrap">{formatDate(order.deliveryDate)}</td>
                            <td className="px-4 py-3.5 text-sm font-bold text-[#15171D] text-right whitespace-nowrap">{currency(order.finalTotal || 0)}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap">{getStatusBadge(order.status || "draft")}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap text-right">
                              <div className="inline-flex items-center gap-2">
                                {order.status === "draft" && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleSendOrder(oid); }}
                                    disabled={sending[oid]}
                                    className={`${ui.btnLime} h-8`}
                                  >
                                    <Send size={12} />
                                    {sending[oid] ? "Sending..." : "Send"}
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

export default PurchaseOrders;
