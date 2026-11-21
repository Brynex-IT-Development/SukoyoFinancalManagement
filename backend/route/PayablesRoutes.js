import express from "express";
import {
  listVendorPayments, getOpenBills, createVendorPayment, getVendorPayment, deleteVendorPayment,
} from "../controllers/VendorPaymentController.js";
import { vendorOutstanding, vendorBills, vendorAging, vendorStatement } from "../controllers/VendorReportController.js";

const router = express.Router();

// Vendor payments (F9) — fixed paths before /:id
router.get("/vendor-payments", listVendorPayments);
router.post("/vendor-payments", createVendorPayment);
router.get("/vendor-payments/open-bills", getOpenBills);
router.get("/vendor-payments/:id", getVendorPayment);
router.delete("/vendor-payments/:id", deleteVendorPayment);

// Vendor outstanding, aging and statement (F10)
router.get("/vendor-reports/outstanding", vendorOutstanding);
router.get("/vendor-reports/vendor-bills", vendorBills);
router.get("/vendor-reports/aging", vendorAging);
router.get("/vendor-reports/statement", vendorStatement);

export default router;
