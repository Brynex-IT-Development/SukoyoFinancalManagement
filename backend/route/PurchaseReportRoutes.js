import express from "express";
import { purchaseSummary, purchasesByItemVendor, gstPurchaseRegister } from "../controllers/PurchaseReportController.js";

const router = express.Router();

// Purchase reports (F13)
router.get("/purchase-reports/summary", purchaseSummary);
router.get("/purchase-reports/items-by-vendor", purchasesByItemVendor);
router.get("/purchase-reports/gst-register", gstPurchaseRegister);

export default router;
