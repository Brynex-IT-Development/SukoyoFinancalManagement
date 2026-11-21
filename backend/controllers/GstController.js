import CompanyProfile from "../model/CompanyProfile.js";
import BusinessCustomer from "../model/BusinessCustomer.js";
import { requireUser } from "../utils/userScope.js";
import { validateGstin, isValidStateCode, stateName, PAN_RE, IFSC_RE, GST_STATES } from "../utils/gst.js";

const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

const TEXT_FIELDS = ["businessType", "companyName", "ownerName", "phone", "altPhone", "email", "website", "address", "city", "state",
  "stateCode", "pincode", "gstin", "pan", "cin", "tradeLicense", "bankName", "accountHolder", "accountNumber", "ifsc", "branch",
  "upiId", "invoiceFooterNote"];
const MAX_LOGO_CHARS = 1_500_000; // ~1 MB image as base64

// GET /api/company-profile — read by every printout, so no user check (the same details are printed on invoices)
export const getCompanyProfileApi = async (req, res) => {
  try {
    const p = await CompanyProfile.findOne({ key: "default" }).lean();
    res.json({ profile: p || null, states: GST_STATES });
  } catch (err) { serverError(res, err, "Get company profile"); }
};

// PUT /api/company-profile — admin. Validates GSTIN (offline), state code, PAN, IFSC.
export const saveCompanyProfile = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const b = req.body || {};
    const data = {};
    for (const k of TEXT_FIELDS) if (b[k] !== undefined) data[k] = String(b[k] ?? "").trim();
    for (const k of ["gstin", "pan", "cin", "ifsc"]) if (data[k] !== undefined) data[k] = data[k].toUpperCase().replace(/\s+/g, "");

    if (!data.companyName) return res.status(400).json({ message: "Company name is required." });
    if (data.stateCode && !isValidStateCode(data.stateCode)) return res.status(400).json({ message: `${data.stateCode} is not a valid GST state code.` });
    if (data.gstin) {
      const v = validateGstin(data.gstin);
      if (!v.valid) return res.status(400).json({ message: `GSTIN: ${v.error}` });
      if (data.stateCode && data.stateCode !== v.stateCode) {
        return res.status(400).json({ message: `The GSTIN is registered in state ${v.stateCode} (${v.stateName}) but the state code is ${data.stateCode}.` });
      }
      data.stateCode = v.stateCode;
      if (data.pan && data.pan !== v.pan) return res.status(400).json({ message: `PAN ${data.pan} does not match the GSTIN (its PAN is ${v.pan}).` });
      data.pan = v.pan;
    }
    if (data.stateCode && !data.state) data.state = stateName(data.stateCode);
    if (data.pan && !PAN_RE.test(data.pan)) return res.status(400).json({ message: "PAN must look like ABCDE1234F." });
    if (data.ifsc && !IFSC_RE.test(data.ifsc)) return res.status(400).json({ message: "IFSC must look like SBIN0001234." });
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return res.status(400).json({ message: "Email address is not valid." });
    if (data.pincode && !/^\d{6}$/.test(data.pincode)) return res.status(400).json({ message: "Pincode must be 6 digits." });

    if (b.logo !== undefined) {
      const logo = String(b.logo || "");
      if (logo && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(logo)) return res.status(400).json({ message: "Logo must be an image." });
      if (logo.length > MAX_LOGO_CHARS) return res.status(400).json({ message: "Logo image is too large (keep it under about 1 MB)." });
      data.logo = logo;
    }
    data.updatedBy = who.user.email || who.user.username || "";

    const profile = await CompanyProfile.findOneAndUpdate({ key: "default" }, { $set: data, $setOnInsert: { key: "default" } }, { upsert: true, new: true }).lean();
    res.json({ profile });
  } catch (err) { serverError(res, err, "Save company profile"); }
};

// GET /api/gst/gstin/:gstin?userId= — offline validation + the saved business for this GSTIN (if billed before)
export const lookupGstin = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const v = validateGstin(req.params.gstin);
    if (!v.valid) return res.status(400).json({ ...v, message: v.error });
    const business = await BusinessCustomer.findOne({ gstin: v.gstin }).lean();
    const company = await CompanyProfile.findOne({ key: "default" }).select("stateCode gstin").lean();
    res.json({ ...v, business: business || null, intra: company?.stateCode ? company.stateCode === v.stateCode : null, companyStateCode: company?.stateCode || "" });
  } catch (err) { serverError(res, err, "GSTIN lookup"); }
};

// GET /api/business-customers?userId=&search= — saved business buyers (by name or GSTIN)
export const listBusinessCustomers = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const term = String(req.query.search || "").trim();
    const q = term ? { $or: [{ legalName: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { gstin: { $regex: term.toUpperCase().replace(/[^A-Z0-9]/g, "") } }] } : {};
    const businesses = await BusinessCustomer.find(q).sort({ updatedAt: -1 }).limit(50).lean();
    res.json({ businesses });
  } catch (err) { serverError(res, err, "List business customers"); }
};
