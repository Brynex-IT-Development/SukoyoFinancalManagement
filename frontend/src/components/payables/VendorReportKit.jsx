// Shared bits for the vendor reports (F10): store choice, print header, CSV/print buttons.
import { useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import { Download, Printer } from "lucide-react";
import useCompanyProfile, { companyAddressLine } from "../../hooks/useCompanyProfile";
import { useActiveStores } from "../../utils/storeService";
import { getCurrentUser, isAdminUser, ui } from "../../utils/retailApi";

export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * Store dropdown state. Admins pick any store (or all); cluster managers pick among their
 * allowed stores (or all of them); everyone else is fixed to their own store. The server
 * applies the same scope whatever is sent.
 */
export const useStoreChoice = () => {
  const user = getCurrentUser();
  const admin = isAdminUser(user);
  const cluster = (user.role || "").toLowerCase() === "cluster_manager";
  const allowed = (user.allowedLocCodes || []).map(String);
  const { stores } = useActiveStores();
  const [locCode, setLocCode] = useState(admin || cluster ? "" : String(user.locCode || ""));
  const options = useMemo(() => {
    const list = (stores || []).filter((s) => admin || (cluster ? allowed.includes(String(s.locCode)) : String(s.locCode) === String(user.locCode)))
      .map((s) => ({ value: String(s.locCode), label: s.locName || s.name || String(s.locCode) }));
    if (!admin && !cluster && user.locCode && !list.some((o) => o.value === String(user.locCode))) list.push({ value: String(user.locCode), label: String(user.locCode) });
    return admin || cluster ? [{ value: "", label: admin ? "All stores" : "All my stores" }, ...list] : list;
  }, [stores]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = options.find((o) => o.value === locCode);
  return {
    locCode, setLocCode, options, canChoose: admin || cluster,
    label: selected?.label || (locCode || "All stores"),
    // warehouse lets older bills without a locCode match by their warehouse name
    query: locCode ? { locCode, warehouse: selected?.label || "" } : {},
  };
};

export const StoreSelect = ({ store }) => (
  <select value={store.locCode} onChange={(e) => store.setLocCode(e.target.value)} disabled={!store.canChoose} className={`${ui.input} w-44`}>
    {store.options.map((o) => <option key={o.value || "all"} value={o.value}>{o.label}</option>)}
  </select>
);

/** Company name/address and the report title, shown only when printing. */
export const PrintHeader = ({ title, lines = [] }) => {
  const company = useCompanyProfile();
  return (
    <div className="hidden print:block px-2 pb-3 mb-3 border-b border-[#999] text-[#111]">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-base font-extrabold">{company?.companyName || ""}</div>
          {companyAddressLine(company) && <div className="text-[10px]">{companyAddressLine(company)}</div>}
          {company?.gstin && <div className="text-[10px]">GSTIN {company.gstin}</div>}
        </div>
        <div className="text-right">
          <div className="text-sm font-extrabold uppercase tracking-wider">{title}</div>
          {lines.filter(Boolean).map((l) => <div key={l} className="text-[10px]">{l}</div>)}
          <div className="text-[10px]">Printed {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
        </div>
      </div>
    </div>
  );
};

export const ReportActions = ({ csvData, csvName, onPrint, disabled }) => (
  <div className="flex items-center gap-2.5">
    <CSVLink data={csvData || []} filename={`${csvName}-${todayIST()}.csv`} className={`${ui.btn} ${disabled ? "pointer-events-none opacity-50" : ""}`}><Download size={14} /> Export CSV</CSVLink>
    <button type="button" onClick={onPrint} disabled={disabled} className={ui.btnDark}><Printer size={14} /> Print</button>
  </div>
);

/** react-to-print page setup used by all three reports. */
export const PRINT_PAGE_STYLE = "@page { size: A4 landscape; margin: 10mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }";
