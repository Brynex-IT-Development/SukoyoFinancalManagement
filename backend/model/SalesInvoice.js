import mongoose from "mongoose";

const salesInvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
    },
    invoiceDate: {
      type: Date,
      required: true,
    },
    dueDate: {
      type: Date,
      required: false,
    },
    customer: {
      type: String,
      required: true,
    },
    customerPhone: {
      type: String,
      default: "",
    },
    branch: {
      type: String,
      default: "Head Office",
    },
    orderNumber: {
      type: String,
      default: "",
    },
    terms: {
      type: String,
      default: "Due on Receipt",
    },
    salesperson: {
      type: String,
      default: "",
    },
    subject: {
      type: String,
      default: "",
    },
    warehouse: {
      type: String,
      default: "",
    },
    // true once this invoice's line items have been taken out of (or, for returns, put back into) stock.
    // Missing on invoices created before this flag existed — those are treated as applied.
    stockApplied: {
      type: Boolean,
    },
    // Warehouse the stock was actually moved in (so edit/delete reverse in the same place)
    stockWarehouse: {
      type: String,
    },
    category: {
      type: String,
      default: "",
    },
    subCategory: {
      type: String,
      default: "",
    },
    paymentMethod: {
      type: String,
      default: "",
    },
    isSplitPayment: {
      type: Boolean,
      default: false,
    },
    splitPaymentAmounts: {
      cash: {
        type: String,
        default: "",
      },
      bank: {
        type: String,
        default: "",
      },
      upi: {
        type: String,
        default: "",
      },
      rbl: {
        type: String,
        default: "",
      },
    },
    lineItems: [
      {
        item: String,
        itemData: mongoose.Schema.Types.Mixed,
        itemGroupId: String,
        itemSku: String,
        // Vendor this piece is taken from (e.g. "HMC") when one SKU is stocked from several vendors
        vendorCode: String,
        // How the line's quantity was taken per vendor, e.g. [{ vendorCode: "HMC", quantity: 3 }, { vendorCode: "UMC", quantity: 2 }]
        vendorAllocations: [{ vendorCode: String, quantity: Number, _id: false }],
        size: String,
        quantity: Number,
        rate: Number,
        tax: String,
        amount: Number,
        // Item cost at the time of sale (snapshot for profit reports)
        costPrice: Number,
      },
    ],
    // ── Customer & redemptions (loyalty / store credit / gift card / voucher) ──
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    redemptions: [
      {
        _id: false,
        type: { type: String, enum: ["loyalty", "storeCredit", "giftCard", "voucher"] },
        refId: { type: mongoose.Schema.Types.ObjectId, default: null },
        code: { type: String, default: "" },
        points: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
      },
    ],
    totalRedeemed: { type: Number, default: 0 },
    // Money actually to be received = finalTotal − totalRedeemed (negative = refund paid out on a return)
    amountDue: { type: Number },
    loyaltyPointsEarned: { type: Number, default: 0 },
    loyaltyPointsUsed: { type: Number, default: 0 },
    earnBase: { type: Number, default: 0 },
    // true once loyalty/redemptions were processed for this invoice (absent on older invoices)
    loyaltyApplied: { type: Boolean },
    // finalTotal at the time redemptions were applied. Return proportions use this, because
    // the invoice's own finalTotal is reduced after a partial return.
    loyaltyBaseTotal: { type: Number },
    // How much of the above later returns have already restored / reversed (caps rounding over several returns)
    loyaltyPointsRestored: { type: Number, default: 0 },
    loyaltyPointsReversed: { type: Number, default: 0 },
    // On a return invoice: how the refund was paid out
    refundBreakdown: {
      mode: { type: String, enum: ["cash", "storeCredit"] },
      returnValue: Number,
      refundable: Number,
      cashRefund: Number,
      storeCreditAmount: Number,
      nonRefundable: Number,
      pointsRestored: Number,
      pointsReversed: Number,
      storeCreditId: { type: mongoose.Schema.Types.ObjectId },
      storeCreditNumber: String,
    },
    customerNotes: {
      type: String,
      default: "Thanks for your business.",
    },
    remark: {
      type: String,
      default: "",
    },
    termsAndConditions: {
      type: String,
      default: "",
    },
    discount: {
      value: { type: String, default: "0" },
      type: { type: String, default: "%" },
    },
    applyDiscountAfterTax: {
      type: Boolean,
      default: false,
    },
    tdsTcsType: {
      type: String,
      enum: ["TDS", "TCS"],
      default: "TDS",
    },
    tdsTcsTax: {
      type: String,
      default: "",
    },
    adjustment: {
      type: String,
      default: "0.00",
    },
    subTotal: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    totalTax: {
      type: Number,
      default: 0,
    },
    tdsTcsAmount: {
      type: Number,
      default: 0,
    },
    adjustmentAmount: {
      type: Number,
      default: 0,
    },
    finalTotal: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "sent", "paid", "overdue", "Draft", "Sent", "Paid", "Overdue", "closed", "Closed"],
      default: "draft",
    },
    returnStatus: {
      type: String,
      enum: ["none", "partial", "full", "None", "Partial", "Full"],
      default: "none",
    },
    originalInvoiceId: {
      type: String,
      default: "",
    },
    originalInvoiceNumber: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
    userId: {
      type: String,
      required: true,
    },
    locCode: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Performance Indexes
salesInvoiceSchema.index({ userId: 1, createdAt: -1 });
salesInvoiceSchema.index({ invoiceNumber: 1 });
salesInvoiceSchema.index({ locCode: 1, invoiceDate: -1 });
salesInvoiceSchema.index({ status: 1, invoiceDate: -1 });
salesInvoiceSchema.index({ warehouse: 1, createdAt: -1 });
salesInvoiceSchema.index({ branch: 1, createdAt: -1 });
salesInvoiceSchema.index({ customer: 1 });
salesInvoiceSchema.index({ customerId: 1, invoiceDate: -1 });
salesInvoiceSchema.index({ createdAt: -1 });
salesInvoiceSchema.index({ invoiceDate: -1 });

const SalesInvoice = mongoose.model("SalesInvoice", salesInvoiceSchema);
export default SalesInvoice;

