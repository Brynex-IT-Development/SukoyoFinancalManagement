#!/usr/bin/env node
/**
 * Prepare existing bills and vendor credits for vendor payments (F9).
 *
 *  - Bills without amountPaid / creditsApplied get 0 (they count as fully unpaid — the spec rule).
 *  - Vendor credits without unusedCredit get finalTotal − appliedCredit (the controller always
 *    tried to save this, but the field was not in the schema, so it was dropped).
 *  - Bills whose old status is "paid" are only REPORTED. Pass --treat-paid-status-as-paid to
 *    set their amountPaid = finalTotal (no payment record or daybook entry is created for them).
 *
 * Safe to run again: only documents that are missing a field are touched.
 *
 * Usage (from backend/):
 *   node scripts/migrate-bill-payments.js --dry-run       ← prints counts only, changes nothing
 *   node scripts/migrate-bill-payments.js                 ← writes
 * Options:
 *   --treat-paid-status-as-paid   also mark old status:"paid" bills as fully paid
 *   --uri <mongodb uri>           use this database instead of the one the server would use
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import dns from "node:dns";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const treatPaid = args.includes("--treat-paid-status-as-paid");
const uriArg = args.includes("--uri") ? args[args.indexOf("--uri") + 1] : null;

dotenv.config();
const env = process.env.NODE_ENV || "development";
if (fs.existsSync(`.env.${env}`)) dotenv.config({ path: `.env.${env}` });
const uri = uriArg || (env === "production" ? process.env.MONGODB_URI_PROD || process.env.MONGODB_URI : process.env.MONGODB_URI_DEV || process.env.MONGODB_URI);
if (!uri) { console.error("❌ No MongoDB URI (set MONGODB_URI or pass --uri)."); process.exit(1); }
if (uri.startsWith("mongodb+srv")) { try { dns.setDefaultResultOrder("ipv4first"); dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]); } catch { /* optional */ } }
const host = (() => { try { return new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).host; } catch { return "(unparsed)"; } })();

const run = async () => {
  console.log(dryRun ? "🔎 DRY RUN — nothing will be written" : "✍️  WRITE MODE");
  console.log(`Database host: ${host}  (NODE_ENV=${env})\n`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const bills = db.collection("bills");
  const credits = db.collection("vendorcredits");

  const missingPaid = { $or: [{ amountPaid: { $exists: false } }, { creditsApplied: { $exists: false } }] };
  const paidStatusUnpaid = { status: { $regex: "^paid$", $options: "i" }, $or: [{ amountPaid: { $exists: false } }, { amountPaid: 0 }] };
  const missingUnused = { unusedCredit: { $exists: false } };

  const [billCount, billsMissing, paidStatus, creditsMissing] = await Promise.all([
    bills.countDocuments({}), bills.countDocuments(missingPaid), bills.countDocuments(paidStatusUnpaid), credits.countDocuments(missingUnused),
  ]);
  console.log(`Bills:                                   ${billCount}`);
  console.log(`  without amountPaid/creditsApplied:     ${billsMissing}  → set to 0`);
  console.log(`  old status "paid" but nothing paid:    ${paidStatus}  → ${treatPaid ? "amountPaid = finalTotal" : "left as unpaid (use --treat-paid-status-as-paid to mark paid)"}`);
  console.log(`Vendor credits without unusedCredit:     ${creditsMissing}  → finalTotal − appliedCredit`);

  if (dryRun) { await mongoose.disconnect(); console.log("\nDry run finished. Run without --dry-run to apply."); return; }

  let paidMarked = 0;
  if (treatPaid) {
    const r = await bills.updateMany(paidStatusUnpaid, [{ $set: { amountPaid: { $ifNull: ["$finalTotal", 0] }, creditsApplied: { $ifNull: ["$creditsApplied", 0] } } }]);
    paidMarked = r.modifiedCount;
  }
  const r1 = await bills.updateMany({ amountPaid: { $exists: false } }, { $set: { amountPaid: 0 } });
  const r2 = await bills.updateMany({ creditsApplied: { $exists: false } }, { $set: { creditsApplied: 0 } });
  const r3 = await credits.updateMany(missingUnused, [{ $set: {
    appliedCredit: { $ifNull: ["$appliedCredit", 0] },
    unusedCredit: { $max: [0, { $subtract: [{ $ifNull: ["$finalTotal", 0] }, { $ifNull: ["$appliedCredit", 0] }] }] },
    appliedToBills: { $ifNull: ["$appliedToBills", []] },
  } }]);
  console.log(`\n✅ Bills: amountPaid set on ${r1.modifiedCount}, creditsApplied set on ${r2.modifiedCount}${treatPaid ? `, marked paid ${paidMarked}` : ""}`);
  console.log(`✅ Vendor credits: unusedCredit set on ${r3.modifiedCount}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌ Migration failed:", err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
