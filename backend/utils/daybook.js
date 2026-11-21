// Daybook entries for money that comes in outside a sales invoice (gift card sales and reloads).
// Shaped like a manual "Income" entry from TransactionController.CreatePayment, so daybook
// totals and cash closing pick it up the same way.
import Transaction from "../model/Transaction.js";
import { propagateCashDiff } from "./cashPropagation.js";
import { istDateString } from "./ist.js";
import { round2 } from "./retailMath.js";

export const MONEY_MODES = ["cash", "bank", "upi"];

/** Today's IST date at UTC midnight — the same form invoice dates are stored in. */
export const todayForDaybook = () => new Date(`${istDateString()}T00:00:00.000Z`);

export const postMoneyIn = async ({ invoiceNo, category, subCategory = "", amount, mode, locCode, remark = "", customerName = "", quantity = "1" }) => {
  if (!MONEY_MODES.includes(mode)) throw new Error(`Unknown payment mode "${mode}"`);
  const amt = round2(amount);
  const date = todayForDaybook();
  const money = { cash: "0", bank: "0", upi: "0" };
  money[mode] = String(amt);
  const tx = await Transaction.create({
    type: "Income",
    invoiceNo,
    category,
    subCategory,
    remark,
    billValue: amt,
    amount: String(amt),
    ...money,
    rbl: "0",
    paymentMethod: mode,
    date,
    locCode: locCode || "001",
    quantity: String(quantity),
    customerName,
    totalTransaction: amt,
  });
  // Same as a manual income entry: keep later cash closings in step
  if (mode === "cash") await propagateCashDiff(tx.locCode, date, amt, true);
  return tx;
};

/** Remove an entry made by postMoneyIn (used to roll back when a later step fails). */
export const removeMoneyIn = async (tx) => {
  if (!tx) return;
  await Transaction.deleteOne({ _id: tx._id });
  const cash = Number(tx.cash) || 0;
  if (cash) await propagateCashDiff(tx.locCode, tx.date, -cash, true);
};
