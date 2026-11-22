// Checks the bank register helpers (F17).
// Run: node scripts/test-bank.js   (exits 1 on any failure)
import { maskAccountNumber, isValidAccountNumber, isValidIfsc, isValidUpi, parseAmount } from "../utils/bank.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};

eq("masked account number shows the last 4", [maskAccountNumber("123456789012"), maskAccountNumber("1234 5678"), maskAccountNumber("123")], ["••••••••9012", "••••5678", "123"]);
eq("account number 6–20 letters/digits", [isValidAccountNumber("12345"), isValidAccountNumber("123456"), isValidAccountNumber("1234 5678 9012"), isValidAccountNumber("12-34-56")], [false, true, true, false]);
eq("IFSC format (empty allowed)", [isValidIfsc("SBIN0070123"), isValidIfsc("sbin0070123"), isValidIfsc("SBIN1070123"), isValidIfsc("")], [true, true, false, true]);
eq("UPI format (empty allowed)", [isValidUpi("shop@okhdfc"), isValidUpi("shop"), isValidUpi("")], [true, false, true]);
eq("amounts: positive, ≤ 2 decimals", [parseAmount("1500"), parseAmount("1500.5"), parseAmount("0"), parseAmount("-5"), parseAmount("1.234"), parseAmount("abc"), parseAmount("")], [1500, 1500.5, null, null, null, null, null]);
eq("opening balance may be zero", parseAmount("0", { allowZero: true }), 0);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll bank checks passed");
process.exit(failed ? 1 : 0);
