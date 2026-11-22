// Checks the batch planner (F18): earliest expiry first, expired never sold, chosen batch, splits.
// Run: node scripts/test-batches.js   (exits 1 on any failure)
import { planTake, splitAllocations, returnAllocations, fefoSort, isExpired } from "../utils/batches.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};
const TODAY = "2026-11-22";
const batches = [
  { batchNo: "B-MAR", qty: 8, expDate: "2027-03-31", createdAt: "2026-11-01" },
  { batchNo: "B-OLD", qty: 5, expDate: "2026-11-20", createdAt: "2026-10-01" }, // expired
  { batchNo: "B-JAN", qty: 10, expDate: "2027-01-31", createdAt: "2026-11-02" },
  { batchNo: "UNASSIGNED", qty: 3, expDate: "", createdAt: "2026-09-01" },        // no expiry: last
];

eq("expired = expiry before today", [isExpired(batches[1], TODAY), isExpired(batches[0], TODAY), isExpired({ expDate: TODAY }, TODAY), isExpired(batches[3], TODAY)], [true, false, false, false]);
eq("FEFO order: earliest expiry first, no expiry last", [...batches].sort(fefoSort).map((b) => b.batchNo), ["B-OLD", "B-JAN", "B-MAR", "UNASSIGNED"]);

// Sale of 12: expired B-OLD skipped → B-JAN 10 + B-MAR 2
eq("sale takes earliest unexpired batches", planTake(batches, 12, { forSale: true, today: TODAY }).plan, [{ batchNo: "B-JAN", take: 10 }, { batchNo: "B-MAR", take: 2 }]);
// Sale of 22: 10 + 8 + 3 unassigned = 21 unexpired → 1 short, 5 expired
const short = planTake(batches, 22, { forSale: true, today: TODAY });
eq("sale beyond unexpired stock is short (expired not used)", [short.short, short.expiredQty], [1, 5]);
// Other movements (transfers, adjustments) use unexpired batches first, expired only as a last resort
eq("non-sale movement: unexpired first", planTake(batches, 7, { today: TODAY }).plan, [{ batchNo: "B-JAN", take: 7 }]);
eq("non-sale movement: expired only when the rest runs out", planTake(batches, 24, { today: TODAY }).plan.map((p) => [p.batchNo, p.take]), [["B-JAN", 10], ["B-MAR", 8], ["UNASSIGNED", 3], ["B-OLD", 3]]);
// Cashier's choice
eq("chosen batch", planTake(batches, 4, { batchNo: "b-mar", forSale: true, today: TODAY }).plan, [{ batchNo: "B-MAR", take: 4 }]);
eq("chosen expired batch refused for a sale", planTake(batches, 1, { batchNo: "B-OLD", forSale: true, today: TODAY }).error, "Batch B-OLD expired on 2026-11-20 and cannot be sold.");
eq("chosen batch without enough left", planTake(batches, 9, { batchNo: "B-MAR", forSale: true, today: TODAY }).error, "Batch B-MAR has only 8 left.");
eq("unknown batch", planTake(batches, 1, { batchNo: "NOPE", today: TODAY }).error, "Batch NOPE was not found here.");
// Taking back what a line added (undo): its batches first, rest FEFO; a sale skips expired ones
eq("allocations first, then FEFO", planTake(batches, 6, { allocations: [{ batchNo: "B-MAR", qty: 4 }], today: TODAY }).plan, [{ batchNo: "B-MAR", take: 4 }, { batchNo: "B-JAN", take: 2 }]);
eq("a sale preferring an expired batch skips it", planTake(batches, 2, { allocations: [{ batchNo: "B-OLD", qty: 2 }], forSale: true, today: TODAY }).plan, [{ batchNo: "B-JAN", take: 2 }]);

// Splitting allocations back over lines, and returns from the end of a sale's allocations
eq("split over lines in order", splitAllocations([7, 5], [{ batchNo: "B-JAN", qty: 10 }, { batchNo: "B-MAR", qty: 2 }]),
  [[{ batchNo: "B-JAN", qty: 7 }], [{ batchNo: "B-JAN", qty: 3 }, { batchNo: "B-MAR", qty: 2 }]]);
eq("return of 3 goes back to the last batches taken", returnAllocations([{ batchNo: "B-JAN", qty: 10 }, { batchNo: "B-MAR", qty: 2 }], 3),
  [{ batchNo: "B-JAN", qty: 1 }, { batchNo: "B-MAR", qty: 2 }]);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll batch checks passed");
process.exit(failed ? 1 : 0);
