import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { Save, CheckCheck } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { PrintHeader, ReportActions, StoreSelect, useStoreChoice, todayIST, PRINT_PAGE_STYLE } from "../components/payables/VendorReportKit";
import { api, formatDate, ui } from "../utils/retailApi";

// F15: staff attendance — mark, daily view, monthly grid, one person's month.
const VIEWS = [
  { key: "mark", label: "Mark attendance" },
  { key: "daily", label: "Daily view" },
  { key: "monthly", label: "Monthly view" },
  { key: "person", label: "Staff member" },
];
const STATUS = [
  { value: "present", label: "Present", short: "P", style: "bg-[#DCFCE7] text-[#15803d] border-[#BBF7D0]" },
  { value: "half_day", label: "Half day", short: "H", style: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
  { value: "absent", label: "Absent", short: "A", style: "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]" },
  { value: "leave", label: "Leave", short: "L", style: "bg-[#E0E7FF] text-[#3730A3] border-[#C7D2FE]" },
];
const S = Object.fromEntries(STATUS.map((s) => [s.value, s]));
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (mins) => (mins === null || mins === undefined ? "" : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`);
const TIME_FIELDS = [["inTime", "In"], ["breakOut", "Break out"], ["breakIn", "Break in"], ["outTime", "Out"]];
const Badge = ({ status }) => (status ? <span className={`${ui.badge} ${S[status]?.style || ""}`}>{S[status]?.label || status}</span> : null);
const Msg = ({ children, tone = "muted" }) => <p className={`px-8 py-16 text-center text-xs ${tone === "error" ? "font-semibold text-red-500" : "text-[#6B7280]"}`}>{children}</p>;

// ─── Mark attendance ───────────────────────────────────────────────────────
const MarkView = ({ store, date, setDate }) => {
  const [day, setDay] = useState(null);
  const [rows, setRows] = useState({}); // staffId → editable entry
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!store.locCode) return;
    setLoading(true);
    setError("");
    try {
      const d = await api("/attendance/day", { query: { locCode: store.locCode, date } });
      setDay(d);
      setRows(Object.fromEntries(d.rows.map(({ staff, record }) => [staff._id, record
        ? { recordId: record._id, updatedAt: record.updatedAt, status: record.status, inTime: record.inTime, outTime: record.outTime, breakOut: record.breakOut, breakIn: record.breakIn, note: record.note, original: record }
        : { status: "", inTime: "", outTime: "", breakOut: "", breakIn: "", note: "" }])));
    } catch (e) { setError(e.message); setDay(null); }
    finally { setLoading(false); }
  }, [store.locCode, date]);
  useEffect(() => { setNotice(""); load(); }, [load]);

  const isDirty = (e) => {
    if (!e) return false;
    if (!e.recordId) return !!e.status;
    const o = e.original;
    return ["status", "inTime", "outTime", "breakOut", "breakIn", "note"].some((k) => String(e[k] || "") !== String(o[k] || ""));
  };
  const dirtyCount = Object.values(rows).filter(isDirty).length;
  const setField = (id, k, v) => setRows((m) => {
    const next = { ...m[id], [k]: v };
    if (k === "status" && (v === "absent" || v === "leave")) Object.assign(next, { inTime: "", outTime: "", breakOut: "", breakIn: "" });
    return { ...m, [id]: next };
  });
  const markAllPresent = () => setRows((m) => Object.fromEntries(Object.entries(m).map(([id, e]) => [id, e.recordId || e.status ? e : { ...e, status: "present" }])));

  const save = async () => {
    const entries = Object.entries(rows).filter(([, e]) => isDirty(e)).map(([staffId, e]) => ({
      staffId, recordId: e.recordId, updatedAt: e.updatedAt, status: e.status, inTime: e.inTime, outTime: e.outTime, breakOut: e.breakOut, breakIn: e.breakIn, note: e.note,
    }));
    if (!entries.length) return;
    setSaving(true);
    setError("");
    try {
      const r = await api("/attendance/save", { method: "POST", body: { locCode: store.locCode, date, entries } });
      setNotice(r.message);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const canMark = day?.canMark;
  return (
    <>
      <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
        <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        <div><label className={ui.label}>Date</label><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className={`${ui.input} w-40`} /></div>
        {canMark && <button type="button" onClick={markAllPresent} className={ui.btn}><CheckCheck size={14} /> Mark the rest present</button>}
        {canMark && <button type="button" onClick={save} disabled={!dirtyCount || saving} className={ui.btnDark}><Save size={14} /> {saving ? "Saving…" : `Save all${dirtyCount ? ` (${dirtyCount})` : ""}`}</button>}
      </div>
      <div className="px-6 pb-8 pt-2 space-y-3">
        {day?.isWeeklyOff && <p className="text-xs font-semibold text-[#92400E]">{formatDate(date)} is the weekly off day ({WEEKDAY_FULL[day.weeklyOff]}). Marks still count as present days.</p>}
        {day && !canMark && <p className="text-xs text-[#6B7280]">You can view this store&apos;s attendance. Only an admin or the store manager can mark it.</p>}
        {notice && <p className="text-xs font-semibold text-[#15803d]">{notice}</p>}
        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        <section className={`${ui.card} overflow-x-auto`}>
          {loading && !day ? <Msg>Loading…</Msg> : !day ? <Msg>Choose a store.</Msg> : !day.rows.length ? <Msg>This store has no active staff. Staff are added from the billing screen&apos;s salesperson list.</Msg> : (
            <table className="min-w-full border-collapse">
              <thead><tr className={ui.theadRow}>
                <th className={ui.th}>Staff</th><th className={ui.th}>Status</th>
                {TIME_FIELDS.map(([k, l]) => <th key={k} className={ui.th}>{l}</th>)}
                <th className={ui.th}>Hours</th><th className="px-3 py-3 text-left">Note</th>
              </tr></thead>
              <tbody className="divide-y divide-[#F3F4F6] text-xs">
                {day.rows.map(({ staff }) => {
                  const e = rows[staff._id] || {};
                  const noTimes = e.status === "absent" || e.status === "leave" || !e.status;
                  const mins = (() => {
                    const t = (v) => (/^\d{2}:\d{2}$/.test(v || "") ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);
                    if (t(e.inTime) === null || t(e.outTime) === null) return null;
                    return t(e.outTime) - t(e.inTime) - (t(e.breakOut) !== null && t(e.breakIn) !== null ? t(e.breakIn) - t(e.breakOut) : 0);
                  })();
                  return (
                    <tr key={staff._id} className={isDirty(e) ? "bg-[#F6FCE6]" : !e.recordId && !e.status ? "bg-[#FFFBEB]" : ""}>
                      <td className={`${ui.td} font-semibold whitespace-nowrap`}>{staff.name}<span className="block text-[10px] font-normal text-[#6B7280]">{staff.employeeId}{staff.isActive ? "" : " · inactive"}</span></td>
                      <td className={ui.td}>
                        <select value={e.status || ""} onChange={(ev) => setField(staff._id, "status", ev.target.value)} disabled={!canMark} className={`${ui.input} w-28 h-8`} aria-label={`Status for ${staff.name}`}>
                          <option value="">{e.recordId ? "Clear mark" : "Not marked"}</option>
                          {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      {TIME_FIELDS.map(([k, l]) => (
                        <td key={k} className={ui.td}>
                          <input type="time" value={e[k] || ""} onChange={(ev) => setField(staff._id, k, ev.target.value)} disabled={!canMark || noTimes} className={`${ui.input} w-24 h-8`} aria-label={`${l} for ${staff.name}`} />
                        </td>
                      ))}
                      <td className={`${ui.td} whitespace-nowrap tabular-nums`}>{mins !== null && mins > 0 ? hm(mins) : "—"}</td>
                      <td className={ui.td}><input value={e.note || ""} onChange={(ev) => setField(staff._id, "note", ev.target.value)} disabled={!canMark || (!e.status && !e.recordId)} className={`${ui.input} w-40 h-8`} aria-label={`Note for ${staff.name}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <p className="text-[11px] text-[#6B7280]">Hours = (out − in) − (break in − break out). Rows not yet marked are shaded; changed rows are green until saved.</p>
      </div>
    </>
  );
};

// ─── Daily view ────────────────────────────────────────────────────────────
const DailyView = ({ store, date, setDate, printRef, setCsv }) => {
  const [day, setDay] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!store.locCode) return undefined;
    let active = true;
    setError("");
    api("/attendance/day", { query: { locCode: store.locCode, date } }).then((d) => active && setDay(d)).catch((e) => { if (active) { setError(e.message); setDay(null); } });
    return () => { active = false; };
  }, [store.locCode, date]);
  useEffect(() => {
    setCsv(day ? day.rows.map(({ staff, record }) => ({ Date: date, Staff: staff.name, "Employee ID": staff.employeeId, Status: record ? S[record.status]?.label : "Not marked",
      In: record?.inTime || "", "Break out": record?.breakOut || "", "Break in": record?.breakIn || "", Out: record?.outTime || "", Hours: hm(record?.minutes), Note: record?.note || "" })) : []);
  }, [day, date, setCsv]);
  const sum = day?.summary;
  return (
    <>
      <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
        <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        <div><label className={ui.label}>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${ui.input} w-40`} /></div>
        {day?.canMark && <Link to={`/staff/attendance/mark?date=${date}`} className={ui.btn}>Mark / edit this day</Link>}
      </div>
      <div className="px-6 pb-8 pt-2">
        <div ref={printRef} className="space-y-3">
          <PrintHeader title="Daily attendance" lines={[`Store: ${day?.storeName || store.label}`, `Date: ${formatDate(date)}`]} />
          {sum && (
            <div className="flex flex-wrap gap-2 text-xs">
              {[["Staff", sum.staff, ""], ["Present", sum.present, S.present.style], ["Half day", sum.halfDay, S.half_day.style], ["Absent", sum.absent, S.absent.style], ["Leave", sum.leave, S.leave.style], ["Not marked", sum.unmarked, sum.unmarked ? "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]" : ""]].map(([l, v, st]) => (
                <span key={l} className={`inline-flex items-center gap-1.5 border px-3 py-1 font-semibold ${st || "bg-white border-[#E5E7EB] text-[#111827]"}`}>{l} <b>{v}</b></span>
              ))}
              {day.isWeeklyOff && <span className="inline-flex items-center border px-3 py-1 font-semibold bg-[#F3F4F6] border-[#E5E7EB] text-[#374151]">Weekly off day</span>}
            </div>
          )}
          <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
            {error ? <Msg tone="error">{error}</Msg> : !day ? <Msg>Loading…</Msg> : !day.rows.length ? <Msg>This store has no active staff.</Msg> : (
              <table className="min-w-full border-collapse">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Staff</th><th className={ui.th}>Status</th>{TIME_FIELDS.map(([k, l]) => <th key={k} className={ui.th}>{l}</th>)}<th className={ui.th}>Hours</th><th className="px-3 py-3 text-left">Note</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {day.rows.map(({ staff, record }) => (
                    <tr key={staff._id} className={record ? "" : "bg-[#FFFBEB]"}>
                      <td className={`${ui.td} font-semibold`}><Link to={`/staff/attendance/person?staff=${staff._id}&month=${date.slice(0, 7)}`} className="hover:underline">{staff.name}</Link></td>
                      <td className={ui.td}>{record ? <Badge status={record.status} /> : <span className="text-[11px] font-bold uppercase text-[#92400E]">Not marked</span>}</td>
                      {TIME_FIELDS.map(([k]) => <td key={k} className={`${ui.td} tabular-nums`}>{record?.[k] || "—"}</td>)}
                      <td className={`${ui.td} tabular-nums`}>{hm(record?.minutes) || "—"}</td>
                      <td className={ui.td}>{record?.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
};

// ─── Monthly view ──────────────────────────────────────────────────────────
const MonthlyView = ({ store, month, setMonth, printRef, setCsv }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { api("/attendance/settings").then(setSettings).catch(() => {}); }, [reloadKey]);
  useEffect(() => {
    if (!store.locCode) return undefined;
    let active = true;
    setError("");
    api("/attendance/month", { query: { locCode: store.locCode, month } }).then((d) => active && setData(d)).catch((e) => { if (active) { setError(e.message); setData(null); } });
    return () => { active = false; };
  }, [store.locCode, month, reloadKey]);
  useEffect(() => {
    setCsv(data ? data.rows.map(({ staff, days, summary }) => ({
      Staff: staff.name, "Employee ID": staff.employeeId,
      ...Object.fromEntries(data.days.map((d) => [d.date.slice(8), days[d.date] ? S[days[d.date].status]?.short : d.off ? "off" : ""])),
      "Working days": summary.workingDays, Present: summary.present, Absent: summary.absent, Leave: summary.leave, "Not marked": summary.unmarked, "Attendance %": summary.attendancePct, Hours: hm(summary.minutes),
    })) : []);
  }, [data, setCsv]);
  const changeWeeklyOff = async (v) => {
    try { await api("/attendance/settings", { method: "PUT", body: { weeklyOff: v === "none" ? null : Number(v) } }); setReloadKey((k) => k + 1); }
    catch (e) { window.alert(e.message); }
  };
  return (
    <>
      <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
        <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        <div><label className={ui.label}>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${ui.input} w-40`} /></div>
        {settings && (
          <div>
            <label className={ui.label}>Weekly off day</label>
            {settings.canEdit ? (
              <select value={settings.weeklyOff === null ? "none" : String(settings.weeklyOff)} onChange={(e) => changeWeeklyOff(e.target.value)} className={`${ui.input} w-36`}>
                {WEEKDAY_FULL.map((w, i) => <option key={w} value={i}>{w}</option>)}
                <option value="none">No weekly off</option>
              </select>
            ) : <p className="h-9 flex items-center text-xs font-semibold">{settings.weeklyOffLabel}</p>}
          </div>
        )}
      </div>
      <div className="px-6 pb-8 pt-2">
        <div ref={printRef} className="space-y-2">
          <PrintHeader title="Monthly attendance" lines={[`Store: ${data?.storeName || store.label}`, `Month: ${month}`, data && `Working days: ${data.workingDays}${data.inProgress ? " so far" : ""}`]} />
          {data && <p className="text-xs text-[#4B5563]">{data.workingDays} working day(s){data.inProgress ? " so far this month (up to today)" : ""}, excluding {settings?.weeklyOffLabel === "No weekly off" ? "no days" : `${settings?.weeklyOffLabel || "the weekly off day"}s`}. P present · H half day (0.5) · A absent · L leave.</p>}
          <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
            {error ? <Msg tone="error">{error}</Msg> : !data ? <Msg>Loading…</Msg> : !data.rows.length ? <Msg>No staff at this store.</Msg> : (
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className={ui.theadRow}>
                    <th className={`${ui.th} sticky left-0 bg-[#1e1e1e] z-10`}>Staff</th>
                    {data.days.map((d) => <th key={d.date} className={`px-1 py-2 text-center border-r border-[#333] ${d.off ? "bg-[#3a3a3a]" : ""}`} title={formatDate(d.date)}>{Number(d.date.slice(8))}<span className="block text-[9px] font-normal opacity-70">{WEEKDAYS[d.weekday][0]}</span></th>)}
                    {["Working", "Present", "Absent", "Leave", "Not marked", "%", "Hours"].map((h) => <th key={h} className={ui.thRight}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {data.rows.map(({ staff, days, summary }) => (
                    <tr key={staff._id}>
                      <td className={`${ui.td} font-semibold whitespace-nowrap sticky left-0 bg-white`}><Link to={`/staff/attendance/person?staff=${staff._id}&month=${month}`} className="hover:underline">{staff.name}</Link></td>
                      {data.days.map((d) => {
                        const c = days[d.date];
                        return (
                          <td key={d.date} className={`px-0.5 py-1 text-center border-r border-[#F3F4F6] ${d.off ? "bg-[#F3F4F6]" : ""}`} title={c ? `${formatDate(d.date)}: ${S[c.status]?.label}${c.minutes ? ` · ${hm(c.minutes)}` : ""}` : formatDate(d.date)}>
                            {c ? <span className={`inline-block w-5 border text-[10px] font-bold ${S[c.status]?.style}`}>{S[c.status]?.short}</span>
                              : !d.off && !d.future && data.workingDays ? <span className="text-[#D97706]">·</span> : ""}
                          </td>
                        );
                      })}
                      <td className={`${ui.td} text-right tabular-nums`}>{summary.workingDays}</td>
                      <td className={`${ui.td} text-right tabular-nums font-bold`}>{summary.present}</td>
                      <td className={`${ui.td} text-right tabular-nums`}>{summary.absent}</td>
                      <td className={`${ui.td} text-right tabular-nums`}>{summary.leave}</td>
                      <td className={`${ui.td} text-right tabular-nums ${summary.unmarked ? "text-[#92400E] font-semibold" : ""}`}>{summary.unmarked}</td>
                      <td className={`${ui.td} text-right tabular-nums font-bold`}>{summary.attendancePct.toFixed(1)}%</td>
                      <td className={`${ui.td} text-right tabular-nums whitespace-nowrap`}>{hm(summary.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <p className="text-[11px] text-[#6B7280]">Present counts half days as 0.5. Not marked = working days with no mark. Attendance % = present ÷ working days.</p>
        </div>
      </div>
    </>
  );
};

// ─── One staff member ──────────────────────────────────────────────────────
const PersonView = ({ store, month, setMonth, printRef, setCsv }) => {
  const [params, setParams] = useSearchParams();
  const staffId = params.get("staff") || "";
  const [staffList, setStaffList] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!store.locCode) return;
    api("/attendance/staff-list", { query: { locCode: store.locCode, all: "1" } }).then((d) => setStaffList(d.staff)).catch(() => setStaffList([]));
  }, [store.locCode]);
  useEffect(() => {
    if (!staffId) { setData(null); return undefined; }
    let active = true;
    setError("");
    api(`/attendance/staff/${staffId}`, { query: { month } }).then((d) => active && setData(d)).catch((e) => { if (active) { setError(e.message); setData(null); } });
    return () => { active = false; };
  }, [staffId, month]);
  useEffect(() => {
    setCsv(data ? data.days.map((d) => ({ Date: d.date, Day: WEEKDAY_FULL[d.weekday], Status: d.record ? S[d.record.status]?.label : d.off ? "Weekly off" : "",
      In: d.record?.inTime || "", "Break out": d.record?.breakOut || "", "Break in": d.record?.breakIn || "", Out: d.record?.outTime || "", Hours: hm(d.record?.minutes), Note: d.record?.note || "" })) : []);
  }, [data, setCsv]);
  const pickStaff = (id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("staff", id); else n.delete("staff"); return n; }, { replace: true });
  const s = data?.summary;
  return (
    <>
      <div className="px-6 pt-4 pb-2 flex flex-wrap items-end gap-3">
        <div><label className={ui.label}>Store</label><StoreSelect store={store} /></div>
        <div>
          <label className={ui.label}>Staff member</label>
          <select value={staffId} onChange={(e) => pickStaff(e.target.value)} className={`${ui.input} w-52`}>
            <option value="">Choose…</option>
            {staffList.map((x) => <option key={x._id} value={x._id}>{x.name}{x.isActive ? "" : " (inactive)"}</option>)}
            {staffId && data && !staffList.some((x) => x._id === staffId) && <option value={staffId}>{data.staff.name}</option>}
          </select>
        </div>
        <div><label className={ui.label}>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${ui.input} w-40`} /></div>
      </div>
      <div className="px-6 pb-8 pt-2">
        <div ref={printRef} className="space-y-3">
          <PrintHeader title="Staff attendance" lines={[data && `${data.staff.name} (${data.staff.employeeId}) · ${data.staff.storeName}`, `Month: ${month}`]} />
          {s && (
            <div className="flex flex-wrap gap-2 text-xs">
              {[["Working days", s.workingDays], ["Present", s.present], ["Half days", s.halfDays], ["Absent", s.absent], ["Leave", s.leave], ["Not marked", s.unmarked], ["Attendance", `${s.attendancePct.toFixed(1)}%`], ["Hours", hm(s.minutes)]].map(([l, v]) => (
                <span key={l} className="inline-flex items-center gap-1.5 border border-[#E5E7EB] bg-white px-3 py-1 font-semibold text-[#111827]">{l} <b>{v}</b></span>
              ))}
            </div>
          )}
          <section className={`${ui.card} overflow-x-auto print:shadow-none`}>
            {!staffId ? <Msg>Choose a staff member.</Msg> : error ? <Msg tone="error">{error}</Msg> : !data ? <Msg>Loading…</Msg> : (
              <table className="min-w-full border-collapse">
                <thead><tr className={ui.theadRow}>
                  <th className={ui.th}>Date</th><th className={ui.th}>Day</th><th className={ui.th}>Status</th>{TIME_FIELDS.map(([k, l]) => <th key={k} className={ui.th}>{l}</th>)}<th className={ui.th}>Hours</th><th className="px-3 py-3 text-left">Note</th>
                </tr></thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs">
                  {data.days.map((d) => (
                    <tr key={d.date} className={d.off ? "bg-[#F9FAFB] text-[#6B7280]" : !d.record && !d.future ? "bg-[#FFFBEB]" : ""}>
                      <td className={`${ui.td} whitespace-nowrap`}>{formatDate(d.date)}</td>
                      <td className={ui.td}>{WEEKDAYS[d.weekday]}</td>
                      <td className={ui.td}>{d.record ? <Badge status={d.record.status} /> : d.off ? "Weekly off" : d.future ? "" : <span className="text-[11px] font-bold uppercase text-[#92400E]">Not marked</span>}</td>
                      {TIME_FIELDS.map(([k]) => <td key={k} className={`${ui.td} tabular-nums`}>{d.record?.[k] || ""}</td>)}
                      <td className={`${ui.td} tabular-nums`}>{hm(d.record?.minutes)}</td>
                      <td className={ui.td}>{d.record?.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
};

// ─── Page shell ────────────────────────────────────────────────────────────
const Attendance = () => {
  const isSidebarOpen = useSidebar();
  const { view } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const store = useStoreChoice({ allowAll: false });
  const [date, setDate] = useState(params.get("date") || todayIST());
  const [month, setMonth] = useState(params.get("month") || todayIST().slice(0, 7));
  const [csv, setCsv] = useState([]);
  const printRef = useRef(null);
  const current = VIEWS.find((v) => v.key === view);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: () => `Attendance - ${current?.label || ""}`, pageStyle: view === "monthly" ? PRINT_PAGE_STYLE : PRINT_PAGE_STYLE.replace("landscape", "portrait") });
  useEffect(() => setCsv([]), [view]);
  const csvName = useMemo(() => `attendance-${view}-${view === "daily" || view === "mark" ? date : month}`, [view, date, month]);
  if (!current) return <Navigate to="/staff/attendance/mark" replace />;

  return (
    <>
      <Header title="Staff Attendance" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>Staff Attendance</h1>
              <p className={ui.sub}>Admins can mark any store; a store manager marks their own store. One mark per person per day.</p>
            </div>
            {view !== "mark" && <ReportActions csvData={csv} csvName={csvName} onPrint={() => print()} disabled={!csv.length} />}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" onClick={() => navigate(`/staff/attendance/${v.key}`)}
                className={`h-8 px-3.5 text-xs font-bold uppercase tracking-wider border ${v.key === view ? "bg-[#1C1F26] text-white border-[#1C1F26]" : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F3F4F6]"}`}>{v.label}</button>
            ))}
          </div>
        </div>
        {view === "mark" && <MarkView store={store} date={date} setDate={setDate} />}
        {view === "daily" && <DailyView store={store} date={date} setDate={setDate} printRef={printRef} setCsv={setCsv} />}
        {view === "monthly" && <MonthlyView store={store} month={month} setMonth={setMonth} printRef={printRef} setCsv={setCsv} />}
        {view === "person" && <PersonView store={store} month={month} setMonth={setMonth} printRef={printRef} setCsv={setCsv} />}
      </div>
    </>
  );
};

export default Attendance;
