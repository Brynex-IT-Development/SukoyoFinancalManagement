import express from "express";
import { profitAndLoss, profitStock } from "../controllers/ProfitLossController.js";

const router = express.Router();

// Profit & loss (F11)
router.get("/profit-reports/pnl", profitAndLoss);
router.get("/profit-reports/pnl/stock", profitStock);

export default router;
