// Stock per item for the stock reports (P&L stock value, dead stock, overstock, ABC).
// Reads stock the way the inventory reports do: warehouseStocks[].stockOnHand, matched by warehouse
// name with the inventory report's name normaliser. Read-only — stock is never written here.
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import Store from "../model/Store.js";
import { normalizeWarehouseName, getWarehouseNameVariations } from "../controllers/InventoryReportController.js";
import { canSeeLoc } from "./userScope.js";
import { round2 } from "./retailMath.js";

const num = (v) => Number(v) || 0;

/** Matcher for one or more warehouse names (null = every warehouse). */
export const warehouseMatcher = (names) => {
  if (!names) return () => true;
  const wanted = new Set();
  for (const n of names) for (const v of getWarehouseNameVariations(n)) wanted.add(String(v).toLowerCase());
  return (w) => {
    if (!w) return false;
    const s = String(w).trim();
    return wanted.has(s.toLowerCase()) || wanted.has(String(normalizeWarehouseName(s) || "").toLowerCase());
  };
};

/**
 * Warehouse names a request may look at, checked on the server.
 * Admin with no store chosen → null (all). A chosen store must be in the user's scope; its name comes
 * from the Store record (the client's label is only a fallback). Scoped users with no store chosen
 * get all of their stores.
 */
export const warehousesFor = async (who, { locCode, warehouse } = {}) => {
  if (locCode) {
    if (!canSeeLoc(who.scope, locCode)) return { error: "That store is outside your access." };
    const store = await Store.findOne({ locCode: String(locCode) }).select("name").lean();
    const name = store?.name || warehouse;
    return { names: name ? [name] : [], label: name || String(locCode) };
  }
  if (who.scope.all) return { names: null, label: "All stores" };
  const stores = await Store.find({ locCode: { $in: who.scope.locCodes } }).select("name").lean();
  return { names: stores.map((s) => s.name).filter(Boolean), label: stores.map((s) => s.name).join(", ") || "My stores" };
};

/**
 * One row per item (standalone item or variant in a group) with its stock in the given warehouses.
 * key = the item's id (the same id sale lines carry in itemData._id).
 */
export const loadStockRows = async (names = null) => {
  const match = warehouseMatcher(names);
  const stockIn = (wss) => {
    let stock = 0;
    const per = [];
    for (const ws of wss || []) {
      if (!match(ws?.warehouse)) continue;
      const q = num(ws.stockOnHand);
      stock += q;
      if (q) per.push({ warehouse: ws.warehouse, stock: q });
    }
    return { stock, per };
  };
  const rows = [];
  const items = await ShoeItem.find({}).select("itemName sku category brand costPrice isActive warehouseStocks.warehouse warehouseStocks.stockOnHand maxStock abcOverride reorderPoint").lean();
  for (const it of items) {
    const { stock, per } = stockIn(it.warehouseStocks);
    rows.push({
      key: String(it._id), kind: "item", id: String(it._id), groupId: null, groupName: "", name: it.itemName || "", sku: it.sku || "",
      category: it.category || "", brand: it.brand || "", cost: num(it.costPrice), stock, value: round2(stock * num(it.costPrice)), warehouses: per,
      maxStock: it.maxStock ?? null, abcOverride: it.abcOverride || "", reorderPoint: it.reorderPoint || "", isActive: it.isActive !== false,
    });
  }
  const groups = await ItemGroup.find({}).select("name category brand isActive items._id items.name items.sku items.costPrice items.isActive items.warehouseStocks.warehouse items.warehouseStocks.stockOnHand items.maxStock items.abcOverride items.reorderPoint").lean();
  for (const g of groups) {
    for (const gi of g.items || []) {
      const { stock, per } = stockIn(gi.warehouseStocks);
      rows.push({
        key: String(gi._id), kind: "group", id: String(gi._id), groupId: String(g._id), groupName: g.name || "", name: gi.name || "", sku: gi.sku || "",
        category: g.category || "", brand: g.brand || "", cost: num(gi.costPrice), stock, value: round2(stock * num(gi.costPrice)), warehouses: per,
        maxStock: gi.maxStock ?? null, abcOverride: gi.abcOverride || "", reorderPoint: gi.reorderPoint || "", isActive: g.isActive !== false && gi.isActive !== false,
      });
    }
  }
  return rows;
};

/** Σ stockOnHand × costPrice over the rows. */
export const stockValueOf = (rows) => round2(rows.reduce((s, r) => s + (r.stock > 0 ? r.stock * r.cost : 0), 0));
