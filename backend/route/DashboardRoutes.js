import express from "express";
import { getDashboardSummary } from "../controllers/DashboardController.js";

const router = express.Router();
router.get("/dashboard/summary", getDashboardSummary);

export default router;
