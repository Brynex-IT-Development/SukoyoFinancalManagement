import express from "express";
import {
  listEnquiries, createEnquiry, getEnquiry, updateEnquiry, changeEnquiryStatus, searchEnquiryItems,
} from "../controllers/EnquiryController.js";

const router = express.Router();

// Enquiries (F16) — fixed paths before /:id
router.get("/enquiries", listEnquiries);
router.post("/enquiries", createEnquiry);
router.get("/enquiries/items", searchEnquiryItems);
router.get("/enquiries/:id", getEnquiry);
router.put("/enquiries/:id", updateEnquiry);
router.post("/enquiries/:id/status", changeEnquiryStatus);

export default router;
