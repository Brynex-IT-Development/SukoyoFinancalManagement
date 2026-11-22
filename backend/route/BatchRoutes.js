import express from "express";
import { listItemBatches, expiringBatches, reconcileBatchesNow, batchManagedItems } from "../controllers/BatchController.js";

const router = express.Router();

// Batch & expiry (F18)
router.get("/batches", listItemBatches);
router.get("/batches/expiring", expiringBatches);
router.get("/batches/managed", batchManagedItems);
router.post("/batches/reconcile", reconcileBatchesNow);

export default router;
