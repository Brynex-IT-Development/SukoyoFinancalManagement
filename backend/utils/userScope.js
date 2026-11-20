// Identify the requesting user the same way the sales invoice endpoints do (the client
// sends its email/username as userId; there is no server-side session) and work out
// which stores they may see.
//
// NOTE: this trusts the userId the client sends. There is no authentication on the API,
// so anyone who can reach it can claim to be any user. See the Phase 1 report.
import mongoose from "mongoose";
import User from "../model/UserModel.js";

const escapeRegex = (s) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

export const findUser = async (userId) => {
  const id = (userId || "").toString().trim();
  if (!id) return null;
  const or = [
    { email: { $regex: new RegExp(`^${escapeRegex(id)}$`, "i") } },
    { username: { $regex: new RegExp(`^${escapeRegex(id)}$`, "i") } },
  ];
  if (mongoose.Types.ObjectId.isValid(id)) or.push({ _id: id });
  return User.findOne({ $or: or }).lean();
};

export const isAdminUser = (user) =>
  !!user && (user.power === "admin" || user.role === "admin" || user.role === "superadmin");

/** { all: true } for admins, otherwise { locCodes: [...] } the user may see. */
export const scopeOf = (user) => {
  if (!user) return { locCodes: [] };
  if (isAdminUser(user)) return { all: true };
  if (user.role === "cluster_manager") {
    const codes = (user.allowedLocCodes || []).map(String).filter(Boolean);
    return { locCodes: codes.length ? codes : [String(user.locCode || "")].filter(Boolean) };
  }
  return { locCodes: [String(user.locCode || "")].filter(Boolean) };
};

/** Mongo filter limiting `field` to the user's stores ({} for admins). */
export const locFilter = (scope, field = "locCode") => (scope.all ? {} : { [field]: { $in: scope.locCodes } });

export const canSeeLoc = (scope, locCode) => scope.all || scope.locCodes.includes(String(locCode || ""));

/**
 * Express helper: resolve the user from body/query/header and reply 401 when unknown.
 * Returns { user, scope } or null (response already sent).
 */
export const requireUser = async (req, res, { admin = false } = {}) => {
  const userId = req.body?.userId || req.query?.userId || req.headers["x-user-id"];
  const user = await findUser(userId);
  if (!user) {
    res.status(401).json({ message: "Unknown user. Please log in again." });
    return null;
  }
  if (admin && !isAdminUser(user)) {
    res.status(403).json({ message: "Only an admin can do this." });
    return null;
  }
  return { user, scope: scopeOf(user) };
};
