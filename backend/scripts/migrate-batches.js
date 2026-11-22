#!/usr/bin/env node
/**
 * Prepare existing batch-managed items for batches (F18).
 *
 * Items with manageBatch: true may already hold stock that has no batches. This puts that stock in an
 * "UNASSIGNED" batch per warehouse (no expiry), so batch quantities match stock from the start. The
 * server also does this on the first stock movement of each item, so the script is optional, but it
 * makes the expiring report and the billing screen's batch picker complete straight away.
 *
 * Safe to run again: it only fixes differences between batch totals and stock.
 *
 * Usage (from backend/):
 *   node scripts/migrate-batches.js --dry-run     ← prints what would change, changes nothing
 *   node scripts/migrate-batches.js               ← writes
 * Options:
 *   --uri <mongodb uri>   use this database instead of the one the server would use
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import dns from "node:dns";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
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
  const { default: ShoeItem } = await import("../model/ShoeItem.js");
  const { default: Batch } = await import("../model/Batch.js");
  const { warehouseKey } = await import("../utils/stockService.js");
  const keyOf = (name) => warehouseKey(name) || String(name || "").trim().toLowerCase();

  const items = await ShoeItem.find({ manageBatch: true }).select("itemName warehouseStocks.warehouse warehouseStocks.stockOnHand").lean();
  console.log(`Batch-managed items: ${items.length}`);
  const diffs = [];
  for (const it of items) {
    const stockByKey = new Map();
    for (const ws of it.warehouseStocks || []) {
      const k = keyOf(ws.warehouse);
      if (!k) continue;
      const cur = stockByKey.get(k) || { warehouse: ws.warehouse, stock: 0 };
      cur.stock += Number(ws.stockOnHand) || 0;
      stockByKey.set(k, cur);
    }
    const batches = await Batch.find({ itemId: it._id }).lean();
    for (const b of batches) if (!stockByKey.has(b.warehouseKey)) stockByKey.set(b.warehouseKey, { warehouse: b.warehouse, stock: 0 });
    for (const [k, { warehouse, stock }] of stockByKey) {
      const sum = batches.filter((b) => b.warehouseKey === k).reduce((s, b) => s + (Number(b.qty) || 0), 0);
      if (Math.abs(stock - sum) > 1e-9) diffs.push({ item: it.itemName, warehouse, stock, batches: sum, diff: stock - sum });
    }
  }
  for (const d of diffs.slice(0, 50)) console.log(`  ${d.item} @ ${d.warehouse}: stock ${d.stock}, batches ${d.batches} → ${d.diff > 0 ? `+${d.diff} to UNASSIGNED` : `${d.diff} (UNASSIGNED first)`}`);
  if (diffs.length > 50) console.log(`  … and ${diffs.length - 50} more`);
  console.log(`\nWarehouse rows to fix: ${diffs.length}`);

  if (dryRun) { await mongoose.disconnect(); console.log("\nDry run finished. Run without --dry-run to apply."); return; }
  const { reconcileAll } = await import("../controllers/BatchController.js");
  const r = await reconcileAll();
  console.log(`\n✅ ${r.fixed.length} warehouse row(s) brought in line with stock (${r.items} batch-managed items checked).`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌ Migration failed:", err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
