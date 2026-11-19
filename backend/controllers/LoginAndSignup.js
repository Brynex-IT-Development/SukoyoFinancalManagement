import bcrypt from 'bcryptjs';
import User from '../model/UserModel.js';
import Store from '../model/Store.js';
import { isAllowedStore, fallbackStores } from './StoreController.js';

// ── Shared user validation ────────────────────────────────────────────
const ROLE_VALUES = ["admin", "superadmin", "store_manager", "store_user", "cluster_manager"];
const ADMIN_ROLES = ["admin", "superadmin"];
const SINGLE_STORE_ROLES = ["store_user", "store_manager"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Normalises and checks a create/update body. Returns { error } or { data }.
// A user with no role but a Loc Code is a *store account* (created from Add New Store).
const normaliseUserInput = (body) => {
    const username = (body.username || "").toString().trim();
    const email = (body.email || "").toString().trim();
    const role = body.role ? body.role.toString().trim() : null;
    let locCode = (body.locCode || "").toString().trim();
    let allowedLocCodes = Array.isArray(body.allowedLocCodes) ? [...new Set(body.allowedLocCodes.map(String))] : [];

    if (!username || !email) return { error: "Name and email are required." };
    if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };
    if (role && !ROLE_VALUES.includes(role)) return { error: `Unknown role "${role}".` };
    if (SINGLE_STORE_ROLES.includes(role) && !locCode) return { error: "Choose the store this user works in." };
    if (role === "cluster_manager" && allowedLocCodes.length === 0) return { error: "Assign at least one store to a cluster manager." };
    if (role === "cluster_manager") locCode = "";
    if (role !== "cluster_manager") allowedLocCodes = [];

    // Admin pages are gated on power === 'admin', so admin roles always get admin power.
    const power = ADMIN_ROLES.includes(role) ? "admin" : body.power === "admin" ? "admin" : "normal";

    return {
        data: {
            username, email, role, power, locCode, allowedLocCodes,
            address: (body.address || "").toString().trim(),
            phone: (body.phone || "").toString().trim(),
            gst: (body.gst || "").toString().trim().toUpperCase(),
            isStore: !role && power !== "admin" && !!locCode,
        },
    };
};

// Rejects duplicate emails, duplicate store Loc Codes / names, and cluster-manager store clashes.
const findConflict = async (data, excludeId = null) => {
    const notMe = excludeId ? { _id: { $ne: excludeId } } : {};
    const emailTaken = await User.findOne({ ...notMe, email: new RegExp(`^${escapeRe(data.email)}$`, "i") });
    if (emailTaken) return "This email is already used by another login.";
    if (data.isStore) {
        const codeTaken = await User.findOne({ ...notMe, role: null, locCode: data.locCode });
        if (codeTaken) return `Loc Code ${data.locCode} is already used by store "${codeTaken.username}".`;
        const nameTaken = await User.findOne({ ...notMe, role: null, locCode: { $nin: ["", null] }, username: new RegExp(`^${escapeRe(data.username)}$`, "i") });
        if (nameTaken) return `A store named "${data.username}" already exists.`;
    }
    if (data.role === "cluster_manager") {
        const clash = await User.findOne({ ...notMe, role: "cluster_manager", allowedLocCodes: { $in: data.allowedLocCodes } });
        if (clash) return `Some of these stores are already assigned to cluster manager "${clash.username}".`;
    }
    return null;
};

// Keep the Store collection in step with a store account (never for staff users,
// otherwise saving a staff member would rename their store to the person's name).
const syncStoreRecord = async (data) => {
    if (!data.isStore) return;
    try {
        await Store.findOneAndUpdate(
            { locCode: data.locCode },
            {
                $set: {
                    name: data.username,
                    locCode: data.locCode,
                    address: data.address || '',
                    phone: data.phone || '',
                    email: data.email || '',
                    isActive: true,
                },
                $setOnInsert: { storeType: 'branch' },
            },
            { upsert: true, new: true }
        );
    } catch (err) {
        console.warn("Could not sync Store record:", err.message);
    }
};

export const SignUp = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long." });
        }

        const { error, data } = normaliseUserInput(req.body);
        if (error) return res.status(400).json({ message: error });

        const conflict = await findConflict(data);
        if (conflict) return res.status(400).json({ message: conflict });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            username: data.username,
            email: data.email,
            power: data.power,
            password: hashedPassword,
            locCode: data.locCode,
            address: data.address,
            phone: data.phone,
            gst: data.gst,
            role: data.role,
            allowedLocCodes: data.allowedLocCodes,
        });

        await newUser.save();
        await syncStoreRecord(data);

        const safeUser = newUser.toObject();
        delete safeUser.password;
        res.status(201).json({
            message: data.isStore ? 'Store created successfully.' : 'User created successfully.',
            user: safeUser,
        });
    } catch (error) {
        console.error('SignUp Error:', error);
        res.status(500).json({
            message: 'An error occurred while creating the user.',
            error: error.message,
        });
    }
};








export const Login = async (req, res) => {
    try {
        const { email, EmpId: password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        // Generate JWT token


        res.status(200).json({
            message: 'Login successful',

            user: {
                email: user.email,
                username: user.username,
                power: user.power,
                locCode: user.locCode,
                role: user.role || null,
                storeName: user.storeName || user.username,
                storeId: user.storeId,
                allowedLocCodes: user.allowedLocCodes || [],
            },
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({
            message: 'An error occurred during login.',
            error: error.message,
        });
    }
};

export const GetAllStores = async (req, res) => {
    try {
        const users = await User.find({ locCode: { $exists: true, $ne: "" } }, { password: 0 });
        const storeMap = new Map();
        
        // Seed with fallback stores (Warehouse and MG Road)
        fallbackStores.forEach(s => {
            storeMap.set(s.locCode, { locName: s.name || s.locName, locCode: s.locCode });
        });

        // Add active/newly created stores from users
        users.forEach(user => {
            const code = (user.locCode || "").toString().trim();
            const name = (user.username || "").trim();
            const loc = { locName: name, locCode: code, name: name };
            if (code && isAllowedStore(loc)) {
                storeMap.set(code, { locName: name, locCode: code });
            }
        });

        const stores = Array.from(storeMap.values()).sort((a, b) => 
            a.locName.localeCompare(b.locName)
        );
        
        res.status(200).json({
            message: 'Stores retrieved successfully',
            stores: stores,
        });
    } catch (error) {
        console.error('GetAllStores Error:', error);
        res.status(500).json({
            message: 'An error occurred while fetching stores.',
            error: error.message,
        });
    }
};

export const GetAllUsers = async (req, res) => {
    try {
        const users = await User.find({}, { password: 0 }).sort({ createdAt: -1 }); // Exclude password, sort by newest first
        
        res.status(200).json({
            message: 'Users retrieved successfully',
            users: users,
        });
    } catch (error) {
        console.error('GetAllUsers Error:', error);
        res.status(500).json({
            message: 'An error occurred while fetching users.',
            error: error.message,
        });
    }
};

export const UpdateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const { error, data } = normaliseUserInput(req.body);
        if (error) return res.status(400).json({ message: error });

        const conflict = await findConflict(data, id);
        if (conflict) return res.status(400).json({ message: conflict });

        // Never leave the system without an admin.
        if (user.power === 'admin' && data.power !== 'admin') {
            const otherAdmins = await User.countDocuments({ _id: { $ne: id }, power: 'admin' });
            if (otherAdmins === 0) {
                return res.status(400).json({ message: 'This is the only admin. Make another user an admin first.' });
            }
        }

        user.username = data.username;
        user.email = data.email;
        user.locCode = data.locCode;
        user.address = data.address;
        user.phone = data.phone;
        user.gst = data.gst;
        user.power = data.power;
        user.role = data.role;
        user.allowedLocCodes = data.allowedLocCodes;

        // Only update password if provided
        if (password && password.trim() !== '') {
            if (password.length < 6) {
                return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
            }
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();
        await syncStoreRecord(data);

        res.status(200).json({
            message: 'User updated successfully.',
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                locCode: user.locCode,
                address: user.address,
                phone: user.phone,
                gst: user.gst,
                power: user.power,
                role: user.role,
                allowedLocCodes: user.allowedLocCodes,
            },
        });
    } catch (error) {
        console.error('UpdateUser Error:', error);
        res.status(500).json({
            message: 'An error occurred while updating the user.',
            error: error.message,
        });
    }
};


export const DeleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        if (user.power === 'admin') {
            const otherAdmins = await User.countDocuments({ _id: { $ne: id }, power: 'admin' });
            if (otherAdmins === 0) {
                return res.status(400).json({ message: 'This is the only admin and cannot be deleted.' });
            }
        }
        await User.findByIdAndDelete(id);
        res.status(200).json({ message: 'User deleted successfully.' });
    } catch (error) {
        console.error('DeleteUser Error:', error);
        res.status(500).json({ message: 'An error occurred while deleting the user.', error: error.message });
    }
};


export const ResetPassword = async (req, res) => {
    try {
        const { email, newPassword } = req.body;

        // Validate input
        if (!email || !newPassword) {
            return res.status(400).json({ message: 'Email and new password are required.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        user.password = hashedPassword;
        await user.save();

        res.status(200).json({
            message: 'Password reset successfully.',
            user: {
                email: user.email,
                username: user.username,
            },
        });
    } catch (error) {
        console.error('ResetPassword Error:', error);
        res.status(500).json({
            message: 'An error occurred while resetting the password.',
            error: error.message,
        });
    }
};
