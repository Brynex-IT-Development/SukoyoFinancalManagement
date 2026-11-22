import mongoose from "mongoose";

const ShoeItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["goods", "service"],
      default: "goods",
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      trim: true,
    },
    itemCode: {
      type: String,
      trim: true,
      default: "",
    },
    unit: {
      type: String,
      trim: true,
    },
    hsnCode: {
      type: String,
      trim: true,
    },
    manufacturer: {
      type: String,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: ["shirt", "shoe", "other"],
      default: "other",
      trim: true,
    },
    returnable: {
      type: Boolean,
      default: false,
    },
  sellable: {
    type: Boolean,
    default: true,
  },
  purchasable: {
    type: Boolean,
    default: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
    taxPreference: {
      type: String,
      enum: ["taxable", "non-taxable"],
      default: "taxable",
    },
    dimensions: {
      type: String,
      trim: true,
    },
    weight: {
      type: String,
      trim: true,
    },
    upc: {
      type: String,
      trim: true,
    },
    mpn: {
      type: String,
      trim: true,
    },
    ean: {
      type: String,
      trim: true,
    },
    isbn: {
      type: String,
      trim: true,
    },
    size: {
      type: String,
      trim: true,
    },
    inventoryValuationMethod: {
      type: String,
      trim: true,
    },
    sellingPrice: {
      type: Number,
      default: 0,
    },
    mrp: {
      type: Number,
      default: 0,
    },
    salesAccount: {
      type: String,
      trim: true,
    },
    salesDescription: {
      type: String,
      trim: true,
    },
    costPrice: {
      type: Number,
      default: 0,
    },
    costAccount: {
      type: String,
      trim: true,
    },
    preferredVendor: {
      type: String,
      trim: true,
    },
    purchaseDescription: {
      type: String,
      trim: true,
    },
    taxRateIntra: {
      type: String,
      trim: true,
    },
    taxRateInter: {
      type: String,
      trim: true,
    },
    trackInventory: {
      type: Boolean,
      default: false,
    },
    trackBin: {
      type: Boolean,
      default: false,
    },
    trackingMethod: {
      type: String,
      enum: ["none", "serial", "batch"],
      default: "none",
    },
    inventoryAccount: {
      type: String,
      trim: true,
    },
    inventoryValuation: {
      type: String,
      trim: true,
    },
    reorderPoint: {
      type: String,
      trim: true,
    },
    // Stock health (F14): stock above this is overstock (null = not set); manual ABC class ("" = computed)
    maxStock: { type: Number, default: null, min: 0 },
    abcOverride: { type: String, enum: ["", "A", "B", "C"], default: "" },
    warehouseStocks: [{
      warehouse: {
        type: String,
        trim: true,
      },
      openingStock: {
        type: Number,
        default: 0,
      },
      openingStockValue: {
        type: Number,
        default: 0,
      },
      stockOnHand: {
        type: Number,
        default: 0,
      },
      committedStock: {
        type: Number,
        default: 0,
      },
      availableForSale: {
        type: Number,
        default: 0,
      },
      // Physical stock fields - independent from accounting stock
      physicalOpeningStock: {
        type: Number,
        default: 0,
      },
      physicalStockOnHand: {
        type: Number,
        default: 0,
      },
      physicalCommittedStock: {
        type: Number,
        default: 0,
      },
      physicalAvailableForSale: {
        type: Number,
        default: 0,
      },
    }],
    images: [
      {
        filename: {
          type: String,
          default: "image",
        },
        contentType: {
          type: String,
          default: "image/jpeg",
        },
        data: String, // Base64 string
      },
    ],
    image: {
      type: String, // Base64 string or URL
      trim: true,
    },
    // Vendor price tracking - same item from different vendors with different MRPs
    vendorPrices: [{
      vendorCode: {
        type: String,
        trim: true,
      },
      vendorName: {
        type: String,
        trim: true,
      },
      mrp: {
        type: Number,
        default: 0,
      },
      costPrice: {
        type: Number,
        default: 0,
      },
      // Total pieces received from this vendor (via bills)
      quantity: {
        type: Number,
        default: 0,
      },
      lastPurchaseDate: {
        type: Date,
        default: Date.now,
      },
    }],
    // Original item name as given by vendor (e.g. "SN-10-440-PSP(HMC) STICKY NOTES")
    vendorItemNames: [{
      vendorCode: { type: String, trim: true },
      originalName: { type: String, trim: true },
    }],
    createdBy: {
      type: String,
      trim: true,
    },

    // ---- Fields captured by the New/Edit Item form (ItemFormNew.jsx) ----
    printName: { type: String, trim: true },
    // `category` is restricted to shirt/shoe/other, so the picked label lives here.
    itemCategory: { type: String, trim: true },
    subCategory: { type: String, trim: true },
    subBrand: { type: String, trim: true },
    description: { type: String }, // rich-text HTML from the description editor
    purchaseTax: { type: String, trim: true },
    salesTax: { type: String, trim: true },
    purchaseInclusive: { type: Boolean, default: false },
    salesInclusive: { type: Boolean, default: true },
    cess: { type: Boolean, default: false },
    manageBatch: { type: Boolean, default: false },
    purchasePrice: { type: Number },
    landingCost: { type: Number },
    sellingDiscount: { type: Number },
    sellingMargin: { type: Number },
    membershipMargin: { type: Number },
    openingQty: { type: Number },
    netWeight: { type: Number },
  },
  {
    timestamps: true,
  }
);

// Performance Indexes
ShoeItemSchema.index({ sku: 1 });
ShoeItemSchema.index({ itemName: 1 });
ShoeItemSchema.index({ category: 1 });
ShoeItemSchema.index({ brand: 1 });
ShoeItemSchema.index({ manufacturer: 1 });
ShoeItemSchema.index({ createdAt: -1 });
ShoeItemSchema.index({ "warehouseStocks.warehouse": 1 }); // was "stockByWarehouse.warehouse", a field that does not exist

const ShoeItem = mongoose.model("ShoeItem", ShoeItemSchema);

export default ShoeItem;

