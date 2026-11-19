import { useState, useEffect, useMemo, useCallback } from "react";
import { useEnterToSave } from "../hooks/useEnterToSave";
import { useParams, useNavigate } from "react-router-dom";
import { X, Trash2, Plus, Copy, Package, Store, Check, ArrowLeft, Minus, Star, AlertCircle, Save } from "lucide-react";
import baseUrl from "../api/api";
import useSidebar from "../hooks/useSidebar";
import { useActiveStores } from "../utils/storeService.js";
import * as ui from "../components/docDetailStyles";

const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
const emptyRow = () => ({ key: `r-${Date.now()}-${Math.random()}`, warehouse: "", openingStock: "" });

// Turn an item's saved warehouseStocks into editable rows (every location, not just two).
const rowsFromItem = (foundItem) => {
  const stocks = Array.isArray(foundItem?.warehouseStocks) ? foundItem.warehouseStocks : [];
  const rows = stocks
    .filter((s) => s && s.warehouse)
    .map((s) => ({
      key: `w-${s.warehouse}`,
      warehouse: s.warehouse,
      openingStock: String(parseFloat(s.stockOnHand ?? s.openingStock) || 0),
    }));
  return rows.length ? rows : [emptyRow()];
};

// Works as a pop-up (modal) from the item page, or as a full page for old links.
const ItemStockManagement = ({ modal = false, groupId, itemId: itemIdProp, onClose } = {}) => {
  const isSidebarOpen = useSidebar();
  const params = useParams();
  const id = groupId || params.id;
  const itemId = itemIdProp || params.itemId;
  const navigate = useNavigate();
  const { stores } = useActiveStores();

  const [itemGroup, setItemGroup] = useState(null);
  const [item, setItem] = useState(null);
  const [loadState, setLoadState] = useState("loading"); // loading | ready | error
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState([emptyRow()]);

  const backTo = `/shoe-sales/item-groups/${id}/items/${itemId}`;
  const close = useCallback(() => (modal ? onClose?.() : navigate(backTo)), [modal, onClose, navigate, backTo]);

  // Pop-up: Esc closes it and the page behind does not scroll.
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => { if (e.key === "Escape" && !saving) close(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [modal, close, saving]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}?_=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to fetch item group");
      const data = await res.json();
      const found = (data.items || []).find((i) => (i._id || i.id) === itemId);
      setItemGroup(data);
      setItem(found || null);
      if (found) setRows(rowsFromItem(found));
      setLoadState(found ? "ready" : "error");
    } catch (e) {
      console.error("Error fetching item:", e);
      setLoadState("error");
    }
  }, [id, itemId]);

  useEffect(() => { if (id && itemId) load(); }, [id, itemId, load]);

  // Refresh when stock changes elsewhere (e.g. a transfer)
  useEffect(() => {
    const onStock = (event) => {
      const ids = event.detail?.itemIds || [];
      const names = event.detail?.items || [];
      if (ids.some((x) => x?.toString() === (item?._id || item?.id)?.toString()) || names.includes(item?.name)) load();
    };
    window.addEventListener("stockUpdated", onStock);
    return () => window.removeEventListener("stockUpdated", onStock);
  }, [item, load]);

  // Locations to choose from: active stores, plus any location this item already has stock in.
  const locations = useMemo(() => {
    const names = new Map();
    (stores || []).forEach((s) => s?.locName && names.set(s.locName, { name: s.locName, code: s.locCode }));
    rows.forEach((r) => r.warehouse && !names.has(r.warehouse) && names.set(r.warehouse, { name: r.warehouse, code: "" }));
    return [...names.values()].sort((a, b) => (a.name === "Warehouse" ? -1 : b.name === "Warehouse" ? 1 : a.name.localeCompare(b.name)));
  }, [stores, rows]);

  const used = new Set(rows.map((r) => r.warehouse).filter(Boolean));
  const unusedLocations = locations.filter((l) => !used.has(l.name));
  const totalStock = rows.reduce((s, r) => s + (parseFloat(r.openingStock) || 0), 0);
  const configured = rows.filter((r) => r.warehouse).length;

  const update = (key, patch) => {
    setError("");
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const step = (key, delta) => {
    const r = rows.find((x) => x.key === key);
    update(key, { openingStock: String(Math.max(0, (parseFloat(r?.openingStock) || 0) + delta)) });
  };
  const addRow = () => {
    const next = unusedLocations[0]?.name || "";
    setRows((rs) => [...rs, { ...emptyRow(), warehouse: next }]);
  };
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));
  const copyFirstToAll = () => {
    const v = rows[0]?.openingStock || "0";
    setRows((rs) => rs.map((r) => ({ ...r, openingStock: v })));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    if (saving || !itemGroup || !item) return;
    const filled = rows.filter((r) => r.warehouse);
    if (filled.some((r) => (parseFloat(r.openingStock) || 0) < 0)) { setError("Stock can't be negative."); return; }
    const dup = filled.find((r, i) => filled.findIndex((x) => x.warehouse === r.warehouse) !== i);
    if (dup) { setError(`"${dup.warehouse}" is listed twice. Keep one row per location.`); return; }

    setSaving(true);
    setError("");
    try {
      // Keep every other field already stored for a location; only the quantities change.
      const existing = new Map((item.warehouseStocks || []).filter((s) => s?.warehouse).map((s) => [s.warehouse, s]));
      const stockData = filled
        .map((r) => {
          const qty = parseFloat(r.openingStock) || 0;
          return {
            ...(existing.get(r.warehouse) || {}),
            warehouse: r.warehouse,
            openingStock: qty,
            openingStockValue: existing.get(r.warehouse)?.openingStockValue || 0,
            stockOnHand: qty,
            availableForSale: qty,
            physicalOpeningStock: qty,
            physicalStockOnHand: qty,
            physicalAvailableForSale: qty,
          };
        })
        .filter((s) => s.stockOnHand > 0);

      const updatedItems = itemGroup.items.map((i) => {
        if ((i._id || i.id || "").toString() !== itemId.toString()) return i;
        return { ...i, _id: i._id || i.id, id: i.id || i._id, warehouseStocks: stockData, isActive: i.isActive !== undefined ? i.isActive : true };
      });

      const currentUser = JSON.parse(localStorage.getItem("rootfinuser") || "{}") || {};
      const payload = {
        name: itemGroup.name,
        sku: itemGroup.sku || "",
        itemType: itemGroup.itemType || "goods",
        unit: itemGroup.unit || "",
        manufacturer: itemGroup.manufacturer || "",
        brand: itemGroup.brand || "",
        taxPreference: itemGroup.taxPreference || "taxable",
        intraStateTaxRate: itemGroup.intraStateTaxRate || "",
        interStateTaxRate: itemGroup.interStateTaxRate || "",
        inventoryValuationMethod: itemGroup.inventoryValuationMethod || "",
        createAttributes: itemGroup.createAttributes !== undefined ? itemGroup.createAttributes : true,
        attributeRows: itemGroup.attributeRows || [],
        sellable: itemGroup.sellable !== undefined ? itemGroup.sellable : true,
        purchasable: itemGroup.purchasable !== undefined ? itemGroup.purchasable : true,
        trackInventory: itemGroup.trackInventory !== undefined ? itemGroup.trackInventory : false,
        items: updatedItems,
        stock: itemGroup.stock || 0,
        reorder: itemGroup.reorder || "",
        isActive: itemGroup.isActive !== undefined ? itemGroup.isActive : true,
        itemId,
        changedBy: currentUser.username || currentUser.locName || "System",
      };

      const res = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => null);
        throw new Error(p?.message || p?.errors?.join(", ") || "Failed to save stock.");
      }
      // The item page reloads its stock when it sees stocksUpdated in the address.
      navigate(`${backTo}?stocksUpdated=true&skipWarehouseFilter=true&message=${encodeURIComponent("Stock saved.")}`, { replace: true });
      if (modal) onClose?.();
    } catch (e) {
      console.error("Error saving stock:", e);
      setError(e.message || "Failed to save stock. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  useEnterToSave(() => handleSave(), saving);

  const shell = `transition-all duration-300 min-h-screen bg-[#f4f5f3] p-4 sm:p-6 ${isSidebarOpen ? "ml-64" : "ml-0"}`;

  const wrap = (children) =>
    modal ? (
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] sm:p-4 sk-fade" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) close(); }}>
        <div role="dialog" aria-modal="true" className="sk-pop w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#f4f5f3] shadow-2xl">
          {children}
        </div>
      </div>
    ) : (
      <div className={shell}><div className="max-w-3xl mx-auto">{children}</div></div>
    );

  if (loadState !== "ready") {
    return wrap(
        <div className={`${modal ? "m-4 sm:m-5" : "max-w-md mx-auto mt-16"} bg-white rounded-2xl border border-gray-200/80 shadow-sm p-10 text-center`}>
          {loadState === "loading" ? (
            <>
              <div className="h-7 w-7 mx-auto animate-spin rounded-full border-2 border-[#15171D] border-t-transparent" />
              <p className="mt-3 text-sm font-medium text-gray-500">Loading stock…</p>
            </>
          ) : (
            <>
              <span className="mx-auto grid place-items-center w-12 h-12 rounded-2xl bg-gray-100 text-gray-400"><Package size={22} /></span>
              <p className="mt-4 text-base font-bold text-[#15171D]">Item not found</p>
              <p className="text-sm text-gray-500 mt-1">We couldn't load this item's stock.</p>
              <button type="button" onClick={close} className={`${ui.btnPrimary} h-10 px-5 text-sm mt-6`}>
                <ArrowLeft size={15} /> {modal ? "Close" : "Go back"}
              </button>
            </>
          )}
        </div>
    );
  }

  const thumb = item.image || item.images?.[0]?.data || (typeof item.images?.[0] === "string" && item.images[0]) || itemGroup.images?.[0] || "";

  return wrap(
      <div className={`space-y-4 sm:space-y-5 ${modal ? "p-4 sm:p-5" : ""}`}>

        {/* Title bar */}
        <div className="flex items-center gap-3">
          {!modal && (
            <button type="button" onClick={close} className={`${ui.btnOutline} h-10 w-10 px-0 shrink-0`} title="Back">
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Manage stock</p>
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#15171D] truncate">{item.name || item.itemName}</h1>
          </div>
          {modal && (
            <button type="button" onClick={close} disabled={saving} className={`${ui.btnOutline} h-10 w-10 px-0 shrink-0`} title="Close (Esc)">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Item summary */}
        <div className="bg-[#15171D] rounded-2xl p-5 text-white flex flex-wrap items-center gap-4">
          {thumb ? (
            <img src={thumb} alt="" className="w-14 h-14 rounded-xl object-cover bg-white/10 shrink-0" />
          ) : (
            <span className="grid place-items-center w-14 h-14 rounded-xl bg-white/10 text-[#C6F135] shrink-0"><Package size={22} /></span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
              {item.sku && <span className="font-mono text-white/80">SKU {item.sku}</span>}
              <span>Group · <span className="text-white/80">{itemGroup.name}</span></span>
              {item.size && <span>Size · <span className="text-white/80">{item.size}</span></span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 max-w-sm">
              <div className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Total stock</p>
                <p className="text-xl font-extrabold tabular-nums">{totalStock} <span className="text-xs font-medium text-white/40">units</span></p>
              </div>
              <div className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Locations</p>
                <p className="text-xl font-extrabold tabular-nums">{configured} <span className="text-xs font-medium text-white/40">of {locations.length}</span></p>
              </div>
            </div>
          </div>
        </div>

        {/* Locations */}
        <section className="bg-white rounded-2xl border border-gray-200/80 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-[#15171D]">Stock by location</h2>
              <p className="text-xs text-gray-500 mt-0.5">Set how many units are at each store. Locations left at 0 are removed.</p>
            </div>
            {rows.length > 1 && (
              <button type="button" onClick={copyFirstToAll} className={`${ui.btnOutline} h-9`}>
                {copied ? <><Check size={13} className="text-emerald-600" /> Copied</> : <><Copy size={13} /> Copy first to all</>}
              </button>
            )}
          </div>

          <div className="p-4 sm:p-6 space-y-3">
            {rows.map((r, i) => {
              const isMain = r.warehouse === "Warehouse";
              return (
                <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_200px_auto] gap-3 items-center p-3 rounded-xl border border-gray-200 bg-gray-50/50">
                  <div className="flex items-center gap-3 min-w-0 col-span-2 sm:col-span-1">
                    <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${isMain ? "bg-[#15171D] text-[#C6F135]" : "bg-white border border-gray-200 text-gray-500"}`}>
                      {isMain ? <Star size={15} className="fill-current" /> : <Store size={15} />}
                    </span>
                    <div className="relative flex-1 min-w-0">
                      <select
                        value={r.warehouse}
                        onChange={(e) => update(r.key, { warehouse: e.target.value })}
                        className="no-focus-ring w-full h-10 appearance-none rounded-xl border border-gray-200 bg-white pl-3 pr-9 text-sm font-semibold text-[#15171D] outline-none transition hover:border-gray-300 focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30 cursor-pointer"
                      >
                        <option value="">Choose a location…</option>
                        {locations.map((l) => (
                          <option key={l.name} value={l.name} disabled={used.has(l.name) && l.name !== r.warehouse}>
                            {l.name}{used.has(l.name) && l.name !== r.warehouse ? " (added)" : ""}
                          </option>
                        ))}
                      </select>
                      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                    </div>
                  </div>

                  {/* Quantity stepper */}
                  <div className="flex items-center h-10 rounded-xl border border-gray-200 bg-white overflow-hidden focus-within:border-[#A8D11E] focus-within:ring-2 focus-within:ring-[#C6F135]/30">
                    <button type="button" onClick={() => step(r.key, -1)} className="no-hover-anim grid place-items-center w-10 h-full text-gray-500 hover:bg-gray-50 hover:text-[#15171D]" aria-label="Decrease">
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={r.openingStock}
                      onChange={(e) => update(r.key, { openingStock: e.target.value })}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      aria-label={`Stock at ${r.warehouse || "location"} ${i + 1}`}
                      className="no-focus-ring w-full min-w-0 h-full text-center text-sm font-bold tabular-nums text-[#15171D] outline-none border-x border-gray-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button type="button" onClick={() => step(r.key, 1)} className="no-hover-anim grid place-items-center w-10 h-full text-gray-500 hover:bg-gray-50 hover:text-[#15171D]" aria-label="Increase">
                      <Plus size={14} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    className="no-hover-anim grid place-items-center w-10 h-10 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                    title="Remove location"
                  >
                    {rows.length > 1 ? <Trash2 size={16} /> : <X size={16} />}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={addRow}
              disabled={unusedLocations.length === 0}
              className={`${ui.btnOutline} h-10 px-4 text-sm border-dashed w-full sm:w-auto`}
              title={unusedLocations.length === 0 ? "Every location is already added" : ""}
            >
              <Plus size={15} /> Add location
            </button>

            {error && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm font-medium text-red-700">
                <AlertCircle size={15} /> {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-gray-100">
            <button type="button" onClick={close} disabled={saving} className={`${ui.btnOutline} h-11 px-5 text-sm`}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className={`${ui.btnPrimary} h-11 px-6 text-sm`}>
              {saving
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : <><Save size={15} /> Save stock</>}
            </button>
          </div>
        </section>
      </div>
  );
};

export default ItemStockManagement;
