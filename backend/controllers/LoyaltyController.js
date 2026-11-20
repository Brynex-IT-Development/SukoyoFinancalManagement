import LoyaltySettings from "../model/LoyaltySettings.js";
import { requireUser } from "../utils/userScope.js";
import { getLoyaltySettings } from "../utils/redemptions.js";
import { DEFAULT_LOYALTY_SETTINGS, valuePerPoint } from "../utils/retailMath.js";

const NUMERIC = ["earnAmount", "earnPoints", "minInvoiceForEarning", "redeemAmount", "redeemPoints", "maxRedeemPercent", "minInvoiceForRedeem"];

// GET /api/loyalty/settings?userId=&locCode=
// Effective settings for a store, every active row, and the change history.
export const getSettings = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const locCode = req.query.locCode || who.user.locCode || null;
    const [effective, active, history] = await Promise.all([
      getLoyaltySettings(locCode),
      LoyaltySettings.find({ active: true }).sort({ locCode: 1 }).lean(),
      LoyaltySettings.find({}).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    res.json({ effective: { ...effective, valuePerPoint: valuePerPoint(effective) }, active, history, defaults: DEFAULT_LOYALTY_SETTINGS });
  } catch (err) {
    console.error("Loyalty settings error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// POST /api/loyalty/settings — admin. Creates a new version; the previous one for the same scope becomes inactive.
// body: { userId, locCode (null/"" = default for all stores), earnAmount, earnPoints, ..., active }
export const saveSettings = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const locCode = req.body.locCode ? String(req.body.locCode) : null;
    const data = {};
    for (const k of NUMERIC) {
      const v = req.body[k] === undefined || req.body[k] === "" ? DEFAULT_LOYALTY_SETTINGS[k] : Number(req.body[k]);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ message: `${k} must be a number of 0 or more.` });
      data[k] = v;
    }
    if (!(data.earnAmount > 0) || !(data.redeemAmount > 0) || !(data.redeemPoints > 0)) {
      return res.status(400).json({ message: "Earn amount, redeem amount and redeem points must be more than 0." });
    }
    if (!Number.isInteger(data.earnPoints) || !Number.isInteger(data.redeemPoints)) {
      return res.status(400).json({ message: "Points must be whole numbers." });
    }
    if (data.maxRedeemPercent > 100) return res.status(400).json({ message: "Max redeem % cannot be more than 100." });

    const row = await LoyaltySettings.create({
      ...data, locCode, enabled: req.body.enabled !== false, active: true,
      updatedBy: who.user.email || who.user.username || "",
    });
    await LoyaltySettings.updateMany({ locCode, active: true, _id: { $ne: row._id } }, { $set: { active: false } });
    res.status(201).json(row);
  } catch (err) {
    console.error("Save loyalty settings error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// POST /api/loyalty/settings/remove-override { userId, locCode } — admin. The store falls back to the default.
export const removeStoreOverride = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const locCode = req.body.locCode ? String(req.body.locCode) : null;
    if (!locCode) return res.status(400).json({ message: "Pick a store. The default settings cannot be removed, only changed." });
    const r = await LoyaltySettings.updateMany({ locCode, active: true }, { $set: { active: false } });
    res.json({ removed: r.modifiedCount });
  } catch (err) {
    console.error("Remove loyalty override error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
