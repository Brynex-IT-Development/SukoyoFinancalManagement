import express from "express";
import { deadStockReport, overstockReport, abcReport, updateStockSettings } from "../controllers/StockHealthController.js";

const router = express.Router();

// Stock health (F14)
router.get("/stock-health/dead", deadStockReport);
router.get("/stock-health/overstock", overstockReport);
router.get("/stock-health/abc", abcReport);
router.patch("/stock-health/items/:id", updateStockSettings);

export default router;
