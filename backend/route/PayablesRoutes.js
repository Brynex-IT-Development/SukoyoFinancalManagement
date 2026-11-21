import express from "express";
import {
  listVendorPayments, getOpenBills, createVendorPayment, getVendorPayment, deleteVendorPayment,
} from "../controllers/VendorPaymentController.js";

const router = express.Router();

// Vendor payments (F9) — fixed paths before /:id
router.get("/vendor-payments", listVendorPayments);
router.post("/vendor-payments", createVendorPayment);
router.get("/vendor-payments/open-bills", getOpenBills);
router.get("/vendor-payments/:id", getVendorPayment);
router.delete("/vendor-payments/:id", deleteVendorPayment);

export default router;
