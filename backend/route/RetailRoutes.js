import express from "express";
import {
  listCustomers, lookupCustomer, getCustomer, createCustomer, updateCustomer, setCustomerStatus, adjustLoyalty,
} from "../controllers/CustomerController.js";
import { getSettings, saveSettings, removeStoreOverride } from "../controllers/LoyaltyController.js";
import {
  listStoreCredits, getStoreCredit, voidStoreCredit, getStoreCreditSettings, saveStoreCreditSettings, checkRedemption,
} from "../controllers/StoreCreditController.js";
import {
  listGiftCards, issueGiftCards, getGiftCard, getGiftCardBatch, reloadGiftCard, setGiftCardBlocked,
} from "../controllers/GiftCardController.js";
import {
  listVouchers, createVouchers, getVoucher, getVoucherBatch, getScopeOptions, setVoucherActive,
} from "../controllers/VoucherController.js";
import { getCompanyProfileApi, saveCompanyProfile, lookupGstin, listBusinessCustomers } from "../controllers/GstController.js";

const router = express.Router();

// Customers (F1)
router.get("/customers", listCustomers);
router.post("/customers", createCustomer);
router.get("/customers/lookup", lookupCustomer); // before /customers/:id
router.get("/customers/:id", getCustomer);
router.put("/customers/:id", updateCustomer);
router.patch("/customers/:id/status", setCustomerStatus);
router.post("/customers/:id/loyalty-adjust", adjustLoyalty);

// Loyalty settings (F2)
router.get("/loyalty/settings", getSettings);
router.post("/loyalty/settings", saveSettings);
router.post("/loyalty/settings/remove-override", removeStoreOverride);

// Store credit (F3)
router.get("/store-credits", listStoreCredits);
router.get("/store-credits/settings", getStoreCreditSettings); // before /store-credits/:id
router.put("/store-credits/settings", saveStoreCreditSettings);
router.get("/store-credits/:id", getStoreCredit);
router.post("/store-credits/:id/void", voidStoreCredit);

// Gift cards (F4)
router.get("/gift-cards", listGiftCards);
router.post("/gift-cards/issue", issueGiftCards);
router.get("/gift-cards/batch/:saleRef", getGiftCardBatch); // before /gift-cards/:id
router.get("/gift-cards/:id", getGiftCard);
router.post("/gift-cards/:id/reload", reloadGiftCard);
router.post("/gift-cards/:id/block", setGiftCardBlocked);

// Vouchers (F5)
router.get("/vouchers", listVouchers);
router.post("/vouchers", createVouchers);
router.get("/vouchers/scope-options", getScopeOptions); // before /vouchers/:id
router.get("/vouchers/batch/:batchRef", getVoucherBatch);
router.get("/vouchers/:id", getVoucher);
router.patch("/vouchers/:id/active", setVoucherActive);

// Company profile (F7) and business GST invoices (F8)
router.get("/company-profile", getCompanyProfileApi);
router.put("/company-profile", saveCompanyProfile);
router.get("/gst/gstin/:gstin", lookupGstin);
router.get("/business-customers", listBusinessCustomers);

// Billing screen "Apply" panel — preview what can be redeemed
router.post("/redemptions/check", checkRedemption);

export default router;
