import express from "express";
import {
  listBankAccounts, createBankAccount, getBankAccount, updateBankAccount, listBankTransfers, createBankTransfer,
} from "../controllers/BankController.js";

const router = express.Router();

// Bank accounts and transfers (F17) — admin only
router.get("/bank-accounts", listBankAccounts);
router.post("/bank-accounts", createBankAccount);
router.get("/bank-accounts/:id", getBankAccount);
router.put("/bank-accounts/:id", updateBankAccount);
router.get("/bank-transfers", listBankTransfers);
router.post("/bank-transfers", createBankTransfer);

export default router;
