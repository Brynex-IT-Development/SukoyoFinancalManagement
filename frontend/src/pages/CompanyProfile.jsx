import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import SingleImageUpload from "../components/SingleImageUpload";
import { setCompanyProfileCache } from "../hooks/useCompanyProfile";
import { api, isAdminUser, ui } from "../utils/retailApi";
import { validateGstin, GST_STATES, PAN_RE, IFSC_RE } from "../utils/gst";

const EMPTY = {
  businessType: "", companyName: "", ownerName: "", logo: "", phone: "", altPhone: "", email: "", website: "",
  address: "", city: "", state: "", stateCode: "", pincode: "", gstin: "", pan: "", cin: "", tradeLicense: "",
  bankName: "", accountHolder: "", accountNumber: "", ifsc: "", branch: "", upiId: "", invoiceFooterNote: "",
};

// F7: the business's own details. Printouts read header, GSTIN and bank details from here;
// the state code decides intra- vs inter-state GST on business invoices.
const CompanyProfile = () => {
  const isSidebarOpen = useSidebar();
  const [f, setF] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: "", ok: true });

  useEffect(() => {
    api("/company-profile")
      .then((d) => d.profile && setF({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, d.profile[k] ?? ""])) }))
      .catch((e) => setMsg({ text: e.message, ok: false }))
      .finally(() => setLoading(false));
  }, []);

  const gst = useMemo(() => (f.gstin.trim() ? validateGstin(f.gstin) : null), [f.gstin]);

  // A valid GSTIN fills state code, state and PAN
  useEffect(() => {
    if (!gst?.valid) return;
    setF((p) => ({ ...p, stateCode: gst.stateCode, state: p.state && p.stateCode === gst.stateCode ? p.state : gst.stateName, pan: gst.pan }));
  }, [gst?.valid, gst?.stateCode, gst?.pan]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdminUser()) return <Navigate to="/" />;

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const problems = [
    gst && !gst.valid && `GSTIN: ${gst.error}`,
    f.pan && !PAN_RE.test(f.pan.toUpperCase()) && "PAN must look like ABCDE1234F.",
    f.ifsc && !IFSC_RE.test(f.ifsc.toUpperCase()) && "IFSC must look like SBIN0001234.",
    f.pincode && !/^\d{6}$/.test(f.pincode) && "Pincode must be 6 digits.",
  ].filter(Boolean);

  const save = async (e) => {
    e.preventDefault();
    if (!f.companyName.trim()) return setMsg({ text: "Company name is required.", ok: false });
    if (problems.length) return setMsg({ text: problems[0], ok: false });
    setSaving(true);
    setMsg({ text: "", ok: true });
    try {
      const { profile } = await api("/company-profile", { method: "PUT", body: f });
      setF({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, profile[k] ?? ""])) });
      setCompanyProfileCache(profile);
      setMsg({ text: "Company profile saved. Invoices and slips now print these details.", ok: true });
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const field = (k, label, props = {}) => (
    <div>
      <label className={ui.label}>{label}{props.required && <span className="text-red-500"> *</span>}</label>
      <input value={f[k]} onChange={set(k)} className={ui.input} {...props} />
    </div>
  );
  const section = (title, children, note) => (
    <section className={`${ui.card} p-5 space-y-4`}>
      <div>
        <p className={ui.sectionTitle}>{title}</p>
        {note && <p className="text-[11px] text-[#6B7280] -mt-2">{note}</p>}
      </div>
      {children}
    </section>
  );

  return (
    <>
      <Header title="Company Profile" />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <h1 className={ui.h1}>Company Profile</h1>
          <p className={ui.sub}>Printed on sales invoices, GST tax invoices, store credit slips, gift cards and vouchers.</p>
        </div>

        <form onSubmit={save} className="px-6 py-5 space-y-5 max-w-5xl">
          {loading ? <p className="text-xs text-[#6B7280]">Loading...</p> : (
            <>
              {section("Business", (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {field("companyName", "Company name", { required: true })}
                    {field("businessType", "Business type", { placeholder: "e.g. Jewellery retail" })}
                    {field("ownerName", "Owner name")}
                    {field("cin", "CIN", { style: { textTransform: "uppercase" } })}
                    {field("tradeLicense", "Trade licence no.")}
                    {field("website", "Website")}
                  </div>
                  <div>
                    <label className={ui.label}>Logo</label>
                    <SingleImageUpload
                      existingImage={f.logo || null}
                      onImageSelect={(img) => setF((p) => ({ ...p, logo: img.base64 }))}
                      onRemoveImage={() => setF((p) => ({ ...p, logo: "" }))}
                    />
                  </div>
                </div>
              ))}

              {section("Contact & address", (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {field("phone", "Phone")}
                  {field("altPhone", "Alternate phone")}
                  <div className="md:col-span-2">{field("email", "Email", { type: "email" })}</div>
                  <div className="md:col-span-4">{field("address", "Address")}</div>
                  {field("city", "City")}
                  {field("state", "State")}
                  {field("pincode", "Pincode", { inputMode: "numeric", maxLength: 6 })}
                </div>
              ))}

              {section("GST & tax", (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    {field("gstin", "GSTIN", { maxLength: 15, style: { textTransform: "uppercase" }, placeholder: "15 characters" })}
                    {gst && <p className={`text-[11px] mt-1 font-semibold ${gst.valid ? "text-[#15803D]" : "text-red-600"}`}>{gst.valid ? `Valid · ${gst.stateName} (${gst.stateCode})` : gst.error}</p>}
                  </div>
                  <div>
                    <label className={ui.label}>GST state code</label>
                    <select value={f.stateCode} onChange={set("stateCode")} disabled={!!gst?.valid} className={ui.input}>
                      <option value="">Choose…</option>
                      {Object.entries(GST_STATES).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                    </select>
                  </div>
                  {field("pan", "PAN", { maxLength: 10, style: { textTransform: "uppercase" }, disabled: !!gst?.valid })}
                </div>
              ), "The state code decides CGST + SGST (same state) or IGST (other state) on business invoices. A valid GSTIN sets it, and the PAN, automatically.")}

              {section("Bank details (printed on invoices)", (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {field("bankName", "Bank name")}
                  {field("accountHolder", "Account holder")}
                  {field("accountNumber", "Account number", { inputMode: "numeric" })}
                  {field("ifsc", "IFSC", { maxLength: 11, style: { textTransform: "uppercase" } })}
                  {field("branch", "Branch")}
                  {field("upiId", "UPI ID")}
                </div>
              ))}

              {section("Invoice footer", (
                <textarea value={f.invoiceFooterNote} onChange={set("invoiceFooterNote")} rows={2} placeholder="e.g. Goods once sold can be exchanged within 7 days with the bill."
                  className="w-full px-3 py-2 rounded-none border border-[#E5E7EB] bg-white text-xs text-[#111827] focus:border-[#1C1F26] focus:outline-none" />
              ))}

              {msg.text && <p className={`text-xs font-semibold px-3 py-2 border ${msg.ok ? "text-[#1C1F26] bg-[#F6FCE6] border-[#ECF9C7]" : "text-red-700 bg-red-50 border-red-200"}`}>{msg.text}</p>}
              <div className="flex justify-end">
                <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving..." : "Save company profile"}</button>
              </div>
            </>
          )}
        </form>
      </div>
    </>
  );
};

export default CompanyProfile;
