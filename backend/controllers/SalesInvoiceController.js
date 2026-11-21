import SalesInvoice from "../model/SalesInvoice.js";
import { nextGlobalSalesInvoice } from "../utils/nextSalesInvoice.js";
import { applyLines, undoMovements, StockError } from "../utils/stockService.js";
import { checkAndCreateReorderAlerts } from "../utils/reorderNotification.js";
import { updateMonthlyStockForSale } from "../utils/monthlyStockTracking.js";
import Transaction from "../model/Transaction.js";
import User from "../model/UserModel.js";
import mongoose from "mongoose";
import { assignVendorsToLines, applyVendorAllocations } from "../utils/vendorStock.js";
import {
  HttpError, UndoStack, findOrCreateCustomer, getLoyaltySettings, planRedemptions, applyRedemptions,
  computeEarn, postEarn, reverseInvoiceRedemptions, previewReturn, applyReturnRefund, snapshotLineCosts, toId,
} from "../utils/redemptions.js";
import { round2, normalizePhone } from "../utils/retailMath.js";

// Fields only the server may set (anything the client sends for these is ignored)
const SERVER_ONLY_FIELDS = [
  "customerId", "totalRedeemed", "amountDue", "loyaltyPointsEarned", "loyaltyPointsUsed", "earnBase",
  "loyaltyApplied", "loyaltyBaseTotal", "loyaltyPointsRestored", "loyaltyPointsReversed", "refundBreakdown",
];
const stripServerFields = (body) => { for (const f of SERVER_ONLY_FIELDS) delete body[f]; };

const httpErrorResponse = (res, err) => res.status(err.status).json({ message: err.message, ...err.extra });

const hasValue = (v) => v !== undefined && v !== null && v !== "";

/**
 * Money received must match the amount due (bill total minus redemptions).
 * Rejects a screen that previewed a different amount due (409) and a split that does not add up (400).
 */
const validatePayment = (inv, clientAmountDue) => {
  const due = round2(inv.amountDue);
  if (hasValue(clientAmountDue) && Math.abs(round2(Number(clientAmountDue)) - due) > 0.01) {
    throw new HttpError(409, `Amount due has changed: the server calculated ₹${due.toFixed(2)} but the screen showed ₹${round2(Number(clientAmountDue)).toFixed(2)}. Please re-check the redemptions.`, { code: "AMOUNT_DUE_MISMATCH", amountDue: due });
  }
  if (inv.isSplitPayment && inv.splitPaymentAmounts) {
    const s = inv.splitPaymentAmounts;
    const paid = round2(["cash", "bank", "upi", "rbl"].reduce((t, k) => t + (parseFloat(s[k]) || 0), 0));
    if (Math.abs(paid - due) > 0.01) {
      throw new HttpError(400, `Split payment adds up to ₹${paid.toFixed(2)} but the amount due is ₹${due.toFixed(2)}.`);
    }
  } else if (due > 0.004 && !hasValue(inv.paymentMethod)) {
    throw new HttpError(400, `Select a payment method for the ₹${due.toFixed(2)} still due.`);
  }
};

// ─── Stock helpers ──────────────────────────────────────────────────────────
const RETURN_CATEGORIES = ["return", "refund", "cancel"];
const isReturnCategory = (category) => RETURN_CATEGORIES.includes((category || "").toLowerCase().trim());

// The ONE rule for which warehouse an invoice moves stock in (create, edit and delete all use it).
const invoiceWarehouse = (inv) => (inv?.stockWarehouse || inv?.warehouse || inv?.branch || "Warehouse").toString().trim();

// A sale takes stock out (-1); a return / refund / cancel puts it back (+1).
const stockSign = (category) => (isReturnCategory(category) ? 1 : -1);

const stockErrorResponse = (res, err) =>
  res.status(409).json({
    message: err.message,
    code: "STOCK_ERROR",
    details: err.details || {},
  });

// Non-critical follow-ups after stock moved (monthly tracking + reorder alerts). Never throws.
const afterStockMoved = (movements, lineItems, warehouse) => {
  setImmediate(async () => {
    for (const m of movements) {
      if (m.target.kind !== "group" || m.delta >= 0) continue;
      try {
        await updateMonthlyStockForSale(String(m.target.groupId), String(m.target.itemId), m.warehouse, -m.delta, m.target.name);
      } catch (e) { /* tracking only */ }
    }
    try { await checkAndCreateReorderAlerts(lineItems, warehouse); } catch (e) { /* alerts only */ }
  });
};

// ✅ Helper function to allocate payment amounts based on payment method
const allocatePaymentAmounts = (invoice) => {
  let cash = "0";
  let bank = "0";
  let upi = "0";
  let rbl = "0";
  let paymentMethodForTransaction = "split"; // Default
  
  // Check if this is a return/refund/cancel invoice (negative amounts)
  const categoryLower = (invoice.category || "").toLowerCase().trim();
  const isReturnRefundCancel = ["return", "refund", "cancel"].includes(categoryLower);
  const finalTotalValue = parseFloat(invoice.finalTotal || 0);
  const isNegativeAmount = finalTotalValue < 0;

  // Only money actually received (or refunded) goes into cash/bank/upi/rbl: amountDue is the
  // bill total minus loyalty/store-credit redemptions (on a return: the cash part of the refund).
  // Invoices created before redemptions existed have no amountDue → the full total, as before.
  const moneyValue = hasValue(invoice.amountDue) && Number.isFinite(Number(invoice.amountDue))
    ? Number(invoice.amountDue)
    : finalTotalValue;
  // For returns/refunds, use absolute value for payment allocation but keep transaction amounts negative
  const amountToAllocate = round2(Math.abs(moneyValue)).toString();
  
  // Handle split payment first
  if (invoice.isSplitPayment && invoice.splitPaymentAmounts) {
    const splitAmounts = invoice.splitPaymentAmounts;
    cash = isNegativeAmount ? (-Math.abs(parseFloat(splitAmounts.cash || 0))).toString() : (splitAmounts.cash || "0");
    bank = isNegativeAmount ? (-Math.abs(parseFloat(splitAmounts.bank || 0))).toString() : (splitAmounts.bank || "0");
    upi = isNegativeAmount ? (-Math.abs(parseFloat(splitAmounts.upi || 0))).toString() : (splitAmounts.upi || "0");
    rbl = isNegativeAmount ? (-Math.abs(parseFloat(splitAmounts.rbl || 0))).toString() : (splitAmounts.rbl || "0");
    paymentMethodForTransaction = "split";
    
    console.log(`💰 Split payment allocation for ${isReturnRefundCancel ? 'RETURN' : 'INVOICE'}:`, {
      cash, bank, upi, rbl,
      isNegative: isNegativeAmount
    });
  } else {
    // Set payment amounts and method based on selected payment method
    if (invoice.paymentMethod === "Cash") {
      cash = isNegativeAmount ? (-Math.abs(parseFloat(amountToAllocate))).toString() : amountToAllocate;
      paymentMethodForTransaction = "cash";
    } else if (invoice.paymentMethod === "Bank" || invoice.paymentMethod === "Card / Bank") {
      bank = isNegativeAmount ? (-Math.abs(parseFloat(amountToAllocate))).toString() : amountToAllocate;
      paymentMethodForTransaction = "bank";
    } else if (invoice.paymentMethod === "UPI") {
      upi = isNegativeAmount ? (-Math.abs(parseFloat(amountToAllocate))).toString() : amountToAllocate;
      paymentMethodForTransaction = "upi";
    } else if (invoice.paymentMethod === "RBL") {
      rbl = isNegativeAmount ? (-Math.abs(parseFloat(amountToAllocate))).toString() : amountToAllocate;
      paymentMethodForTransaction = "split";
    } else {
      // If no payment method selected, default to split with zero amounts
      paymentMethodForTransaction = "split";
    }
    
    console.log(`💰 Payment allocation for ${isReturnRefundCancel ? 'RETURN' : 'INVOICE'}:`, {
      paymentMethod: invoice.paymentMethod,
      finalTotal: finalTotalValue,
      isNegative: isNegativeAmount,
      cash, rbl, bank, upi
    });
  }
  
  // Part of the total settled without money (points, store credit; on a return the part not paid out in cash)
  const redeemedAmount = round2(Math.max(0, Math.abs(finalTotalValue) - Math.abs(moneyValue)));

  return { cash, bank, upi, rbl, paymentMethodForTransaction, redeemedAmount };
};
 
// Create a new sales invoice
export const createSalesInvoice = async (req, res) => {
  try {
    const invoiceData = req.body;
    const userId = invoiceData.userId;

    if (!invoiceData.customer || !userId) {
      return res.status(400).json({ message: "Customer name and userId are required" });
    }

    // Determine invoice prefix
    let invoicePrefix = "INV-";
    const categoryLower = (invoiceData.category || "").toLowerCase();
    if (invoiceData.invoiceNumber?.startsWith("RTN-") || categoryLower === "return") {
      invoicePrefix = "RTN-";
    } else if (invoiceData.invoiceNumber?.startsWith("RET-")) {
      invoicePrefix = "RET-";
    }

    if (invoiceData.status) {
      invoiceData.status = invoiceData.status.toLowerCase();
    }
    if (invoiceData.returnStatus) {
      invoiceData.returnStatus = invoiceData.returnStatus.toLowerCase();
    }

    // Resilient user query: case-insensitive email or username, and ObjectId if valid
    const trimmedUserId = (userId || "").toString().trim();
    const userConditions = [
      { email: { $regex: new RegExp(`^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") } },
      { username: { $regex: new RegExp(`^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") } },
    ];
    if (mongoose.Types.ObjectId.isValid(trimmedUserId)) {
      userConditions.push({ _id: trimmedUserId });
    }

    // Run user lookup and invoice number generation in parallel
    let [user, existingInvoice] = await Promise.all([
      User.findOne({ $or: userConditions }).lean(),
      invoiceData.invoiceNumber
        ? SalesInvoice.findOne({ invoiceNumber: invoiceData.invoiceNumber }).lean()
        : Promise.resolve(null)
    ]);

    if (!user) {
      user = (await User.findOne({ power: "admin" }).lean()) || (await User.findOne().lean());
    }

    if (!user) {
      user = {
        _id: new mongoose.Types.ObjectId(),
        username: userId || "Admin",
        email: userId || "admin@example.com",
        power: "admin",
        role: "admin",
        storeId: null,
      };
    }

    // Store-level access control
    if (user.role === "store_manager" || user.role === "store_user") {
      const userStore = user.storeName || user.username;
      if (invoiceData.branch !== userStore) {
        return res.status(403).json({
          message: "You can only create invoices for your store",
          userStore,
          requestedStore: invoiceData.branch
        });
      }
    }

    // Resolve final invoice number
    let finalInvoiceNumber = invoiceData.invoiceNumber;
    if (!finalInvoiceNumber || existingInvoice) {
      finalInvoiceNumber = await nextGlobalSalesInvoice(invoicePrefix);
    }

    invoiceData.invoiceNumber = finalInvoiceNumber;
    invoiceData.createdBy = userId;
    invoiceData.storeId = user.storeId;

    const isReturnInvoice = isReturnCategory(invoiceData.category);

    // ── CUSTOMER & REDEMPTIONS (validated before anything is changed) ──
    const requestedRedemptions = invoiceData.redemptions;
    const clientAmountDue = invoiceData.amountDue;
    const refundMode = invoiceData.refundMode === "storeCredit" ? "storeCredit" : "cash";
    delete invoiceData.redemptions;
    delete invoiceData.refundMode;
    stripServerFields(invoiceData);
    invoiceData._id = new mongoose.Types.ObjectId(); // known up front so ledger rows can point at it

    let customer = null, plan = null, earn = null, original = null, split = null;
    try {
      if (isReturnInvoice) {
        if (Array.isArray(requestedRedemptions) && requestedRedemptions.length) {
          throw new HttpError(400, "Loyalty points, store credit, gift cards and vouchers cannot be used on a return.");
        }
        const origId = toId(invoiceData.originalInvoiceId);
        if (origId) original = await SalesInvoice.findById(origId).lean();
        split = previewReturn(original, invoiceData.finalTotal, refundMode);
        if (original?.customerId) {
          invoiceData.customerId = original.customerId;
        } else if (split.storeCreditAmount > 0) {
          // Store credit (chosen, or the gift-card share of a walk-in bill) needs a customer record
          customer = await findOrCreateCustomer({ name: invoiceData.customer, phone: invoiceData.customerPhone, locCode: invoiceData.locCode, createdBy: userId });
          invoiceData.customerId = customer?._id || null;
        }
        if (split.storeCreditAmount > 0 && !invoiceData.customerId) {
          throw new HttpError(400, refundMode === "storeCredit"
            ? "A refund as store credit needs the customer's phone number."
            : `₹${split.storeCreditAmount.toFixed(2)} of this bill was paid by gift card or store credit, so it can only be refunded as store credit, which needs the customer's phone number.`);
        }
        invoiceData.amountDue = -split.cashRefund;
        invoiceData.totalRedeemed = round2(split.returnValue - split.cashRefund);
        await snapshotLineCosts(invoiceData.lineItems, original?.lineItems || []);
      } else {
        customer = await findOrCreateCustomer({ name: invoiceData.customer, phone: invoiceData.customerPhone, locCode: invoiceData.locCode, createdBy: userId });
        invoiceData.customerId = customer?._id || null;
        const settings = await getLoyaltySettings(invoiceData.locCode);
        const finalTotal = round2(Number(invoiceData.finalTotal) || 0);
        plan = await planRedemptions({ requested: requestedRedemptions, finalTotal, customer, settings, lines: invoiceData.lineItems, locCode: invoiceData.locCode });
        earn = computeEarn({ customer, finalTotal, plan, settings });
        Object.assign(invoiceData, {
          redemptions: plan.redemptions,
          totalRedeemed: plan.totalRedeemed,
          amountDue: round2(finalTotal - plan.totalRedeemed),
          loyaltyPointsUsed: plan.loyaltyPointsUsed,
          loyaltyPointsEarned: earn.earned,
          earnBase: earn.earnBase,
          loyaltyApplied: true,
          loyaltyBaseTotal: finalTotal,
        });
        validatePayment(invoiceData, clientAmountDue);
        await snapshotLineCosts(invoiceData.lineItems);
      }
    } catch (err) {
      if (err instanceof HttpError) return httpErrorResponse(res, err);
      throw err;
    }

    // Decide which vendor each sold piece comes from (cashier choice, else oldest stock first)
    if (!isReturnInvoice && Array.isArray(invoiceData.lineItems)) {
      await assignVendorsToLines(invoiceData.lineItems);
    }

    // ── STOCK FIRST ──────────────────────────────────────────────────────
    // Stock is moved BEFORE the invoice is saved, atomically and all-or-nothing.
    // If any item does not have enough stock the whole sale is rejected (409)
    // and nothing is changed — no more invoices saved with stock silently not deducted.
    const warehouse = invoiceWarehouse(invoiceData);
    const sign = stockSign(invoiceData.category);
    let movements = [];
    try {
      movements = await applyLines(invoiceData.lineItems || [], warehouse, sign);
    } catch (err) {
      if (err instanceof StockError) return stockErrorResponse(res, err);
      throw err;
    }
    invoiceData.stockApplied = true;
    invoiceData.stockWarehouse = warehouse;

    // Order: stock (done) → redemptions → save invoice → points earned / return refund.
    // Any failure undoes every earlier step, so nothing is left half-applied.
    const undo = new UndoStack();
    undo.push("stock", () => undoMovements(movements));
    let invoice;
    try {
      if (!isReturnInvoice && plan.redemptions.length) {
        await applyRedemptions({ plan, customer, invoiceId: invoiceData._id, invoiceNumber: finalInvoiceNumber, createdBy: userId, undo });
      }
      invoice = await SalesInvoice.create(invoiceData);
      undo.push("invoice", () => SalesInvoice.deleteOne({ _id: invoice._id }));
      if (!isReturnInvoice) {
        await postEarn({ customer, earned: earn.earned, earnBase: earn.earnBase, invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, createdBy: userId, undo });
      } else {
        const breakdown = await applyReturnRefund({ original, returnInvoice: invoice, split, refundMode, createdBy: userId, undo });
        await SalesInvoice.updateOne({ _id: invoice._id }, { $set: { refundBreakdown: breakdown } });
        invoice.refundBreakdown = breakdown;
      }
    } catch (saveErr) {
      await undo.rollback(); // put back stock, balances and remove the invoice
      if (saveErr instanceof HttpError) return httpErrorResponse(res, saveErr);
      throw saveErr;
    }

    // Per-vendor stock: a sale takes from the vendor, a return puts it back
    try {
      await applyVendorAllocations(invoice.lineItems, sign > 0 ? 1 : -1);
    } catch (err) {
      console.error("Vendor allocation error:", err.message);
    }

    res.status(201).json(invoice);

    afterStockMoved(movements, invoice.lineItems, warehouse);
    setImmediate(async () => {
      try {
        await createFinancialTransaction(invoice);
      } catch (err) {
        console.error("Background financial transaction error:", err.message);
      }
    });

  } catch (error) {
    console.error("Create sales invoice error:", error);

    if (error.code === 11000) {
      return res.status(409).json({ message: "Invoice number already exists" });
    }
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message).join(", ");
      return res.status(400).json({ message: "Validation error", error: errors });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Helper function to create financial transaction
const createFinancialTransaction = async (invoice) => {
  try {
    console.log("🔄 Creating financial transaction for invoice:", invoice.invoiceNumber);
    console.log("Invoice data for transaction:", {
      category: invoice.category,
      subCategory: invoice.subCategory,
      remark: invoice.remark,
      customerNotes: invoice.customerNotes,
      subject: invoice.subject
    });
    
    // Use the selected category as the transaction type, or default to "Receivable"
    const transactionType = invoice.category || "Receivable";
    
    // ✅ Use helper function to allocate payment amounts
    const { cash, bank, upi, rbl, paymentMethodForTransaction, redeemedAmount } = allocatePaymentAmounts(invoice);

    // Get location code from invoice or use default
    const locCode = invoice.locCode || "001"; // Default location code
    
    console.log(`📍 Creating transaction with locCode: "${locCode}" (from invoice.locCode: "${invoice.locCode}")`);
    console.log(`📅 Transaction date: ${invoice.invoiceDate}`);
    
    // Create financial transaction entry
    const transactionData = {
      type: transactionType, // Use selected category as transaction type
      invoiceNo: invoice.invoiceNumber,
      category: invoice.category || "Sales", // Use invoice category for transaction category
      subCategory: invoice.subCategory || "General", // Use invoice subCategory for transaction subCategory
      remark: invoice.remark || invoice.customerNotes || invoice.subject || `Invoice for ${invoice.customer}`, // Use actual remarks from invoice
      billValue: parseFloat(invoice.subTotal || invoice.finalTotal || 0), // subTotal = before discount (bill value)
      discountAmount: parseFloat(invoice.discountAmount || 0), // discount applied
      amount: invoice.finalTotal.toString(),
      cash: cash,
      rbl: rbl,
      bank: bank,
      upi: upi,
      paymentMethod: paymentMethodForTransaction,
      date: invoice.invoiceDate,
      locCode: locCode,
      quantity: invoice.lineItems?.length.toString() || "0",
      customerName: invoice.customer,
      totalTransaction: invoice.finalTotal,
      redeemedAmount,
    };

    // Save transaction to MongoDB
    const transaction = await Transaction.create(transactionData);
    return transaction;
  } catch (error) {
    console.error("❌ Error creating financial transaction:", error);
    throw error;
  }
};

// Helper function to update financial transaction when invoice is updated
const updateFinancialTransaction = async (invoice) => {
  try {
    console.log("🔄 Updating financial transaction for invoice:", invoice.invoiceNumber);
    console.log("🔄 Invoice split payment data:", {
      isSplitPayment: invoice.isSplitPayment,
      splitPaymentAmounts: invoice.splitPaymentAmounts,
      paymentMethod: invoice.paymentMethod
    });
    
    // Find the existing transaction by invoice number
    const existingTransaction = await Transaction.findOne({ 
      invoiceNo: invoice.invoiceNumber 
    });
    
    if (!existingTransaction) {
      console.log("⚠️ No existing transaction found, creating new one");
      // If no transaction exists, create one
      return await createFinancialTransaction(invoice);
    }
    
    // Use the selected category as the transaction type, or default to "Receivable"
    const transactionType = invoice.category || "Receivable";
    
    // ✅ Use helper function to allocate payment amounts
    const { cash, bank, upi, rbl, paymentMethodForTransaction, redeemedAmount } = allocatePaymentAmounts(invoice);

    console.log("🔄 Payment allocation result:", { cash, bank, upi, rbl, paymentMethodForTransaction, redeemedAmount });
    
    // Get location code from invoice or use existing
    const locCode = invoice.locCode || existingTransaction.locCode || "001";
    
    // Update transaction data
    const updateData = {
      type: transactionType,
      category: invoice.category || "Sales",
      subCategory: invoice.subCategory || "General",
      remark: invoice.remark || invoice.customerNotes || invoice.subject || `Invoice for ${invoice.customer}`,
      billValue: parseFloat(invoice.subTotal || invoice.finalTotal || 0), // subTotal = pre-discount bill value
      discountAmount: parseFloat(invoice.discountAmount || 0),
      amount: invoice.finalTotal.toString(),
      cash: cash,
      rbl: rbl,
      bank: bank,
      upi: upi,
      paymentMethod: paymentMethodForTransaction,
      date: invoice.invoiceDate,
      locCode: locCode,
      quantity: invoice.lineItems?.length.toString() || "0",
      customerName: invoice.customer,
      totalTransaction: invoice.finalTotal,
      redeemedAmount,
    };

    // Update transaction in MongoDB
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      existingTransaction._id,
      updateData,
      { new: true, runValidators: true }
    );
    
    console.log("✅ MongoDB transaction updated:", updatedTransaction.invoiceNo);

    console.log("Updated transaction details:", {
      type: transactionType,
      category: invoice.category,
      subCategory: invoice.subCategory,
      paymentMethod: invoice.paymentMethod,
      selectedPaymentMethod: paymentMethodForTransaction,
      cash: cash,
      rbl: rbl,
      bank: bank,
      upi: upi,
      billValue: invoice.finalTotal
    });
    
    return updatedTransaction;
  } catch (error) {
    console.error("❌ Error updating financial transaction:", error);
    throw error;
  }
};

// How a return of `returnValue` from this invoice would be refunded (cash vs store credit,
// points restored/reversed). Read-only; the same calculation runs when the return is saved.
export const previewInvoiceReturn = async (req, res) => {
  try {
    const original = toId(req.params.id) ? await SalesInvoice.findById(req.params.id).lean() : null;
    if (!original) return res.status(404).json({ message: "Sales invoice not found" });
    const returnValue = Math.abs(Number(req.body?.returnValue) || 0);
    const refundMode = req.body?.refundMode === "storeCredit" ? "storeCredit" : "cash";
    const split = previewReturn(original, returnValue, refundMode);
    res.json({
      ...split,
      refundMode,
      hasCustomer: !!original.customerId || !!normalizePhone(original.customerPhone),
      redemptions: original.redemptions || [],
    });
  } catch (error) {
    console.error("Return preview error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get next invoice number (FIXED - ADDED)
export const getNextInvoiceNumber = async (req, res) => {
  try {
    const prefix = req.body.prefix || "INV-";
    const nextNumber = await nextGlobalSalesInvoice(prefix);

    res.status(200).json({ invoiceNumber: nextNumber });
  } catch (error) {
    console.error("Get next invoice number error:", error);
    res.status(500).json({
      message: "Error generating next invoice number",
      error: error.message,
    });
  }
};

// Get all sales invoices for a user
export const getSalesInvoices = async (req, res) => {
  try {
    const { userId, userPower, status, locCode, warehouse, filterLocCode, fromDate, toDate, branch } = req.query;

    const query = {};

    // Add date range filtering
    if (fromDate || toDate) {
      query.invoiceDate = {};
      if (fromDate) {
        const from = new Date(fromDate);
        from.setUTCHours(0, 0, 0, 0);
        query.invoiceDate.$gte = from;
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setUTCHours(23, 59, 59, 999);
        query.invoiceDate.$lte = to;
      }
      console.log(`📅 Date filtering applied: ${fromDate} to ${toDate}`);
    }

    const adminEmails = ["officerootments@gmail.com"];
    const isAdminEmail =
      userId &&
      typeof userId === "string" &&
      adminEmails.some(
        (email) => userId.toLowerCase() === email.toLowerCase()
      );

    const isAdmin =
      isAdminEmail ||
      (userPower &&
        (userPower.toLowerCase() === "admin" ||
          userPower.toLowerCase() === "super_admin")) ||
      (locCode && (locCode === "858" || locCode === "103"));

    // If admin has switched to a specific store (not Warehouse), filter by that store
    const isAdminViewingSpecificStore = isAdmin && warehouse && warehouse !== "All Stores";

    // Store-level access control: filter invoices by store for non-admin users OR admins viewing specific store
    if ((!isAdmin || isAdminViewingSpecificStore) && (warehouse || filterLocCode || branch)) {
      // Check warehouse, branch, or locCode fields for compatibility with old invoices
      const orConditions = [];
      if (warehouse) {
        orConditions.push({ warehouse: warehouse });
        orConditions.push({ branch: warehouse });
      }
      if (branch) {
        orConditions.push({ branch: branch });
        orConditions.push({ warehouse: branch });
      }
      if (filterLocCode) {
        orConditions.push({ locCode: filterLocCode });
      }
      if (orConditions.length > 0) {
        query.$or = orConditions;
      }
    } else if (!isAdmin && userId) {
      // Get user to check role and store
      const user = await User.findOne({ email: userId });
      
      if (user && (user.role === "store_manager" || user.role === "store_user")) {
        // Store user can only see invoices for their store
        const userStore = user.storeName || user.username;
        query.branch = userStore;
        console.log(`📋 Filtering invoices for store user: ${userId} → Store: ${userStore}`);
      } else {
        // Fallback to original logic for non-store users
        const userIdStr = userId.toString();

        if (userIdStr.includes("@")) {
          query.userId = {
            $regex: `^${userIdStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            $options: "i",
          };
        } else {
          query.userId = userIdStr;
        }
      }
    }

    if (status) query.status = status;

    const invoices = await SalesInvoice.find(query).sort({
      createdAt: -1,
    }).lean();

    res.status(200).json(invoices);
  } catch (error) {
    console.error("Get sales invoices error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get invoice by ID
export const getSalesInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await SalesInvoice.findById(id).lean();

    if (!invoice) {
      return res
        .status(404)
        .json({ message: "Sales invoice not found" });
    }

    res.status(200).json(invoice);
  } catch (error) {
    console.error("Get sales invoice error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update invoice
export const updateSalesInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.body.userId;

    // Get user to check store access control
    if (userId) {
      const trimmedUserId = (userId || "").toString().trim();
      const userConditions = [
        { email: { $regex: new RegExp(`^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") } },
        { username: { $regex: new RegExp(`^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") } },
      ];
      if (mongoose.Types.ObjectId.isValid(trimmedUserId)) {
        userConditions.push({ _id: trimmedUserId });
      }

      let user = await User.findOne({ $or: userConditions });
      if (!user) {
        user = (await User.findOne({ power: "admin" })) || (await User.findOne());
      }
      if (!user) {
        user = {
          _id: new mongoose.Types.ObjectId(),
          username: userId || "Admin",
          email: userId || "admin@example.com",
          power: "admin",
          role: "admin",
          storeId: null,
        };
      }

      // Store-level access control: store users can only update their own store invoices
      if (user.role === "store_manager" || user.role === "store_user") {
        const userStore = user.storeName || user.username;
        if (req.body.branch && req.body.branch !== userStore) {
          return res.status(403).json({
            message: "You can only update invoices for your store",
            userStore: userStore,
            requestedStore: req.body.branch
          });
        }
      }
    }

    if (req.body.status) {
      req.body.status = req.body.status.toLowerCase();
    }
    if (req.body.returnStatus) {
      req.body.returnStatus = req.body.returnStatus.toLowerCase();
    }

    const oldInvoice = await SalesInvoice.findById(id).lean();
    if (!oldInvoice) {
      return res.status(404).json({ message: "Sales invoice not found" });
    }

    // Clients may not set the stock bookkeeping fields directly
    delete req.body.stockApplied;
    delete req.body.stockWarehouse;

    // Redemption figures are computed here, never taken from the client
    const requestedRedemptions = req.body.redemptions;
    const clientAmountDue = req.body.amountDue;
    delete req.body.redemptions;
    delete req.body.refundMode;
    stripServerFields(req.body);

    // A return-triggered update (original invoice trimmed after a return) must NOT move stock:
    // the separate RTN- invoice already put the returned pieces back.
    const isReturnUpdate = req.body.returnStatus === "partial" || req.body.returnStatus === "full";
    const isSaleEdit = !isReturnUpdate && !isReturnCategory(oldInvoice.category) && !isReturnCategory(req.body.category ?? oldInvoice.category);

    // Checks that need no writes, so a bad edit is refused before stock moves
    const sameRedemptions = (a, b) => JSON.stringify((a || []).map((r) => [r.type, String(r.refId || r.code || ""), Number(r.points) || 0, round2(r.amount)]))
      === JSON.stringify((b || []).map((r) => [r.type, String(r.refId || r.code || ""), Number(r.points) || 0, round2(r.amount)]));
    if (isSaleEdit && requestedRedemptions !== undefined) {
      if (!oldInvoice.loyaltyApplied && Array.isArray(requestedRedemptions) && requestedRedemptions.length) {
        return res.status(409).json({ message: "This invoice was created before loyalty and store credit existed, so redemptions cannot be added to it." });
      }
      if (oldInvoice.loyaltyApplied && ["partial", "full"].includes(oldInvoice.returnStatus)
        && !sameRedemptions(requestedRedemptions, oldInvoice.redemptions)) {
        return res.status(409).json({ message: "Items on this invoice were already returned, so its loyalty points and store credit can no longer be changed." });
      }
    }
    // Loyalty is redone on edit only for invoices created with it and not yet (partly) returned
    const redoLoyalty = isSaleEdit && oldInvoice.loyaltyApplied && !["partial", "full"].includes(oldInvoice.returnStatus);

    // ── STOCK: apply the difference between the old and the new invoice ──
    // Done as "undo old lines, apply new lines" so changes of quantity, item,
    // warehouse or category are all handled the same way. All-or-nothing.
    let undoOld = [];
    let applyNew = [];
    const linesChanged = Array.isArray(req.body.lineItems);
    const whChanged = (req.body.warehouse !== undefined || req.body.branch !== undefined);
    const catChanged = req.body.category !== undefined && isReturnCategory(req.body.category) !== isReturnCategory(oldInvoice.category);
    if (!isReturnUpdate && oldInvoice.stockApplied !== false && (linesChanged || whChanged || catChanged)) {
      const merged = { ...oldInvoice, ...req.body, stockWarehouse: undefined };
      const oldWh = invoiceWarehouse(oldInvoice);
      const newWh = invoiceWarehouse(merged);
      const newLines = linesChanged ? req.body.lineItems : oldInvoice.lineItems || [];
      try {
        undoOld = await applyLines(oldInvoice.lineItems || [], oldWh, -stockSign(oldInvoice.category));
        try {
          applyNew = await applyLines(newLines, newWh, stockSign(merged.category));
        } catch (err) {
          await undoMovements(undoOld);
          throw err;
        }
      } catch (err) {
        if (err instanceof StockError) return stockErrorResponse(res, err);
        throw err;
      }
      req.body.stockApplied = true;
      req.body.stockWarehouse = newWh;
    }

    const undo = new UndoStack();
    undo.push("stock: re-apply old lines", () => undoMovements(undoOld));
    undo.push("stock: remove new lines", () => undoMovements(applyNew));

    let invoice;
    let customer = null, earn = null;
    try {
      if (redoLoyalty) {
        // Reverse what the invoice applied, then apply the edited version from fresh balances
        await reverseInvoiceRedemptions({ invoice: oldInvoice, createdBy: userId, reason: `Invoice ${oldInvoice.invoiceNumber} edited`, undo });
        const merged = { ...oldInvoice, ...req.body };
        customer = await findOrCreateCustomer({ name: merged.customer, phone: merged.customerPhone, locCode: merged.locCode, createdBy: userId });
        const settings = await getLoyaltySettings(merged.locCode);
        const finalTotal = round2(Number(merged.finalTotal) || 0);
        const plan = await planRedemptions({
          requested: requestedRedemptions !== undefined ? requestedRedemptions : oldInvoice.redemptions,
          finalTotal, customer, settings,
          lines: Array.isArray(req.body.lineItems) ? req.body.lineItems : oldInvoice.lineItems,
          locCode: merged.locCode,
        });
        earn = computeEarn({ customer, finalTotal, plan, settings });
        Object.assign(req.body, {
          customerId: customer?._id || null,
          redemptions: plan.redemptions,
          totalRedeemed: plan.totalRedeemed,
          amountDue: round2(finalTotal - plan.totalRedeemed),
          loyaltyPointsUsed: plan.loyaltyPointsUsed,
          loyaltyPointsEarned: earn.earned,
          earnBase: earn.earnBase,
          loyaltyBaseTotal: finalTotal,
          loyaltyPointsRestored: 0,
          loyaltyPointsReversed: 0,
        });
        validatePayment({ ...merged, ...req.body }, clientAmountDue);
        await applyRedemptions({ plan, customer, invoiceId: oldInvoice._id, invoiceNumber: oldInvoice.invoiceNumber, createdBy: userId, undo });
      } else if (isSaleEdit && !oldInvoice.loyaltyApplied && req.body.customerPhone !== undefined) {
        // Older invoice: link it to the customer record when the phone is valid (no points, no checks)
        const phone = normalizePhone(req.body.customerPhone);
        if (phone) {
          const c = await findOrCreateCustomer({ name: req.body.customer ?? oldInvoice.customer, phone, locCode: oldInvoice.locCode, createdBy: userId });
          req.body.customerId = c?._id || null;
        }
      }
      if (Array.isArray(req.body.lineItems)) await snapshotLineCosts(req.body.lineItems, oldInvoice.lineItems || []);

      invoice = await SalesInvoice.findByIdAndUpdate(
        id,
        req.body,
        { new: true, runValidators: true }
      );
      if (!invoice) throw new HttpError(404, "Sales invoice not found");
      undo.push("restore invoice", () => SalesInvoice.replaceOne({ _id: oldInvoice._id }, oldInvoice));

      if (redoLoyalty) {
        await postEarn({ customer, earned: earn.earned, earnBase: earn.earnBase, invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, createdBy: userId, undo });
      }
    } catch (updateErr) {
      await undo.rollback();
      if (updateErr instanceof HttpError) return httpErrorResponse(res, updateErr);
      throw updateErr;
    }

    // ✅ UPDATE CORRESPONDING FINANCIAL TRANSACTION
    // Skip payment field updates when this is a return-triggered update (returnStatus set)
    // to preserve the original invoice's cash/bank/upi/amount in the day book
    try {
      if (isReturnUpdate) {
        // Do NOT update billValue on the original invoice's transaction when a return is processed.
        // The original transaction should always reflect the original sale amount collected.
        // The return transaction (RTN-) separately records the refund amount.
        console.log("✅ Return update detected - preserving original transaction billValue and payment amounts");
      } else {
        await updateFinancialTransaction(invoice);
        console.log("✅ Financial transaction updated successfully");
      }
    } catch (transactionError) {
      console.error("❌ Error updating financial transaction:", transactionError);
      // Don't fail the invoice update if transaction update fails
    }

    res.status(200).json(invoice);
  } catch (error) {
    console.error("Update sales invoice error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete invoice - MODIFIED TO PREVENT DELETION OF RETURN/REFUND/CANCEL INVOICES
export const deleteSalesInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.body?.userId || req.query?.userId;

    // Get user to check store access control
    if (userId) {
      const trimmedUserId = (userId || "").toString().trim();
      const userConditions = [
        { email: { $regex: new RegExp(`^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") } },
        { username: { $regex: new RegExp(`^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}$`, "i") } },
      ];
      if (mongoose.Types.ObjectId.isValid(trimmedUserId)) {
        userConditions.push({ _id: trimmedUserId });
      }

      let user = await User.findOne({ $or: userConditions });
      if (!user) {
        user = (await User.findOne({ power: "admin" })) || (await User.findOne());
      }
      if (!user) {
        user = {
          _id: new mongoose.Types.ObjectId(),
          username: userId || "Admin",
          email: userId || "admin@example.com",
          power: "admin",
          role: "admin",
          storeId: null,
        };
      }

      // Store-level access control: store users can only delete their own store invoices
      if (user.role === "store_manager" || user.role === "store_user") {
        const invoice = await SalesInvoice.findById(id);
        if (invoice) {
          const userStore = user.storeName || user.username;
          if (invoice.branch !== userStore) {
            return res.status(403).json({
              message: "You can only delete invoices for your store",
              userStore: userStore,
              invoiceStore: invoice.branch
            });
          }
        }
      }
    }

    // Get invoice before deleting to access line items for stock reversal
    const invoiceToDelete = await SalesInvoice.findById(id);

    if (!invoiceToDelete) {
      return res
        .status(404)
        .json({ message: "Sales invoice not found" });
    }

    // ✅ PREVENT DELETION OF RETURN/REFUND/CANCEL INVOICES
    const categoryLower = (invoiceToDelete.category || "").toLowerCase().trim();
    const isReturnRefundCancel = ["return", "refund", "cancel"].includes(categoryLower);
    
    // Also check invoice number prefix (RTN-, RET-, REFUND-, CANCEL-)
    const invoiceNumber = (invoiceToDelete.invoiceNumber || "").toUpperCase();
    const hasReturnPrefix = invoiceNumber.startsWith("RTN-") || 
                           invoiceNumber.startsWith("RET-") || 
                           invoiceNumber.startsWith("REFUND-") || 
                           invoiceNumber.startsWith("CANCEL-");
    
    if (isReturnRefundCancel || hasReturnPrefix) {
      console.log(`⚠️ Cannot delete ${categoryLower || "return/refund/cancel"} invoice: ${invoiceToDelete.invoiceNumber}`);
      console.log(`💡 Return/Refund/Cancel invoices should remain in the system for audit trail`);
      return res.status(403).json({ 
        message: `Cannot delete return/refund/cancel invoices. They must remain in the system for financial records.`,
        suggestion: "Create a separate return invoice instead of deleting the original."
      });
    }

    // ✅ PUT THE SOLD PIECES BACK INTO STOCK (every sale category, not only bookings),
    // in the same warehouse they were taken from. If this fails the invoice is NOT deleted,
    // so stock and invoices can never drift apart.
    let restored = [];
    if (invoiceToDelete.stockApplied !== false && invoiceToDelete.lineItems?.length > 0) {
      try {
        restored = await applyLines(invoiceToDelete.lineItems, invoiceWarehouse(invoiceToDelete), 1);
      } catch (stockError) {
        if (stockError instanceof StockError) return stockErrorResponse(res, stockError);
        throw stockError;
      }
      try {
        await applyVendorAllocations(invoiceToDelete.lineItems, 1);
      } catch (e) {
        console.error("Vendor allocation reversal error:", e.message);
      }
    }

    // ✅ GIVE BACK loyalty points / store credit the invoice used and take back points it earned
    const undo = new UndoStack();
    undo.push("stock", () => undoMovements(restored));
    try {
      await reverseInvoiceRedemptions({
        invoice: invoiceToDelete.toObject(),
        createdBy: userId || "",
        reason: `Invoice ${invoiceToDelete.invoiceNumber} deleted`,
        undo,
      });
    } catch (loyaltyErr) {
      await undo.rollback();
      if (loyaltyErr instanceof HttpError) return httpErrorResponse(res, loyaltyErr);
      throw loyaltyErr;
    }

    // ✅ DELETE ASSOCIATED TRANSACTION RECORD (only for non-return invoices)
    try {
      console.log(`🔍 Deleting transaction for invoice: "${invoiceToDelete.invoiceNumber}"`);
      const transactionResult = await Transaction.deleteOne({ invoiceNo: invoiceToDelete.invoiceNumber });
      console.log(`✅ Transaction deletion result:`, transactionResult);
      if (transactionResult.deletedCount > 0) {
        console.log(`✅ Transaction record deleted for invoice: ${invoiceToDelete.invoiceNumber}`);
      } else {
        console.log(`⚠️ No transaction found with invoiceNo: ${invoiceToDelete.invoiceNumber}`);
      }
    } catch (transactionError) {
      console.error("❌ Error deleting transaction:", transactionError);
      // Don't fail the deletion if transaction deletion fails
    }

    try {
      await SalesInvoice.findByIdAndDelete(id);
    } catch (deleteErr) {
      await undo.rollback(); // invoice still exists → take the stock out again and re-apply its redemptions
      throw deleteErr;
    }

    res
      .status(200)
      .json({ message: "Sales invoice deleted successfully" });
  } catch (error) {
    console.error("Delete sales invoice error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
