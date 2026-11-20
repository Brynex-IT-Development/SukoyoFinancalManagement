import express from "express";
import {
  listCustomers, lookupCustomer, getCustomer, createCustomer, updateCustomer, setCustomerStatus, adjustLoyalty,
} from "../controllers/CustomerController.js";
import { getSettings, saveSettings, removeStoreOverride } from "../controllers/LoyaltyController.js";
import {
  listStoreCredits, getStoreCredit, voidStoreCredit, getStoreCreditSettings, saveStoreCreditSettings, checkRedemption,
} from "../controllers/StoreCreditController.js";

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

// Billing screen "Apply" panel — preview what can be redeemed
router.post("/redemptions/check", checkRedemption);

export default router;
