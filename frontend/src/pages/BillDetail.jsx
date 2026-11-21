import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { X, Edit, Check, ChevronRight, Download, Trash2, AlertTriangle } from "lucide-react";
import * as ui from "../components/docDetailStyles";
import baseUrl from "../api/api";
import AttachmentDisplay from "../components/AttachmentDisplay";
import useSidebar from "../hooks/useSidebar";

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

const daysBetween = (date1, date2) => {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date1 - date2) / oneDay));
};

const BillDetail = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const navigate = useNavigate();
  const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
  const printRef = useRef(null);

  const [bill, setBill] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPdfView, setShowPdfView] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, step: 1 });
  const [deleting, setDeleting] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  // Handle Delete Bill
  const handleDeleteClick = () => {
    setDeleteConfirm({ show: true, step: 1 });
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirm.step === 1) {
      // First confirmation - move to second step
      setDeleteConfirm({ ...deleteConfirm, step: 2 });
      return;
    }

    // Second confirmation - proceed with deletion
    if (deleteConfirm.step === 2 && id) {
      setDeleting(true);
      try {
        const response = await fetch(`${API_URL}/api/purchase/bills/${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to delete bill");
        }

        // Navigate back to bills list after successful deletion
        navigate("/purchase/bills");
      } catch (error) {
        console.error("Error deleting bill:", error);
        alert(`Failed to delete bill: ${error.message}`);
        setDeleting(false);
        setDeleteConfirm({ show: false, step: 1 });
      }
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm({ show: false, step: 1 });
  };

  // Handle Change Status from Draft to Completed
  const handleChangeStatusToCompleted = async () => {
    if (!bill || bill.status !== "draft") return;
    
    setChangingStatus(true);
    try {
      const response = await fetch(`${API_URL}/api/purchase/bills/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...bill,
          status: "completed",
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to change bill status");
      }
      
      const updatedBill = await response.json();
      console.log("Bill status changed successfully:", updatedBill);
      
      // Update the bill status in the local state
      setBill(prev => ({ ...prev, status: "completed" }));
      
      alert("Bill status changed to Completed successfully!");
      
    } catch (error) {
      console.error("Error changing bill status:", error);
      alert("Failed to change bill status: " + error.message);
    } finally {
      setChangingStatus(false);
    }
  };

  // Handle Download PDF
  const handleDownloadPDF = () => {
    if (!printRef.current || !bill) return;

    try {
      const printContent = printRef.current.innerHTML;
      
      // Create a new window for printing
      const printWindow = window.open("", "_blank");
      
      if (!printWindow) {
        alert("Please allow popups for this site to download PDF");
        return;
      }

      // Write the HTML content
      printWindow.document.open();
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Bill ${bill.billNumber || ""}</title>
            <meta charset="utf-8">
            <style>
              @page { 
                margin: 10mm; 
                size: A4;
              }
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body { 
                font-family: Arial, sans-serif; 
                margin: 0;
                padding: 20px;
                background: white;
              }
              .bill-container {
                max-width: 800px;
                margin: 0 auto;
                background: white;
              }
              table { 
                width: 100%; 
                border-collapse: collapse; 
                margin: 20px 0;
              }
              th, td { 
                border: 1px solid #ddd; 
                padding: 8px; 
                text-align: left; 
              }
              th {
                background-color: #f5f5f5;
                font-weight: bold;
              }
              .text-right { text-align: right; }
              .text-center { text-align: center; }
              .summary { 
                margin-top: 20px; 
                border-top: 2px solid #ddd; 
                padding-top: 10px; 
              }
              .summary-row {
                display: flex;
                justify-content: space-between;
                margin: 5px 0;
              }
              @media print {
                body { 
                  margin: 0; 
                  padding: 10px; 
                }
                @page {
                  margin: 10mm;
                }
              }
            </style>
          </head>
          <body>
            <div class="bill-container">
              ${printContent}
            </div>
            <script>
              // Auto-trigger print dialog when page loads
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                }, 500);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
      
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF. Please try the Print option instead.");
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Get user info
        const userStr = localStorage.getItem("rootfinuser");
        const user = userStr ? JSON.parse(userStr) : null;
        const userId = user?._id || user?.id || user?.email || user?.locCode || null;
        const locCode = user?.locCode || "";

        if (!userId) {
          navigate("/purchase/bills");
          return;
        }

        // Fetch the specific bill
        const billResponse = await fetch(`${API_URL}/api/purchase/bills/${id}`);
        if (!billResponse.ok) {
          const errorText = await billResponse.text();
          console.error("Error fetching bill:", billResponse.status, errorText);
          throw new Error(`Bill not found: ${billResponse.status}`);
        }
        const billData = await billResponse.json();
        console.log("Bill data loaded:", billData);
        setBill(billData);

        // Fetch vendor if vendorId exists
        if (billData.vendorId) {
          try {
            const vendorResponse = await fetch(`${API_URL}/api/purchase/vendors/${billData.vendorId}`);
            if (vendorResponse.ok) {
              const vendorData = await vendorResponse.json();
              setVendor(vendorData);
            }
          } catch (error) {
            console.error("Error fetching vendor:", error);
          }
        }

        // Fetch all bills for sidebar
        const billsResponse = await fetch(`${API_URL}/api/purchase/bills?userId=${userId}${locCode ? `&locCode=${locCode}` : ""}`);
        if (billsResponse.ok) {
          const billsData = await billsResponse.json();
          setBills(Array.isArray(billsData) ? billsData : []);
        }
      } catch (error) {
        console.error("Error loading bill:", error);
        navigate("/purchase/bills");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, navigate, API_URL]);

  if (loading) {
    return (
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] flex items-center justify-center ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] flex items-center justify-center ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="text-center">
          <p className="text-lg text-gray-500 mb-4">Bill not found</p>
          <Link to="/purchase/bills" className="font-semibold text-[#15171D] underline-offset-4 hover:underline">
            Back to Bills
          </Link>
        </div>
      </div>
    );
  }

  // Calculate bill status
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = bill.dueDate ? new Date(bill.dueDate) : null;
  if (dueDate) dueDate.setHours(0, 0, 0, 0);

  let status = "COMPLETED";
  let isOverdue = false;
  let overdueDays = 0;

  if (dueDate) {
    if (dueDate < today) {
      isOverdue = true;
      overdueDays = daysBetween(today, dueDate);
      status = "OVERDUE";
    } else if (dueDate.getTime() === today.getTime()) {
      status = "DUE_TODAY";
    }
  }

  // F9: balance = total − paid − credits applied (from the server); older API → total
  const balanceDue = bill.balanceDue !== undefined && bill.balanceDue !== null ? parseFloat(bill.balanceDue) || 0 : parseFloat(bill.finalTotal) || 0;
  const paidAmount = parseFloat(bill.amountPaid) || 0;
  const creditsAmount = parseFloat(bill.creditsApplied) || 0;
  const PAYMENT_LABEL = { paid: "Paid", partially_paid: "Partly paid", overdue: "Overdue", unpaid: "Unpaid" };
  const isPayable = !["draft", "cancelled", "void"].includes(String(bill.status || "").toLowerCase());

  // Process bills for sidebar
  const processedBills = bills.map((b) => {
    const bDueDate = b.dueDate ? new Date(b.dueDate) : null;
    if (bDueDate) bDueDate.setHours(0, 0, 0, 0);

    let bStatus = "COMPLETED";
    let bIsOverdue = false;
    let bOverdueDays = 0;

    if (bDueDate) {
      if (bDueDate < today) {
        bIsOverdue = true;
        bOverdueDays = daysBetween(today, bDueDate);
        bStatus = "OVERDUE";
      } else if (bDueDate.getTime() === today.getTime()) {
        bStatus = "DUE_TODAY";
      }
    }

    return {
      ...b,
      status: bStatus,
      isOverdue: bIsOverdue,
      overdueDays: bOverdueDays,
      finalTotal: parseFloat(b.finalTotal) || 0,
    };
  });

  // Get company details (you may need to fetch this from user/organization settings)
  const companyName = "Bridesberry"; // This should come from user/organization settings
  const companyAddress = "Kerala"; // This should come from user/organization settings
  const companyGSTIN = "32ABCFR1426N129"; // This should come from user/organization settings
  const companyEmail = "rootmentsoffice@gmail.com"; // This should come from user/organization settings
  const companyCountry = "India";

  // Get vendor details
  const vendorName = vendor?.displayName || vendor?.companyName || bill.vendorName || "";
  const vendorState = vendor?.billingState || bill.destinationOfSupply || "";
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

  // Calculate tax breakdown
  const taxBreakdown = {};
  bill.items?.forEach((item) => {
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
      {/* Left Sidebar - Bills List */}
      <div className={ui.listPanel}>
        {/* Header */}
        <div className={ui.listHeader}>
          <h2 className={ui.listTitle}>{vendorName}</h2>
          <p className={ui.listAmount}>{formatCurrency(balanceDue)}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mt-0.5">Balance due</p>
        </div>

        {/* Action Buttons */}
        <div className={ui.listActions}>
          <button onClick={() => navigate(`/purchase/bills/${id}/edit`)} className={ui.btnOutline} title="Edit Bill">
            <Edit size={13} className="shrink-0" />
            <span>Edit</span>
          </button>

          <button onClick={handleDownloadPDF} className={ui.btnOutline} title="Download PDF">
            <Download size={13} className="shrink-0" />
            <span>PDF</span>
          </button>

          {bill && bill.status === "draft" && (
            <button
              onClick={handleChangeStatusToCompleted}
              disabled={changingStatus}
              className={ui.btnLime}
              title="Change bill status from Draft to Completed"
            >
              <Check size={13} className="shrink-0" />
              <span>{changingStatus ? "..." : "Done"}</span>
            </button>
          )}

          <button onClick={handleDeleteClick} className={ui.btnDanger} title="Delete Bill">
            <Trash2 size={13} className="shrink-0" />
            <span>Delete</span>
          </button>
        </div>

        {/* Overdue Banner */}
        {isOverdue && (
          <div className="mx-4 mt-3 mb-1 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs font-semibold text-amber-800">Payment for this bill is overdue.</p>
          </div>
        )}

        {/* Bills List */}
        <div className="flex-1 overflow-y-auto">
          {processedBills
            .filter((b) => b.vendorName === bill.vendorName)
            .map((b) => (
              <Link key={b._id} to={`/purchase/bills/${b._id}`} className={ui.listItem(b._id === id)}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-gray-300 accent-[#15171D]"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={ui.listItemTitle}>{b.vendorName}</p>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
                    </div>
                    <p className={ui.listItemMeta}>
                      {b.billNumber} · {formatDate(b.billDate)}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <p className={ui.listItemAmount}>{formatCurrency(b.finalTotal)}</p>
                      {b.isOverdue ? (
                        <span className={ui.chip.danger}>Overdue {b.overdueDays}d</span>
                      ) : b.status === "DUE_TODAY" ? (
                        <span className={ui.chip.warning}>Due today</span>
                      ) : (
                        <span className={ui.chip.success}>Completed</span>
                      )}
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
          <div className="flex items-center gap-3">
            <Link to="/purchase/bills" className={ui.closeBtn} title="Back to bills">
              <X size={18} />
            </Link>
            <h1 className={ui.topTitle}>Bill Details</h1>
            {isOverdue ? (
              <span className={ui.chip.danger}>Overdue</span>
            ) : bill.status === "draft" ? (
              <span className={ui.chip.neutral}>Draft</span>
            ) : (
              <span className={ui.chip.success}>{bill.status || "Open"}</span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPdfView}
              onChange={(e) => setShowPdfView(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-[#15171D]"
            />
            Show PDF View
          </label>
        </div>

        {/* Bill Content */}
        <div className={ui.docWrap}>
          <div ref={printRef} className={ui.docCard}>
            {/* Bill Header */}
            <div className={ui.docSection}>
              <div className="flex items-start justify-between gap-6 mb-6">
                {/* Company Info (Top Left) */}
                <div className="text-sm text-gray-600 space-y-0.5">
                  <p className="text-base font-bold text-[#15171D]">{companyName}</p>
                  <p>{companyAddress}</p>
                  <p>{companyCountry}</p>
                  <p>GSTIN {companyGSTIN}</p>
                  {companyEmail && <p>{companyEmail}</p>}
                </div>

                {/* Bill Title and Info (Top Right) */}
                <div className="text-right">
                  <h1 className={ui.docTitle}>BILL</h1>
                  <p className={`${ui.docNumber} mt-1`}>Bill# {bill.billNumber}</p>
                  <div className="mt-3 inline-flex flex-col items-end rounded-xl bg-[#F6FCE6] border border-[#DEF39A] px-4 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Balance Due</span>
                    <span className="text-xl font-extrabold text-[#15171D]">{formatCurrency(balanceDue)}</span>
                  </div>
                </div>
              </div>

              {/* Bill From / Bill Details */}
              <div className="grid grid-cols-2 gap-8 mt-6 pt-6 border-t border-gray-100">
                {/* Bill From (Vendor) */}
                <div>
                  <h3 className={ui.docLabel}>Bill From</h3>
                  <div className="text-sm text-gray-600 space-y-0.5">
                    <p className="text-base font-bold text-[#15171D]">{vendorName}</p>
                    {vendorAddress && <p>{vendorAddress}</p>}
                    {vendorState && <p>{vendorState}</p>}
                    {vendorGSTIN && <p>GSTIN {vendorGSTIN}</p>}
                    {vendorEmail && <p>{vendorEmail}</p>}
                  </div>
                </div>

                {/* Bill Details (Dates and Terms) */}
                <div>
                  <h3 className={ui.docLabel}>Details</h3>
                  <div className="text-sm space-y-2">
                    <div>
                      <span className="text-gray-500">Bill Date: </span>
                      <span className="font-semibold text-[#15171D]">{formatDate(bill.billDate)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Due Date: </span>
                      <span className="font-semibold text-[#15171D]">
                        {bill.dueDate ? formatDate(bill.dueDate) : "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Terms: </span>
                      <span className="font-semibold text-[#15171D]">{bill.paymentTerms || "Net 60"}</span>
                    </div>
                  </div>
                </div>
              </div>
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
                      Cost Price
                    </th>
                    <th className={`${ui.th} text-right`}>
                      MRP
                    </th>
                    <th className={`${ui.th} text-right`}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bill.items?.map((item, index) => (
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
                        {item.hsnCode || item.taxCode || "-"}
                      </td>
                      <td className={`${ui.td} text-right`}>
                        {item.quantity?.toFixed(2) || "0.00"} PCS
                      </td>
                      <td className={`${ui.td} text-right`}>
                        {formatCurrency(item.rate || item.costPrice || 0).replace('₹', '').trim()}
                      </td>
                      <td className={`${ui.td} text-right`}>
                        {formatCurrency(item.mrp || item.sellingPrice || 0).replace('₹', '').trim()}
                      </td>
                      <td className={`${ui.td} text-right font-semibold`}>
                        {formatCurrency(item.amount || item.baseAmount || 0).replace('₹', '').trim()}
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
                  <span className={ui.totalsLabel}>Sub Total</span>
                  <span className={ui.totalsValue}>
                    {formatCurrency(bill.subTotal || 0).replace('₹', '').trim()}
                  </span>
                </div>

                {/* Tax Breakdown */}
                {Object.entries(taxBreakdown).map(([key, value]) => (
                  <div key={key} className={ui.totalsRow}>
                    <span className={ui.totalsLabel}>{key}</span>
                    <span className={ui.totalsValue}>{formatCurrency(value).replace('₹', '').trim()}</span>
                  </div>
                ))}

                {/* Discount */}
                {bill.discountAmount > 0 && (
                  <div className={ui.totalsRow}>
                    <span className={ui.totalsLabel}>Discount</span>
                    <span className="font-semibold text-emerald-600">
                      -{formatCurrency(bill.discountAmount || 0).replace('₹', '').trim()}
                    </span>
                  </div>
                )}

                {/* TDS/TCS */}
                {bill.tdsTcsAmount > 0 && (
                  <div className={ui.totalsRow}>
                    <span className={ui.totalsLabel}>
                      {bill.tdsTcsType || "TDS"} ({bill.tdsTcsTax || ""})
                    </span>
                    <span className="font-semibold text-red-600">
                      -{formatCurrency(bill.tdsTcsAmount || 0).replace('₹', '').trim()}
                    </span>
                  </div>
                )}

                {/* Adjustment */}
                {bill.adjustment !== 0 && (
                  <div className={ui.totalsRow}>
                    <span className={ui.totalsLabel}>Adjustment</span>
                    <span className={ui.totalsValue}>
                      {bill.adjustment > 0 ? "+" : ""}
                      {formatCurrency(bill.adjustment || 0).replace('₹', '').trim()}
                    </span>
                  </div>
                )}

                <div className="pt-3 mt-1 border-t border-gray-200 flex justify-between">
                  <span className="text-base font-bold text-[#15171D]">Total</span>
                  <span className="text-base font-bold text-[#15171D]">
                    {formatCurrency(bill.finalTotal || 0)}
                  </span>
                </div>

                {paidAmount > 0 && (
                  <div className="flex justify-between text-sm text-[#15803d]">
                    <span>Payments made</span>
                    <span>(−) {formatCurrency(paidAmount)}</span>
                  </div>
                )}
                {creditsAmount > 0 && (
                  <div className="flex justify-between text-sm text-[#15803d]">
                    <span>Vendor credits applied</span>
                    <span>(−) {formatCurrency(creditsAmount)}</span>
                  </div>
                )}
                <div className={ui.grandRow}>
                  <span className={ui.grandLabel}>Balance Due{isPayable && bill.paymentStatus ? ` · ${PAYMENT_LABEL[bill.paymentStatus] || ""}` : ""}</span>
                  <span className={ui.grandValue}>
                    {formatCurrency(balanceDue)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payments and credits on this bill (F9) */}
            {((bill.payments || []).length > 0 || (bill.appliedCredits || []).length > 0 || (isPayable && balanceDue > 0.004)) && (
              <div className="px-8 py-6 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className={ui.docLabel}>Payments</h3>
                  {isPayable && balanceDue > 0.004 && (
                    <Link to={`/purchase/payments/new?vendorId=${encodeURIComponent(bill.vendorId || "")}&billId=${bill._id}`} className={ui.btnOutline}>Record payment</Link>
                  )}
                </div>
                {(bill.payments || []).length === 0 && (bill.appliedCredits || []).length === 0 ? (
                  <p className="text-sm text-gray-500">No payments yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {(bill.payments || []).map((pm) => (
                        <tr key={String(pm.paymentId)}>
                          <td className="py-1.5">{pm.date ? new Date(pm.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</td>
                          <td className="py-1.5"><Link to={`/purchase/payments/${pm.paymentId}`} className="font-semibold hover:underline">{pm.paymentNumber}</Link></td>
                          <td className="py-1.5 text-right">{formatCurrency(pm.amount)}</td>
                        </tr>
                      ))}
                      {(bill.appliedCredits || []).map((cr, i) => (
                        <tr key={`cr-${i}`}>
                          <td className="py-1.5">{cr.appliedDate ? new Date(cr.appliedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</td>
                          <td className="py-1.5">Credit {cr.creditNoteNumber}</td>
                          <td className="py-1.5 text-right">{formatCurrency(cr.appliedAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Notes */}
            {bill.notes && (
              <div className="px-8 py-6 border-t border-gray-100">
                <h3 className={ui.docLabel}>
                  Notes
                </h3>
                <p className="text-sm text-[#15171D] whitespace-pre-wrap">{bill.notes}</p>
              </div>
            )}

            {/* Attachments */}
            {bill.attachments && bill.attachments.length > 0 && (
              <div className="px-8 py-6 border-t border-gray-100">
                <h3 className={ui.docLabel}>
                  Attachments
                </h3>
                <AttachmentDisplay attachments={bill.attachments} />
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

      {/* Delete Confirmation Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-red-100">
                <Trash2 className="text-red-600" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-[#15171D] text-center mb-2">
                {deleteConfirm.step === 1 ? "Delete Bill?" : "Are you absolutely sure?"}
              </h3>
              <p className="text-sm text-gray-500 text-center mb-6">
                {deleteConfirm.step === 1 
                  ? "This action will delete the bill and reverse the stock changes. This cannot be undone."
                  : "This will permanently delete the bill and affect the stock in the group. This action cannot be reversed."}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleDeleteCancel}
                  disabled={deleting}
                  className="no-hover-anim flex-1 h-11 rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="no-hover-anim flex-1 h-11 rounded-full bg-red-600 text-sm font-bold text-white hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? "Deleting..." : deleteConfirm.step === 1 ? "Yes, Delete" : "Yes, Delete Permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillDetail;

