import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { X, Edit, FileText, Check, ChevronRight, Send } from "lucide-react";
import AttachmentDisplay from "../components/AttachmentDisplay";
import baseUrl from "../api/api";
import useSidebar from "../hooks/useSidebar";
import * as ui from "../components/docDetailStyles";

const formatCurrency = (value) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
};

const formatDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const PurchaseOrderDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const navigate = useNavigate();
  const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";

  const [order, setOrder] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const pdfRef = useRef(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Get user info
        const userStr = localStorage.getItem("rootfinuser");
        const user = userStr ? JSON.parse(userStr) : null;
        // Use email as primary identifier (e.g., officerootments@gmail.com)
        const userId = user?.email || user?._id || user?.id || user?.locCode || null;
        const locCode = user?.locCode || "";

        if (!userId) {
          navigate("/purchase/orders");
          return;
        }

        // Fetch the specific purchase order
        const orderResponse = await fetch(`${API_URL}/api/purchase/orders/${id}`);
        if (!orderResponse.ok) {
          const errorText = await orderResponse.text();
          console.error("Error fetching purchase order:", orderResponse.status, errorText);
          throw new Error(`Purchase order not found: ${orderResponse.status}`);
        }
        const orderData = await orderResponse.json();
        console.log("Purchase order data loaded:", orderData);
        setOrder(orderData);

        // Fetch vendor if vendorId exists
        if (orderData.vendorId) {
          try {
            const vendorResponse = await fetch(`${API_URL}/api/purchase/vendors/${orderData.vendorId}`);
            if (vendorResponse.ok) {
              const vendorData = await vendorResponse.json();
              setVendor(vendorData);
            }
          } catch (error) {
            console.error("Error fetching vendor:", error);
          }
        }

        // Fetch all orders for sidebar
        const ordersResponse = await fetch(`${API_URL}/api/purchase/orders?userId=${userId}${locCode ? `&locCode=${locCode}` : ""}`);
        if (ordersResponse.ok) {
          const ordersData = await ordersResponse.json();
          setOrders(Array.isArray(ordersData) ? ordersData : []);
        }
      } catch (error) {
        console.error("Error loading purchase order:", error);
        navigate("/purchase/orders");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, navigate, API_URL]);

  // Send purchase order function
  const handleSendOrder = async () => {
    if (!order || order.status !== "draft") return;
    
    setSending(true);
    try {
      const response = await fetch(`${API_URL}/api/purchase/orders/${id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to send purchase order");
      }
      
      const data = await response.json();
      console.log("Purchase order sent successfully:", data);
      
      // Update the order status in the local state
      setOrder(prev => ({ ...prev, status: "sent" }));
      
      // Show success message (you could use a toast notification here)
      alert("Purchase order sent successfully!");
      
    } catch (error) {
      console.error("Error sending purchase order:", error);
      alert("Failed to send purchase order: " + error.message);
    } finally {
      setSending(false);
    }
  };

  // Handle PDF Download
  const handlePrint = async () => {
    if (!pdfRef.current || !order) return;

    try {
      // Dynamically import html2pdf to handle module loading
      const html2pdfModule = await import("html2pdf.js");
      const html2pdf = html2pdfModule.default || html2pdfModule;
      
      const element = pdfRef.current;
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `PurchaseOrder_${order.orderNumber || id}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error("Error generating PDF:", error);
      // Fallback to print dialog if PDF generation fails
      alert("PDF generation failed. Opening print dialog instead.");
      window.print();
    }
  };

  if (loading) {
    return (
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] flex items-center justify-center ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] flex items-center justify-center ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="text-center">
          <p className="text-lg text-gray-500 mb-4">Purchase Order not found</p>
          <Link to="/purchase/orders" className="font-semibold text-[#15171D] underline-offset-4 hover:underline">
            Back to Purchase Orders
          </Link>
        </div>
      </div>
    );
  }

  // Get status badge
  const getStatusBadge = (status) => {
    const statusMap = {
      draft: { label: "Draft", className: ui.chip.neutral },
      sent: { label: "Sent", className: ui.chip.brand },
      received: { label: "Received", className: ui.chip.success },
      cancelled: { label: "Cancelled", className: ui.chip.danger },
    };
    const statusInfo = statusMap[status] || { label: status, className: ui.chip.neutral };
    return (
      <span className={statusInfo.className}>
        {statusInfo.label}
      </span>
    );
  };

  // Process orders for sidebar
  const processedOrders = orders.map((o) => ({
    ...o,
    finalTotal: parseFloat(o.finalTotal) || 0,
  }));

  // Get company details (you may need to fetch this from user/organization settings)
  const companyName = "Meenakshi Apparels"; // This should come from user/organization settings
  const companyAddress = "6182 MAINROAD, GANDHI NAGAR, DELHI-110051"; // This should come from user/organization settings
  const companyGSTIN = "07AACPA8514M1ZX"; // This should come from user/organization settings
  const companyCountry = "India";

  // Get vendor details
  const vendorName = vendor?.displayName || vendor?.companyName || order.vendorName || "";
  const vendorState = vendor?.billingState || "";
  const vendorGSTIN = vendor?.gstin || "";
  const vendorEmail = vendor?.email || "";

  // Build vendor address
  const vendorAddressParts = [
    vendor?.billingAddress,
    vendor?.billingAddress2,
    vendor?.billingCity,
    vendor?.billingState,
    vendor?.billingPinCode,
  ].filter(Boolean);
  const vendorAddress = vendorAddressParts.join(", ");

  // Build delivery address
  const deliveryAddressParts = [
    order.deliveryAddress?.attention,
    order.deliveryAddress?.street1,
    order.deliveryAddress?.street2,
    order.deliveryAddress?.city,
    order.deliveryAddress?.state,
    order.deliveryAddress?.zip,
    order.deliveryAddress?.country,
  ].filter(Boolean);
  const deliveryAddress = deliveryAddressParts.join(", ");

  // Calculate tax breakdown
  const taxBreakdown = {};
  order.items?.forEach((item) => {
    if (item.isInterState && item.igstPercent > 0) {
      const key = `IGST${item.igstPercent} (${item.igstPercent}%)`;
      taxBreakdown[key] = (taxBreakdown[key] || 0) + parseFloat(item.igstAmount || 0);
    } else if (!item.isInterState) {
      if (item.cgstPercent > 0) {
        const key = `CGST${item.cgstPercent} (${item.cgstPercent}%)`;
        taxBreakdown[key] = (taxBreakdown[key] || 0) + parseFloat(item.cgstAmount || 0);
      }
      if (item.sgstPercent > 0) {
        const key = `SGST${item.sgstPercent} (${item.sgstPercent}%)`;
        taxBreakdown[key] = (taxBreakdown[key] || 0) + parseFloat(item.sgstAmount || 0);
      }
    }
  });

  return (
    <div className={ui.page(isSidebarOpen)}>
      {/* Left Sidebar - Orders List */}
      <div className={ui.listPanel}>
        {/* Header */}
        <div className={ui.listHeader}>
          <h2 className={ui.listTitle}>{vendorName}</h2>
          <p className={ui.listAmount}>{formatCurrency(order.finalTotal || 0)}</p>
        </div>

        {/* Action Buttons */}
        <div className={ui.listActions}>
          <button 
            onClick={() => navigate(`/purchase/orders/${id}/edit`)}
            className={ui.btnOutline}
          >
            <Edit size={13} className="shrink-0" />
            Edit
          </button>
          {order.status === "draft" && (
            <button 
              onClick={handleSendOrder}
              disabled={sending}
              className={ui.btnPrimary}
            >
              <Send size={13} className="shrink-0" />
              {sending ? "Sending..." : "Send"}
            </button>
          )}
          <button 
            onClick={handlePrint}
            className={ui.btnOutline}
          >
            <FileText size={13} className="shrink-0" />
            PDF/Print
          </button>
        </div>

        {/* Orders List */}
        <div className="flex-1 overflow-y-auto">
          {processedOrders
            .filter((o) => o.vendorName === order.vendorName)
            .map((o) => (
              <Link
                key={o._id}
                to={`/purchase/orders/${o._id}`}
                className={ui.listItem(o._id === id)}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-gray-300 accent-[#15171D]"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className={ui.listItemTitle}>{o.vendorName}</p>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
                    </div>
                    <p className={ui.listItemMeta}>
                      {o.orderNumber} - {formatDate(o.date)}
                    </p>
                    <div className="flex items-center justify-between">
                      <p className={ui.listItemAmount}>
                        {formatCurrency(o.finalTotal)}
                      </p>
                      {getStatusBadge(o.status || "draft")}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className={ui.mainArea}>
        {/* Header Bar */}
        <div className={ui.topBar}>
          <div className="flex items-center gap-4">
            <Link
              to="/purchase/orders"
              className={ui.closeBtn}
            >
              <X size={18} />
            </Link>
            <h1 className={ui.topTitle}>Purchase Order Details</h1>
          </div>
          <div className="flex items-center gap-4">
            {getStatusBadge(order.status || "draft")}
          </div>
        </div>

        {/* Order Content */}
        <div className={ui.docWrap}>
          <div ref={pdfRef} className={ui.docCard}>
            {/* Order Header */}
            <div className={ui.docSection}>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className={ui.docTitle}>PURCHASE ORDER</h1>
                </div>
                <div className="text-right">
                  <p className={`${ui.docNumber} mb-1`}>PO# {order.orderNumber}</p>
                  <p className="text-lg font-semibold text-[#15171D]">
                    Total {formatCurrency(order.finalTotal || 0)}
                  </p>
                </div>
              </div>

              {/* Order From / Order To */}
              <div className="grid grid-cols-2 gap-8">
                {/* Order From */}
                <div>
                  <h3 className={ui.docLabel}>
                    Order From
                  </h3>
                  <div className="text-sm text-[#15171D] space-y-1">
                    <p className="font-semibold">{companyName}</p>
                    <p>{companyAddress}</p>
                    <p>{companyCountry}</p>
                    <p>GSTIN {companyGSTIN}</p>
                  </div>
                </div>

                {/* Order To */}
                <div>
                  <h3 className={ui.docLabel}>
                    Order To
                  </h3>
                  <div className="text-sm text-[#15171D] space-y-1">
                    <p className="font-semibold">{vendorName}</p>
                    {vendorAddress && <p>{vendorAddress}</p>}
                    {vendorState && <p>{vendorState}</p>}
                    {vendorGSTIN && <p>GSTIN {vendorGSTIN}</p>}
                    {vendorEmail && <p>{vendorEmail}</p>}
                  </div>
                </div>
              </div>

              {/* Delivery Address */}
              {deliveryAddress && (
                <div className="mt-6">
                  <h3 className={ui.docLabel}>
                    Delivery Address
                  </h3>
                  <div className="text-sm text-[#15171D]">
                    <p>{deliveryAddress}</p>
                  </div>
                </div>
              )}

              {/* Dates and Terms */}
              <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Order Date: </span>
                  <span className="text-[#15171D] font-medium">{formatDate(order.date)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Delivery Date: </span>
                  <span className="text-[#15171D] font-medium">
                    {order.deliveryDate ? formatDate(order.deliveryDate) : "-"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Terms: </span>
                  <span className="text-[#15171D] font-medium">{order.paymentTerms || "Due on Receipt"}</span>
                </div>
              </div>

              {/* Reference Number */}
              {order.referenceNumber && (
                <div className="mt-4 text-sm">
                  <span className="text-gray-500">Reference#: </span>
                  <span className="text-[#15171D] font-medium">{order.referenceNumber}</span>
                </div>
              )}

              {/* Shipment Preference */}
              {order.shipmentPreference && (
                <div className="mt-2 text-sm">
                  <span className="text-gray-500">Shipment Preference: </span>
                  <span className="text-[#15171D] font-medium">{order.shipmentPreference}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="px-8 py-7">
              <div className={ui.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${ui.th} text-left`}>
                      #
                    </th>
                    <th className={`${ui.th} text-left`}>
                      Item & Description
                    </th>
                    <th className={`${ui.th} text-left`}>
                      Size
                    </th>
                    <th className={`${ui.th} text-left`}>
                      HSN/SAC
                    </th>
                    <th className={`${ui.th} text-right`}>
                      Qty
                    </th>
                    <th className={`${ui.th} text-right`}>
                      Rate
                    </th>
                    <th className={`${ui.th} text-right`}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items?.map((item, index) => (
                    <tr key={index} className={ui.tr(index)}>
                      <td className={`${ui.td}`}>{index + 1}</td>
                      <td className={`${ui.td}`}>
                        <div>
                          <p className="font-medium">{item.itemName || "-"}</p>
                          {item.itemDescription && (
                            <p className="text-xs text-gray-500 mt-1">{item.itemDescription}</p>
                          )}
                        </div>
                      </td>
                      <td className={`${ui.td}`}>{item.size || "-"}</td>
                      <td className={`${ui.td}`}>
                        {item.taxCode || "-"}
                      </td>
                      <td className={`${ui.td} text-right`}>
                        {item.quantity?.toFixed(2) || "0.00"} pcs
                      </td>
                      <td className={`${ui.td} text-right`}>
                        {formatCurrency(item.rate || 0)}
                      </td>
                      <td className={`${ui.td} text-right font-semibold`}>
                        {formatCurrency(item.amount || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            {/* Summary */}
            <div className={ui.totalsWrap}>
              <div className={ui.totalsBox}>
                <div className={ui.totalsRow}>
                  <span className="text-gray-500">Sub Total</span>
                  <span className="text-[#15171D] font-medium">
                    {formatCurrency(order.subTotal || 0)}
                  </span>
                </div>

                {/* Tax Breakdown */}
                {Object.entries(taxBreakdown).map(([key, value]) => (
                  <div key={key} className={ui.totalsRow}>
                    <span className="text-gray-500">{key}</span>
                    <span className="text-[#15171D] font-medium">{formatCurrency(value)}</span>
                  </div>
                ))}

                {/* Discount */}
                {order.discountAmount > 0 && (
                  <div className={ui.totalsRow}>
                    <span className="text-gray-500">Discount</span>
                    <span className="font-semibold text-emerald-600">
                      -{formatCurrency(order.discountAmount || 0)}
                    </span>
                  </div>
                )}

                {/* TDS/TCS */}
                {order.tdsTcsAmount > 0 && (
                  <div className={ui.totalsRow}>
                    <span className="text-gray-500">
                      {order.tdsTcsType || "TDS"} ({order.tdsTcsTax || ""})
                    </span>
                    <span className="font-semibold text-red-600">
                      -{formatCurrency(order.tdsTcsAmount || 0)}
                    </span>
                  </div>
                )}

                {/* Adjustment */}
                {order.adjustment !== 0 && (
                  <div className={ui.totalsRow}>
                    <span className="text-gray-500">Adjustment</span>
                    <span className="text-[#15171D] font-medium">
                      {order.adjustment > 0 ? "+" : ""}
                      {formatCurrency(order.adjustment || 0)}
                    </span>
                  </div>
                )}

                <div className={ui.grandRow}>
                  <span className={ui.grandLabel}>Total</span>
                  <span className={ui.grandValue}>
                    {formatCurrency(order.finalTotal || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {order.customerNotes && (
              <div className="px-8 py-6 border-t border-gray-100">
                <h3 className={ui.docLabel}>
                  Customer Notes
                </h3>
                <p className="text-sm text-[#15171D] whitespace-pre-wrap">{order.customerNotes}</p>
              </div>
            )}

            {/* Terms and Conditions */}
            {order.termsAndConditions && (
              <div className="px-8 py-6 border-t border-gray-100">
                <h3 className={ui.docLabel}>
                  Terms and Conditions
                </h3>
                <p className="text-sm text-[#15171D] whitespace-pre-wrap">{order.termsAndConditions}</p>
              </div>
            )}

            {/* Attachments */}
            {order.attachments && order.attachments.length > 0 && (
              <div className="px-8 py-6 border-t border-gray-100">
                <AttachmentDisplay attachments={order.attachments} />
              </div>
            )}

            {/* Authorized Signature */}
            <div className="px-8 py-6 border-t border-gray-100">
              <div className="max-w-xs">
                <div className="border-b border-gray-300 h-16"></div>
                <p className="text-xs text-gray-500 mt-2">Authorized Signature</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrderDetail;

