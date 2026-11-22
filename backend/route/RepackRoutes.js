import express from "express";
import { createRepack, deleteRepack, listRepacks, getRepack, searchRepackItems } from "../controllers/RepackController.js";

const router = express.Router();

// Repacking (F19) — fixed paths before /:id
router.get("/repacks", listRepacks);
router.post("/repacks", createRepack);
router.get("/repacks/items", searchRepackItems);
router.get("/repacks/:id", getRepack);
router.delete("/repacks/:id", deleteRepack);

export default router;
