import { useState } from "react";
import { TrendingDown, Target } from "lucide-react";
import TransactionEntry from "../components/TransactionEntry.jsx";
import AssignTargetModal from "../components/AssignTargetModal.jsx";
import { useActiveStores, FALLBACK_STORES } from "../utils/storeService.js";
import * as ui from "../components/docDetailStyles";

const baseExpenseCats = [
  { value: "dry cleaning",          label: "Dry Cleaning",           subs: ["Dry cleaning"] },
  { value: "altration",             label: "Altration",              subs: ["Altration"] },
  { value: "material",              label: "Material",               subs: ["Material"] },
  { value: "courier charges",       label: "Courier Charges",        subs: ["Courier charges"] },
  { value: "maintenance expenses",  label: "Repairs & Maintenance",  subs: ["Ac service", "Interior Maintenance", "Glass Cleaning", "Electrical work"] },
  { value: "travel exp",            label: "Travel Exp",             subs: ["Travel exp"] },
  { value: "fuel exp",              label: "Fuel Exp",               subs: ["Fuel exp"] },
  { value: "petty expenses",        label: "Office Expense",         subs: ["Air freshner", "Grooming Kit", "Cleaning Products", "Parking charge"] },
  { value: "telephone internet",    label: "Internet Expense",       subs: ["Telephone/wifi"] },
  { value: "utility bill",          label: "Electricity Charges",    subs: ["Electricity Charges"] },
  { value: "waste management",      label: "Waste Management",       subs: ["Waste management"] },
  { value: "water charges",         label: "Water Charges",          subs: ["Water charges"] },
  { value: "salary",                label: "Salary/Salary Advance",  subs: ["Salary/salary advance"] },
  { value: "printing stationary",   label: "Printing & Stationary",  subs: ["Printout", "Books/pen/Checklist/Register/Bill Book/Voucher", "Stationary Items"] },
  { value: "staff welfare",         label: "Staff Welfare",          subs: ["Cake purchase", "Food allowance on Special Occassion", "Other Refreshment"] },
  { value: "staff reimbursement",   label: "Staff Accommodation",    subs: ["Staff room rent/Electricity"] },
  { value: "rent",                  label: "Rent",                   subs: ["Store Rent"] },
  { value: "asset purchase",        label: "Asset Purchase",         subs: ["Steamer", "Chairs", "Electronic Items", "Any other Furniture items"] },
  { value: "spot incentive",        label: "Incentive",              subs: ["Spot incentive", "Weekly incentive"] },
  { value: "other expenses",        label: "Refund",                 subs: ["Security Refund", "Cancellation Refund", "Compensation"] },
  { value: "bulk amount transfer",  label: "Cash to Bank",           subs: ["Cash Deposit"], cashOnly: true },
];

const Expenses = () => {
  const currentUser = JSON.parse(localStorage.getItem("rootfinuser") || "{}") || {};
  const role = (currentUser.role || "").toLowerCase();
  const canSelectStore = (currentUser.power || "").toLowerCase() === "admin" || role === "admin" || role === "superadmin";
  const { stores } = useActiveStores();
  const availableStores = stores && stores.length > 0 ? stores : FALLBACK_STORES;
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);

  return (
    <TransactionEntry
      type="expense"
      title="Expenses"
      subtitle="Record money spent, with the bill attached"
      icon={TrendingDown}
      categories={baseExpenseCats}
      stores={availableStores}
      canSelectStore={canSelectStore}
      defaultStore={currentUser.locCode || availableStores[0]?.locCode || "858"}
      requireAttachment
      actions={
        canSelectStore && (
          <button type="button" onClick={() => setIsTargetModalOpen(true)} className={`${ui.btnPrimary} h-10 px-5 text-sm`}>
            <Target size={15} /> Set Expense Limit
          </button>
        )
      }
    >
      <AssignTargetModal
        isOpen={isTargetModalOpen}
        onClose={() => setIsTargetModalOpen(false)}
        cats={baseExpenseCats}
        fallbackLocations={availableStores}
        currentusers={currentUser}
      />
    </TransactionEntry>
  );
};

export default Expenses;
