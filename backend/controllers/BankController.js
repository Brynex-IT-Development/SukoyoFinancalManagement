// F17: Bank accounts and transfers — admin only. A register of the business's accounts; it does NOT
// post to the daybook, and the daybook does not change these balances (see the note on the screen).
import mongoose from "mongoose";
import BankAccount from "../model/BankAccount.js";
import BankTransfer from "../model/BankTransfer.js";
import { requireUser } from "../utils/userScope.js";
import { HttpError, UndoStack } from "../utils/redemptions.js";
import { nextNumber } from "../utils/nextNumber.js";
import { istDateString } from "../utils/ist.js";
import { maskAccountNumber, cleanAccountNumber, isValidAccountNumber, isValidIfsc, isValidUpi, parseAmount } from "../utils/bank.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const labelOf = (a) => `${a.bankName} · ${maskAccountNumber(a.accountNumber)}`;
// Balance arithmetic in the database, rounded to paise so repeated transfers never drift
const addToBalance = (amt) => [{ $set: { balance: { $round: [{ $add: ["$balance", amt] }, 2] } } }];

const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err?.code === 11000) return res.status(409).json({ message: "An account with this account number and IFSC is already registered." });
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

const listRow = (a) => ({
  _id: a._id, bankName: a.bankName, accountHolder: a.accountHolder, accountNumberMasked: maskAccountNumber(a.accountNumber),
  ifsc: a.ifsc || "", branch: a.branch || "", upiId: a.upiId || "", openingBalance: a.openingBalance, balance: a.balance, active: a.active !== false,
});

/** Validated account details from a request body (partial for edits). */
const accountFields = (b, { partial = false } = {}) => {
  const set = {};
  for (const [k, label] of [["bankName", "bank name"], ["accountHolder", "account holder"]]) {
    if (!partial || b[k] !== undefined) {
      set[k] = clean(b[k], 120);
      if (!set[k]) throw new HttpError(400, `Enter the ${label}.`);
    }
  }
  if (!partial || b.accountNumber !== undefined) {
    if (!isValidAccountNumber(b.accountNumber)) throw new HttpError(400, "Account number must be 6–20 letters or digits.");
    set.accountNumber = cleanAccountNumber(b.accountNumber);
  }
  if (b.ifsc !== undefined) {
    const v = clean(b.ifsc, 11).toUpperCase();
    if (!isValidIfsc(v)) throw new HttpError(400, "IFSC must look like SBIN0070123 (4 letters, 0, 6 letters/digits).");
    set.ifsc = v;
  }
  if (b.upiId !== undefined) {
    const v = clean(b.upiId, 100);
    if (!isValidUpi(v)) throw new HttpError(400, "UPI ID must look like name@bank.");
    set.upiId = v;
  }
  if (b.branch !== undefined) set.branch = clean(b.branch, 120);
  if (b.active !== undefined) set.active = b.active === true || b.active === "true";
  return set;
};

// GET /api/bank-accounts?userId= — list (account numbers masked) with the total balance
export const listBankAccounts = async (req, res) => {
  try {
    if (!(await requireUser(req, res, { admin: true }))) return;
    const accounts = await BankAccount.find({}).sort({ active: -1, bankName: 1 }).lean();
    res.json({
      accounts: accounts.map(listRow),
      totalBalance: Math.round(accounts.filter((a) => a.active !== false).reduce((s, a) => s + (a.balance || 0), 0) * 100) / 100,
    });
  } catch (err) { fail(res, err, "List bank accounts"); }
};

// POST /api/bank-accounts  body { userId, bankName, accountHolder, accountNumber, ifsc?, branch?, upiId?, openingBalance? }
export const createBankAccount = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const set = accountFields(req.body);
    const opening = req.body.openingBalance === undefined || req.body.openingBalance === "" ? 0 : parseAmount(req.body.openingBalance, { allowZero: true });
    if (opening === null) throw new HttpError(400, "Opening balance must be 0 or more, with at most two decimals.");
    const doc = await BankAccount.create({ ...set, openingBalance: opening, balance: opening, active: true, createdBy: who.user.email || "" });
    res.status(201).json(listRow(doc.toObject()));
  } catch (err) { fail(res, err, "Create bank account"); }
};

// GET /api/bank-accounts/:id?userId= — full details (unmasked, for editing) and recent transfers
export const getBankAccount = async (req, res) => {
  try {
    if (!(await requireUser(req, res, { admin: true }))) return;
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid account id.");
    const a = await BankAccount.findById(req.params.id).lean();
    if (!a) throw new HttpError(404, "Account not found.");
    const transfers = await BankTransfer.find({ $or: [{ fromAccountId: a._id }, { toAccountId: a._id }] }).sort({ date: -1, createdAt: -1 }).limit(50).lean();
    res.json({ ...listRow(a), accountNumber: a.accountNumber, transfers });
  } catch (err) { fail(res, err, "Get bank account"); }
};

// PUT /api/bank-accounts/:id  body { userId, ...details, openingBalance?, active? }
// Changing the opening balance moves the current balance by the same amount (never below zero).
export const updateBankAccount = async (req, res) => {
  try {
    if (!(await requireUser(req, res, { admin: true }))) return;
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid account id.");
    const a = await BankAccount.findById(req.params.id).lean();
    if (!a) throw new HttpError(404, "Account not found.");
    const set = accountFields(req.body, { partial: true });
    // User values go into an update pipeline: wrap them so "$…" text is never read as a field path
    const lit = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }]));
    let pipeline = [{ $set: lit }];
    const filter = { _id: a._id };
    if (req.body.openingBalance !== undefined && req.body.openingBalance !== "") {
      const opening = parseAmount(req.body.openingBalance, { allowZero: true });
      if (opening === null) throw new HttpError(400, "Opening balance must be 0 or more, with at most two decimals.");
      const delta = Math.round((opening - (a.openingBalance || 0)) * 100) / 100;
      if (delta !== 0) {
        Object.assign(filter, { openingBalance: a.openingBalance, $expr: { $gte: [{ $add: ["$balance", delta] }, 0] } });
        pipeline = [{ $set: { ...lit, openingBalance: { $literal: opening }, balance: { $round: [{ $add: ["$balance", delta] }, 2] } } }];
      }
    }
    if (!Object.keys(pipeline[0].$set).length) throw new HttpError(400, "Nothing to change.");
    const r = await BankAccount.updateOne(filter, pipeline);
    if (!r.matchedCount) throw new HttpError(409, `Not saved: lowering the opening balance by that much would take ${a.bankName}'s balance below zero (balance ${rupees(a.balance)}), or the account was changed meanwhile.`);
    res.json(listRow(await BankAccount.findById(a._id).lean()));
  } catch (err) { fail(res, err, "Update bank account"); }
};

// GET /api/bank-transfers?userId=&accountId=&fromDate=&toDate=
export const listBankTransfers = async (req, res) => {
  try {
    if (!(await requireUser(req, res, { admin: true }))) return;
    const q = req.query;
    const filter = {};
    if (q.accountId) {
      if (!isId(q.accountId)) throw new HttpError(400, "Invalid account id.");
      filter.$or = [{ fromAccountId: q.accountId }, { toAccountId: q.accountId }];
    }
    if (q.fromDate || q.toDate) {
      filter.date = {};
      if (q.fromDate) filter.date.$gte = String(q.fromDate);
      if (q.toDate) filter.date.$lte = String(q.toDate);
    }
    const transfers = await BankTransfer.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
    res.json({ transfers, total: Math.round(transfers.reduce((s, t) => s + t.amount, 0) * 100) / 100 });
  } catch (err) { fail(res, err, "List bank transfers"); }
};

// POST /api/bank-transfers  body { userId, fromAccountId, toAccountId, date, amount, notes? }
// from ≠ to, amount > 0, from.balance ≥ amount: conditional atomic decrement, then the increment;
// the decrement is rolled back if the increment (or saving the record) fails.
export const createBankTransfer = async (req, res) => {
  const undo = new UndoStack();
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const { fromAccountId, toAccountId } = req.body;
    if (!isId(fromAccountId) || !isId(toAccountId)) throw new HttpError(400, "Choose both accounts.");
    if (String(fromAccountId) === String(toAccountId)) throw new HttpError(400, "The two accounts must be different.");
    const amount = parseAmount(req.body.amount);
    if (amount === null) throw new HttpError(400, "Amount must be more than 0, with at most two decimals.");
    const date = req.body.date || istDateString();
    if (!isDay(date)) throw new HttpError(400, "Date must be YYYY-MM-DD.");
    if (date > istDateString()) throw new HttpError(400, "A transfer cannot be dated in the future.");
    const [from, to] = await Promise.all([BankAccount.findById(fromAccountId).lean(), BankAccount.findById(toAccountId).lean()]);
    if (!from || !to) throw new HttpError(404, "Account not found.");
    if (from.active === false || to.active === false) throw new HttpError(409, `${from.active === false ? from.bankName : to.bankName} is inactive.`);

    const dec = await BankAccount.updateOne({ _id: from._id, active: true, $expr: { $gte: ["$balance", amount] } }, addToBalance(-amount));
    if (!dec.modifiedCount) {
      const now = await BankAccount.findById(from._id).select("balance").lean();
      throw new HttpError(409, `Not enough balance in ${labelOf(from)}: ${rupees(now?.balance)} available, ${rupees(amount)} asked.`);
    }
    undo.push("give the amount back", () => BankAccount.updateOne({ _id: from._id }, addToBalance(amount)));
    const inc = await BankAccount.updateOne({ _id: to._id, active: true }, addToBalance(amount));
    if (!inc.modifiedCount) throw new HttpError(409, `${labelOf(to)} could not receive the transfer (it may have been made inactive). Nothing was moved.`);
    undo.push("take the amount back", () => BankAccount.updateOne({ _id: to._id }, addToBalance(-amount)));
    const t = await BankTransfer.create({
      number: await nextNumber("BANK_TRANSFER", "BT-"), fromAccountId: from._id, toAccountId: to._id, fromLabel: labelOf(from), toLabel: labelOf(to),
      date, amount, notes: clean(req.body.notes, 500), createdBy: who.user.email || "",
    });
    const [fromNow, toNow] = await Promise.all([BankAccount.findById(from._id).lean(), BankAccount.findById(to._id).lean()]);
    res.status(201).json({ transfer: t.toObject(), from: listRow(fromNow), to: listRow(toNow) });
  } catch (err) {
    await undo.rollback();
    fail(res, err, "Create bank transfer");
  }
};
