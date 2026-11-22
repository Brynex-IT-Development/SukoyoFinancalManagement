import { useCallback, useEffect, useMemo, useState } from "react";
import { CSVLink } from "react-csv";
import { Plus, Pencil, ArrowLeftRight, Download, Info, X } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { todayIST } from "../components/payables/VendorReportKit";
import { api, formatCurrency, formatDate, isAdminUser, ui } from "../utils/retailApi";

const EMPTY = { bankName: "", accountHolder: "", accountNumber: "", ifsc: "", branch: "", upiId: "", openingBalance: "" };

const AccountForm = ({ initial, onSave, onCancel, title }) => {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try { await onSave(f); } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-4 gap-4`}>
      <p className={`${ui.sectionTitle} md:col-span-4 flex items-center justify-between`}>{title}<button type="button" onClick={onCancel} aria-label="Close"><X size={14} /></button></p>
      <div><label className={ui.label}>Bank <span className="text-red-500">*</span></label><input value={f.bankName} onChange={set("bankName")} className={ui.input} required /></div>
      <div><label className={ui.label}>Account holder <span className="text-red-500">*</span></label><input value={f.accountHolder} onChange={set("accountHolder")} className={ui.input} required /></div>
      <div><label className={ui.label}>Account number <span className="text-red-500">*</span></label><input value={f.accountNumber} onChange={set("accountNumber")} className={`${ui.input} font-mono`} required /></div>
      <div><label className={ui.label}>IFSC</label><input value={f.ifsc} onChange={set("ifsc")} placeholder="SBIN0070123" className={`${ui.input} font-mono uppercase`} /></div>
      <div><label className={ui.label}>Branch</label><input value={f.branch} onChange={set("branch")} className={ui.input} /></div>
      <div><label className={ui.label}>UPI ID</label><input value={f.upiId} onChange={set("upiId")} placeholder="name@bank" className={ui.input} /></div>
      <div><label className={ui.label}>Opening balance (₹)</label><input type="number" min="0" step="0.01" value={f.openingBalance} onChange={set("openingBalance")} className={ui.input} /></div>
      {initial?._id && (
        <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-[#374151]"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Active</label>
      )}
      {initial?._id && <p className="md:col-span-4 text-[11px] text-[#6B7280]">Changing the opening balance moves the current balance by the same amount.</p>}
      {error && <p className="md:col-span-4 text-xs font-semibold text-red-600">{error}</p>}
      <div className="md:col-span-4 flex justify-end gap-2.5">
        <button type="button" onClick={onCancel} className={ui.btn}>Cancel</button>
        <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving…" : "Save account"}</button>
      </div>
    </form>
  );
};

const TransferForm = ({ accounts, onDone, onCancel }) => {
  const active = accounts.filter((a) => a.active);
  const [f, setF] = useState({ fromAccountId: active[0]?._id || "", toAccountId: active[1]?._id || "", amount: "", date: todayIST(), notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const from = accounts.find((a) => a._id === f.fromAccountId);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try { await api("/bank-transfers", { method: "POST", body: f }); onDone(); } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const label = (a) => `${a.bankName} · ${a.accountNumberMasked} (${formatCurrency(a.balance)})`;
  return (
    <form onSubmit={submit} className={`${ui.card} p-5 grid grid-cols-1 md:grid-cols-5 gap-4`}>
      <p className={`${ui.sectionTitle} md:col-span-5 flex items-center justify-between`}>Transfer between accounts<button type="button" onClick={onCancel} aria-label="Close"><X size={14} /></button></p>
      <div className="md:col-span-2"><label className={ui.label}>From</label>
        <select value={f.fromAccountId} onChange={set("fromAccountId")} className={ui.input}>{active.map((a) => <option key={a._id} value={a._id}>{label(a)}</option>)}</select></div>
      <div className="md:col-span-2"><label className={ui.label}>To</label>
        <select value={f.toAccountId} onChange={set("toAccountId")} className={ui.input}>{active.map((a) => <option key={a._id} value={a._id} disabled={a._id === f.fromAccountId}>{label(a)}</option>)}</select></div>
      <div><label className={ui.label}>Amount (₹)</label><input type="number" min="0.01" step="0.01" max={from?.balance} value={f.amount} onChange={set("amount")} className={ui.input} required /></div>
      <div><label className={ui.label}>Date</label><input type="date" value={f.date} max={todayIST()} onChange={set("date")} className={ui.input} /></div>
      <div className="md:col-span-3"><label className={ui.label}>Notes</label><input value={f.notes} onChange={set("notes")} className={ui.input} /></div>
      <div className="flex items-end"><button type="submit" disabled={saving || !f.amount || f.fromAccountId === f.toAccountId} className={`${ui.btnDark} w-full justify-center`}>{saving ? "Saving…" : "Transfer"}</button></div>
      {error && <p className="md:col-span-5 text-xs font-semibold text-red-600">{error}</p>}
    </form>
  );
};

// F17: register of bank accounts and transfers between them (admin only).
const BankAccounts = () => {
  const isSidebarOpen = useSidebar();
  const admin = isAdminUser();
  const [data, setData] = useState(null);
  const [transfers, setTransfers] = useState(null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(null); // "new" | "transfer" | { edit: account }
  const [accountFilter, setAccountFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!admin) return;
    api("/bank-accounts").then(setData).catch((e) => setError(e.message));
  }, [admin, reloadKey]);
  useEffect(() => {
    if (!admin) return;
    api("/bank-transfers", { query: { accountId: accountFilter, fromDate, toDate } }).then(setTransfers).catch((e) => setError(e.message));
  }, [admin, accountFilter, fromDate, toDate, reloadKey]);

  const openEdit = async (a) => {
    try { const full = await api(`/bank-accounts/${a._id}`); setPanel({ edit: full }); } catch (e) { setError(e.message); }
  };
  const saveNew = async (f) => { await api("/bank-accounts", { method: "POST", body: f }); setPanel(null); reload(); };
  const saveEdit = async (f) => {
    const { bankName, accountHolder, accountNumber, ifsc, branch, upiId, openingBalance, active } = f;
    await api(`/bank-accounts/${f._id}`, { method: "PUT", body: { bankName, accountHolder, accountNumber, ifsc, branch, upiId, openingBalance: String(openingBalance), active } });
    setPanel(null);
    reload();
  };

  const csvData = useMemo(() => (transfers?.transfers || []).map((t) => ({ Number: t.number, Date: t.date, From: t.fromLabel, To: t.toLabel, Amount: t.amount, Notes: t.notes || "", By: t.createdBy || "" })), [transfers]);

  return (
    <>
      <Header title="Bank Accounts" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Bank Accounts</h1>
              <p className={ui.sub}>The business&apos;s bank accounts and money moved between them. Admins only.</p>
            </div>
            {admin && (
              <div className="flex items-center gap-2.5">
                <button type="button" onClick={() => setPanel("transfer")} disabled={(data?.accounts || []).filter((a) => a.active).length < 2} className={ui.btn}><ArrowLeftRight size={14} /> Transfer</button>
                <button type="button" onClick={() => setPanel("new")} className={ui.btnDark}><Plus size={14} /> Add Account</button>
              </div>
            )}
          </div>
        </div>

        {!admin ? <p className="p-6 text-xs text-[#6B7280]">Only an admin can see bank accounts.</p> : (
          <div className="px-6 py-5 space-y-5">
            <div className="flex gap-3 border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#78350F]">
              <Info size={16} className="shrink-0 mt-0.5" />
              <p><b>This is a separate register.</b> Transfers recorded here are not posted to the daybook, and daybook entries do not change these balances. Record each movement in one place only. A transfer entered here and again as a daybook bank entry would be counted twice.</p>
            </div>
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            {panel === "new" && <AccountForm title="Add account" initial={EMPTY} onSave={saveNew} onCancel={() => setPanel(null)} />}
            {panel?.edit && <AccountForm title={`Edit ${panel.edit.bankName}`} initial={panel.edit} onSave={saveEdit} onCancel={() => setPanel(null)} />}
            {panel === "transfer" && data && <TransferForm accounts={data.accounts} onDone={() => { setPanel(null); reload(); }} onCancel={() => setPanel(null)} />}

            <section className={`${ui.card} overflow-x-auto`}>
              {!data ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">Loading…</p> : !data.accounts.length ? <p className="px-8 py-12 text-center text-xs text-[#6B7280]">No accounts yet. Add the business&apos;s bank accounts to keep their balances here.</p> : (
                <table className="min-w-full border-collapse">
                  <thead><tr className={ui.theadRow}>
                    <th className={ui.th}>Bank</th><th className={ui.th}>Account holder</th><th className={ui.th}>Account</th><th className={ui.th}>IFSC</th><th className={ui.th}>Branch</th><th className={ui.th}>UPI</th>
                    <th className={ui.thRight}>Opening</th><th className={ui.thRight}>Balance</th><th className={ui.th}>Status</th><th className="px-3 py-3" />
                  </tr></thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs">
                    {data.accounts.map((a) => (
                      <tr key={a._id} className={a.active ? "" : "text-[#9CA3AF]"}>
                        <td className={`${ui.td} font-semibold`}>{a.bankName}</td><td className={ui.td}>{a.accountHolder}</td>
                        <td className={`${ui.td} font-mono`}>{a.accountNumberMasked}</td><td className={`${ui.td} font-mono`}>{a.ifsc || "—"}</td>
                        <td className={ui.td}>{a.branch || "—"}</td><td className={ui.td}>{a.upiId || "—"}</td>
                        <td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(a.openingBalance)}</td>
                        <td className={`${ui.td} text-right tabular-nums font-bold`}>{formatCurrency(a.balance)}</td>
                        <td className={ui.td}>{a.active ? "Active" : "Inactive"}</td>
                        <td className={`${ui.td} text-right`}><button type="button" onClick={() => openEdit(a)} className="text-[#374151] hover:text-[#111827]" aria-label={`Edit ${a.bankName}`}><Pencil size={14} /></button></td>
                      </tr>
                    ))}
                    <tr className="bg-[#F3F4F6] font-bold"><td className={ui.td} colSpan={7}>Total balance (active accounts)</td><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(data.totalBalance)}</td><td className={ui.td} colSpan={2} /></tr>
                  </tbody>
                </table>
              )}
            </section>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className={`${ui.sectionTitle} mb-2`}>Transfers</p>
                <div><label className={ui.label}>Account</label>
                  <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className={`${ui.input} w-56`}>
                    <option value="">All accounts</option>{(data?.accounts || []).map((a) => <option key={a._id} value={a._id}>{a.bankName} · {a.accountNumberMasked}</option>)}
                  </select></div>
                <div><label className={ui.label}>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${ui.input} w-36`} /></div>
                <div><label className={ui.label}>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${ui.input} w-36`} /></div>
              </div>
              <CSVLink data={csvData} filename={`bank-transfers-${todayIST()}.csv`} className={`${ui.btn} ${csvData.length ? "" : "pointer-events-none opacity-50"}`}><Download size={14} /> Export CSV</CSVLink>
            </div>
            <section className={`${ui.card} overflow-x-auto`}>
              {!transfers ? <p className="px-8 py-10 text-center text-xs text-[#6B7280]">Loading…</p> : !transfers.transfers.length ? <p className="px-8 py-10 text-center text-xs text-[#6B7280]">No transfers.</p> : (
                <table className="min-w-full border-collapse">
                  <thead><tr className={ui.theadRow}><th className={ui.th}>Number</th><th className={ui.th}>Date</th><th className={ui.th}>From</th><th className={ui.th}>To</th><th className={ui.thRight}>Amount</th><th className={ui.th}>Notes</th><th className="px-3 py-3 text-left">By</th></tr></thead>
                  <tbody className="divide-y divide-[#F3F4F6] text-xs">
                    {transfers.transfers.map((t) => (
                      <tr key={t._id}>
                        <td className={`${ui.td} font-semibold`}>{t.number}</td><td className={`${ui.td} whitespace-nowrap`}>{formatDate(t.date)}</td>
                        <td className={`${ui.td} font-mono`}>{t.fromLabel}</td><td className={`${ui.td} font-mono`}>{t.toLabel}</td>
                        <td className={`${ui.td} text-right tabular-nums font-bold`}>{formatCurrency(t.amount)}</td><td className={ui.td}>{t.notes || ""}</td><td className={ui.td}>{t.createdBy}</td>
                      </tr>
                    ))}
                    <tr className="bg-[#F3F4F6] font-bold"><td className={ui.td} colSpan={4}>Total ({transfers.transfers.length})</td><td className={`${ui.td} text-right tabular-nums`}>{formatCurrency(transfers.total)}</td><td className={ui.td} colSpan={2} /></tr>
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
};

export default BankAccounts;
