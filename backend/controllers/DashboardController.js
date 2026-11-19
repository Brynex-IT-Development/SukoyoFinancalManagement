// Live numbers for the admin dashboard (Home page).
// GET /api/dashboard/summary?locCode=858&locName=Warehouse   (omit both for all stores)
//
// Rules (same as the Sales Report):
//  - A sale is a SalesInvoice whose category is not "Return". Drafts are ignored.
//  - Returns are SalesInvoices with category "Return"; their finalTotal is negative,
//    so net sales = sales + returns.
//  - Purchases are Bills that are not drafts / cancelled.
//  - Customers have no collection of their own: a customer is identified by phone
//    (or by name when no phone was entered) on the invoice.
// All "today / this month" boundaries use India time (UTC+05:30).
import SalesInvoice from "../model/SalesInvoice.js";
import Bill from "../model/Bill.js";

const IST_MIN = 330;
const TZ = "+05:30";
const DAY = 86400000;

// Start of the IST day containing `ms`, returned as a UTC Date.
const istDayStart = (ms) => {
  const shifted = ms + IST_MIN * 60000;
  return new Date(shifted - (shifted % DAY) - IST_MIN * 60000);
};
// Start of an IST month (y, m may overflow; Date.UTC normalises).
const istMonthStart = (y, m) => new Date(Date.UTC(y, m, 1) - IST_MIN * 60000);
const istParts = (ms) => {
  const d = new Date(ms + IST_MIN * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
};

const pct = (cur, prev) => {
  if (!prev) return cur ? null : 0; // null = "new" (no baseline to compare with)
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Invoices / bills store the store in locCode, and sometimes only as a name in branch/warehouse.
const storeMatch = (locCode, locName) => {
  if (!locCode) return {};
  const or = [{ locCode }, { warehouse: locCode }, { branch: locCode }];
  if (locName) {
    const nameRe = new RegExp(`^${escapeRe(locName.trim()).replace(/\s+/g, "\\s*")}$`, "i");
    or.push({ branch: nameRe }, { warehouse: nameRe });
  }
  return { $or: or };
};

const notDraft = { status: { $nin: ["draft", "Draft"] } };
const SALE = { category: { $ne: "Return" } };
const RETURN = { category: "Return" };

const sumField = async (Model, match, field) => {
  const [r] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` }, count: { $sum: 1 } } }]);
  return { total: r?.total || 0, count: r?.count || 0 };
};

export const getDashboardSummary = async (req, res) => {
  try {
    const locCode = (req.query.locCode || "").toString().trim();
    const locName = (req.query.locName || "").toString().trim();
    const store = storeMatch(locCode, locName);

    const now = Date.now();
    const { y, m } = istParts(now);
    const todayStart = istDayStart(now);
    const monthStart = istMonthStart(y, m);
    const lastMonthStart = istMonthStart(y, m - 1);
    // Same point in last month (month-to-date comparison), capped at last month's end.
    const elapsed = now - monthStart.getTime();
    const lastMonthSameTime = new Date(Math.min(lastMonthStart.getTime() + elapsed, monthStart.getTime()));

    const inv = (extra) => ({ ...store, ...notDraft, ...extra });
    const bill = (extra) => ({ ...store, status: { $nin: ["draft", "Draft", "cancelled", "Cancelled", "void"] }, ...extra });
    const between = (field, a, b) => ({ [field]: { $gte: a, $lt: b } });

    // ── 1. Sales & purchases, month to date vs same period last month ──
    const [salesMtd, returnsMtd, salesPrev, returnsPrev, billsMtd, billsPrev] = await Promise.all([
      sumField(SalesInvoice, inv({ ...SALE, ...between("invoiceDate", monthStart, new Date(now + 1)) }), "finalTotal"),
      sumField(SalesInvoice, inv({ ...RETURN, ...between("invoiceDate", monthStart, new Date(now + 1)) }), "finalTotal"),
      sumField(SalesInvoice, inv({ ...SALE, ...between("invoiceDate", lastMonthStart, lastMonthSameTime) }), "finalTotal"),
      sumField(SalesInvoice, inv({ ...RETURN, ...between("invoiceDate", lastMonthStart, lastMonthSameTime) }), "finalTotal"),
      sumField(Bill, bill(between("billDate", monthStart, new Date(now + 1))), "finalTotal"),
      sumField(Bill, bill(between("billDate", lastMonthStart, lastMonthSameTime)), "finalTotal"),
    ]);
    const netSales = salesMtd.total + returnsMtd.total;
    const netSalesPrev = salesPrev.total + returnsPrev.total;

    // ── 2. Orders (invoice count) for 12h / 24h / 7 days / 30 days ──
    const ranges = { "12h": 12 * 3600000, "24h": DAY, week: 7 * DAY, month: 30 * DAY };
    const orderEntries = await Promise.all(
      Object.entries(ranges).map(async ([key, span]) => {
        const [cur, prev] = await Promise.all([
          sumField(SalesInvoice, inv({ ...SALE, ...between("invoiceDate", new Date(now - span), new Date(now + 1)) }), "finalTotal"),
          sumField(SalesInvoice, inv({ ...SALE, ...between("invoiceDate", new Date(now - 2 * span), new Date(now - span)) }), "finalTotal"),
        ]);
        return [key, { count: cur.count, revenue: cur.total, prevCount: prev.count, changePct: pct(cur.count, prev.count) }];
      })
    );
    const ordersToday = await SalesInvoice.countDocuments(inv({ ...SALE, invoiceDate: { $gte: todayStart } }));

    // ── 3. Customers: first purchase date per customer ──
    const customerKey = {
      $cond: [
        { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$customerPhone", ""] } } } }, 0] },
        { $trim: { input: "$customerPhone" } },
        { $toLower: { $trim: { input: { $ifNull: ["$customer", ""] } } } },
      ],
    };
    const customers = await SalesInvoice.aggregate([
      { $match: inv(SALE) },
      { $group: { _id: customerKey, first: { $min: "$invoiceDate" }, last: { $max: "$invoiceDate" } } },
      { $match: { _id: { $nin: ["", "walk-in", "walk in customer", "walk-in customer", "cash"] } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          newThisMonth: { $sum: { $cond: [{ $gte: ["$first", monthStart] }, 1, 0] } },
          newLastMonth: { $sum: { $cond: [{ $and: [{ $gte: ["$first", lastMonthStart] }, { $lt: ["$first", lastMonthSameTime] }] }, 1, 0] } },
          activeThisMonth: { $sum: { $cond: [{ $gte: ["$last", monthStart] }, 1, 0] } },
        },
      },
    ]);
    const c = customers[0] || { total: 0, newThisMonth: 0, newLastMonth: 0, activeThisMonth: 0 };

    // ── 4. Sales chart: last 7 days and last 6 months (net of returns) ──
    const dailyRaw = await SalesInvoice.aggregate([
      { $match: inv({ invoiceDate: { $gte: new Date(todayStart.getTime() - 13 * DAY) } }) },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$invoiceDate", timezone: TZ } }, total: { $sum: "$finalTotal" }, orders: { $sum: { $cond: [{ $ne: ["$category", "Return"] }, 1, 0] } } } },
    ]);
    const dailyMap = Object.fromEntries(dailyRaw.map((d) => [d._id, d]));
    const dayKey = (ms) => new Date(ms + IST_MIN * 60000).toISOString().slice(0, 10);
    const weekly = Array.from({ length: 7 }, (_, i) => {
      const ms = todayStart.getTime() - (6 - i) * DAY;
      const cur = dailyMap[dayKey(ms)]?.total || 0;
      const prev = dailyMap[dayKey(ms - 7 * DAY)]?.total || 0;
      return {
        label: new Date(ms + IST_MIN * 60000).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
        date: dayKey(ms),
        value: Math.round(cur * 100) / 100,
        orders: dailyMap[dayKey(ms)]?.orders || 0,
        changePct: pct(cur, prev),
      };
    });

    const monthlyRaw = await SalesInvoice.aggregate([
      { $match: inv({ invoiceDate: { $gte: istMonthStart(y, m - 6) } }) },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$invoiceDate", timezone: TZ } }, total: { $sum: "$finalTotal" }, orders: { $sum: { $cond: [{ $ne: ["$category", "Return"] }, 1, 0] } } } },
    ]);
    const monthlyMap = Object.fromEntries(monthlyRaw.map((d) => [d._id, d]));
    const monthKey = (yy, mm) => { const d = new Date(Date.UTC(yy, mm, 1)); return d.toISOString().slice(0, 7); };
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const mm = m - (5 - i);
      const key = monthKey(y, mm);
      const cur = monthlyMap[key]?.total || 0;
      const prev = monthlyMap[monthKey(y, mm - 1)]?.total || 0;
      return {
        label: new Date(Date.UTC(y, mm, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
        date: key,
        value: Math.round(cur * 100) / 100,
        orders: monthlyMap[key]?.orders || 0,
        changePct: pct(cur, prev),
      };
    });

    // ── 5. Most ordered items, last 30 days ──
    const topItems = await SalesInvoice.aggregate([
      { $match: inv({ ...SALE, invoiceDate: { $gte: new Date(now - 30 * DAY) } }) },
      { $unwind: "$lineItems" },
      { $match: { "lineItems.quantity": { $gt: 0 } } },
      {
        $group: {
          _id: { $ifNull: [{ $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$lineItems.itemSku", ""] } }, 0] }, "$lineItems.itemSku", null] }, "$lineItems.item"] },
          name: { $first: "$lineItems.item" },
          sku: { $first: "$lineItems.itemSku" },
          quantity: { $sum: "$lineItems.quantity" },
          revenue: { $sum: { $ifNull: ["$lineItems.amount", 0] } },
          invoices: { $addToSet: "$_id" },
        },
      },
      { $project: { _id: 0, name: 1, sku: 1, quantity: 1, revenue: 1, orders: { $size: "$invoices" } } },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 5 },
    ]);

    res.json({
      generatedAt: new Date(now).toISOString(),
      scope: locCode ? { locCode, locName } : { locCode: "all", locName: "All stores" },
      sales: {
        net: netSales, gross: salesMtd.total, returns: returnsMtd.total, invoices: salesMtd.count,
        prevNet: netSalesPrev, changePct: pct(netSales, netSalesPrev),
      },
      purchases: { total: billsMtd.total, bills: billsMtd.count, prevTotal: billsPrev.total, changePct: pct(billsMtd.total, billsPrev.total) },
      orders: { ...Object.fromEntries(orderEntries), today: ordersToday },
      customers: {
        total: c.total, newThisMonth: c.newThisMonth, newLastMonth: c.newLastMonth, activeThisMonth: c.activeThisMonth,
        changePct: pct(c.newThisMonth, c.newLastMonth),
      },
      chart: { weekly, monthly },
      topItems,
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    res.status(500).json({ message: "Could not build the dashboard.", error: err.message });
  }
};
