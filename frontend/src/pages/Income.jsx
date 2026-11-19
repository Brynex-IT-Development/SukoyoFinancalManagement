import { TrendingUp, BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import TransactionEntry from "../components/TransactionEntry.jsx";
import * as ui from "../components/docDetailStyles";

const baseIncomeCats = [
  { value: "compensation from cancellation",   label: "Compensation from Cancellation" },
  { value: "compensation from product damage", label: "Compensation from Product Damage" },
  // Cash coming into the branch from the bank is always cash.
  { value: "bank to cash",                     label: "Cash to Branch (Bank to Cash)", cashOnly: true },
];

const Income = () => {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("rootfinuser") || "{}") || {};
  const isAdmin = (currentUser.power || "").toLowerCase() === "admin";
  const cats = isAdmin ? baseIncomeCats : baseIncomeCats.filter((c) => c.value !== "bank to cash");

  return (
    <TransactionEntry
      type="income"
      title="Income"
      subtitle="Record money received by this store"
      icon={TrendingUp}
      categories={cats}
      actions={
        <button type="button" onClick={() => navigate("/reports/income-expense")} className={`${ui.btnOutline} h-10 px-4 text-sm`}>
          <BarChart3 size={15} /> Income & Expense Report
        </button>
      }
    />
  );
};

export default Income;
