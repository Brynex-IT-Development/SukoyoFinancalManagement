#!/usr/bin/env node
/**
 * Backfill customers from existing sales invoices (F1).
 *
 * For every invoice with a phone and no customerId: normalise the phone, find or create
 * the customer, and set invoice.customerId. Safe to run again (idempotent): invoices that
 * already have a customerId are skipped, and existing customers are never renamed.
 * No loyalty points are awarded for past invoices.
 *
 * Usage (from backend/):
 *   node scripts/backfill-customers.js --dry-run     ← prints counts only, changes nothing
 *   node scripts/backfill-customers.js               ← writes
 * Options:
 *   --uri <mongodb uri>   use this database instead of the one the server would use
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import dns from "node:dns";
import Customer from "../model/Customer.js";
import SalesInvoice from "../model/SalesInvoice.js";
import { normalizePhone } from "../utils/retailMath.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const uriArg = args.includes("--uri") ? args[args.indexOf("--uri") + 1] : null;

// Same database selection as db/database.js
dotenv.config();
const env = process.env.NODE_ENV || "development";
if (fs.existsSync(`.env.${env}`)) dotenv.config({ path: `.env.${env}` });
const uri = uriArg || (env === "production"
  ? process.env.MONGODB_URI_PROD || process.env.MONGODB_URI
  : process.env.MONGODB_URI_DEV || process.env.MONGODB_URI);
if (!uri) {
  console.error("❌ No MongoDB URI (set MONGODB_URI or pass --uri).");
  process.exit(1);
}
if (uri.startsWith("mongodb+srv")) {
  try { dns.setDefaultResultOrder("ipv4first"); dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]); } catch { /* optional */ }
}
const host = (() => { try { return new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).host; } catch { return "(unparsed)"; } })();

const run = async () => {
  console.log(`${dryRun ? "🔎 DRY RUN — nothing will be written" : "✍️  WRITE MODE"}`);
  console.log(`Database host: ${host}  (NODE_ENV=${env})\n`);
  await mongoose.connect(uri);
  if (!dryRun) await Customer.createIndexes(); // unique phone index must exist before upserts

  const invoices = await SalesInvoice.find({
    $or: [{ customerId: null }, { customerId: { $exists: false } }],
  }).select("_id customer customerPhone invoiceDate createdAt locCode createdBy").lean();

  let noPhone = 0, invalidPhone = 0;
  const groups = new Map(); // phone → invoices
  for (const inv of invoices) {
    if (!inv.customerPhone || !String(inv.customerPhone).trim()) { noPhone++; continue; }
    const phone = normalizePhone(inv.customerPhone);
    if (!phone) { invalidPhone++; continue; }
    if (!groups.has(phone)) groups.set(phone, []);
    groups.get(phone).push(inv);
  }

  const existing = new Map((await Customer.find({ phone: { $in: [...groups.keys()] } }).select("_id phone").lean()).map((c) => [c.phone, c._id]));
  const toCreate = [...groups.keys()].filter((p) => !existing.has(p));
  const linkCount = [...groups.values()].reduce((s, g) => s + g.length, 0);

  console.log(`Invoices without a customer:   ${invoices.length}`);
  console.log(`  walk-in (no phone, skipped): ${noPhone}`);
  console.log(`  invalid phone (skipped):     ${invalidPhone}`);
  console.log(`  to link to a customer:       ${linkCount}`);
  console.log(`Distinct phones:               ${groups.size}`);
  console.log(`  customers already existing:  ${existing.size}`);
  console.log(`  customers to create:         ${toCreate.length}`);

  if (dryRun) {
    await mongoose.disconnect();
    console.log("\nDry run finished. Run without --dry-run to apply.");
    return;
  }

  let created = 0, linked = 0;
  for (const [phone, list] of groups) {
    const byDate = [...list].sort((a, b) => new Date(a.invoiceDate || a.createdAt) - new Date(b.invoiceDate || b.createdAt));
    const first = byDate[0];
    const latest = byDate[byDate.length - 1];
    let customerId = existing.get(phone);
    if (!customerId) {
      const r = await Customer.findOneAndUpdate(
        { phone },
        { $setOnInsert: { phone, name: (latest.customer || "Customer").trim() || "Customer", locCode: first.locCode || "", createdBy: "backfill", status: "active" } },
        { upsert: true, new: true, includeResultMetadata: true }
      );
      customerId = r.value._id;
      if (!r.lastErrorObject?.updatedExisting) created++;
    }
    const u = await SalesInvoice.updateMany(
      { _id: { $in: list.map((i) => i._id) }, $or: [{ customerId: null }, { customerId: { $exists: false } }] },
      { $set: { customerId } }
    );
    linked += u.modifiedCount;
  }

  console.log(`\n✅ Customers created: ${created}`);
  console.log(`✅ Invoices linked:   ${linked}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌ Backfill failed:", err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
