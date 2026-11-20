import express from "express";
import {
  createSalesInvoice,
  getSalesInvoices,
  getSalesInvoiceById,
  updateSalesInvoice,
  deleteSalesInvoice,
  getNextInvoiceNumber,
  previewInvoiceReturn,
} from "../controllers/SalesInvoiceController.js";

const router = express.Router();

router
  .route("/sales/invoices")
  .get(getSalesInvoices)
  .post(createSalesInvoice);

router
  .route("/sales/invoices/:id")
  .get(getSalesInvoiceById)
  .put(updateSalesInvoice)
  .delete(deleteSalesInvoice);

// ✔ Added working route for next invoice number
router.post("/sales/invoices/next-number", getNextInvoiceNumber);

// Preview how a return would be refunded (cash / store credit / points)
router.post("/sales/invoices/:id/return-preview", previewInvoiceReturn);

export default router;


