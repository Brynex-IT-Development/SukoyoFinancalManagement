import express from "express";
import { billWiseProfit, billProfitDetail } from "../controllers/BillProfitController.js";

const router = express.Router();

// Bill-wise profit (F12)
router.get("/profit-reports/bills", billWiseProfit);
router.get("/profit-reports/bills/:id", billProfitDetail);

export default router;
