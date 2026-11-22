// Checks the repacking formulas (F19).
// Run: node scripts/test-repack.js   (exits 1 on any failure)
import { repackCost, sourceUnitCost, repackRequestError } from "../utils/repack.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};

// 10 × loose saffron at ₹100 + 20 × empty box at ₹5 + ₹50 charges = ₹1,150 → 25 packs → ₹46 a pack
eq("cost per produced unit", repackCost([{ qty: 10, unitCost: 100 }, { qty: 20, unitCost: 5 }], 50, 25), { consumedCost: 1100, charges: 50, totalCost: 1150, unitCost: 46 });
eq("rounded only at the end (₹100 ÷ 3)", repackCost([{ qty: 1, unitCost: 100 }], 0, 3).unitCost, 33.33);
eq("no packs → no unit cost", repackCost([{ qty: 1, unitCost: 10 }], 0, 0).unitCost, 0);
eq("source cost from batch costs, weighted", sourceUnitCost(90, [{ qty: 3, costPrice: 100 }, { qty: 1, costPrice: 80 }]), 95);
eq("batches without a cost count at the item cost", sourceUnitCost(90, [{ qty: 1, costPrice: 110 }, { qty: 1, costPrice: null }]), 100);
eq("no batches → item cost", sourceUnitCost(90, []), 90);

const ok = { sources: [{ itemId: "a", qty: 2 }], target: { itemId: "b", packs: 4 }, charges: 10 };
eq("valid request", repackRequestError(ok), null);
eq("no sources", repackRequestError({ ...ok, sources: [] }), "Add at least one item to repack from.");
eq("zero quantity", repackRequestError({ ...ok, sources: [{ itemId: "a", qty: 0 }] }), "Each source quantity must be more than 0.");
eq("target is a source", repackRequestError({ ...ok, target: { itemId: "a", packs: 1 } }), "The packed item cannot also be one of the items repacked.");
eq("same source twice", repackRequestError({ ...ok, sources: [{ itemId: "a", qty: 1 }, { itemId: "a", qty: 1 }] }), "The same source item is listed twice.");
eq("no packs", repackRequestError({ ...ok, target: { itemId: "b", packs: 0 } }), "Packs produced must be more than 0.");
eq("negative charges", repackRequestError({ ...ok, charges: -1 }), "Repacking charges cannot be negative.");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll repack checks passed");
process.exit(failed ? 1 : 0);
