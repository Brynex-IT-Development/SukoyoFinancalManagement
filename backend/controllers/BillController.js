import Bill from "../model/Bill.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import Vendor from "../model/Vendor.js";
import mongoose from "mongoose";
import { logVendorActivity, getOriginatorName } from "../utils/vendorHistoryLogger.js";
import { updateMonthlyStockForPurchase } from "../utils/monthlyStockTracking.js";
import { resolveLine, moveStock, applyLines, StockError } from "../utils/stockService.js";

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR-CODE EXTRACTION  &  BASE-NAME SKU MATCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the vendor code from an item name that follows either format:
 *   "SN-10-440-PSP(HMC) STICKY NOTES"   → { baseName: "SN-10-440-PSP STICKY NOTES", vendorCode: "HMC" }
 *   "Camel Pencil (UNC)"                 → { baseName: "Camel Pencil",               vendorCode: "UNC" }
 *
 * Rules:
 *  - Vendor code is ALWAYS uppercase letters inside ( ) brackets.
 *  - Only the FIRST such bracket that contains ALL-CAPS (2–6 chars) is treated as the vendor code.
 *  - Other brackets (product descriptions, sizes, etc.) are left untouched.
 */
export const extractVendorInfo = (rawItemName) => {
  if (!rawItemName || typeof rawItemName !== "string") {
    return { baseName: rawItemName || "", vendorCode: null };
  }

  let vendorCode = null;
  // 1. Match vendor code inside brackets e.g. (HMC), (UNC), (JG), (NN)
  const vMatch = rawItemName.match(/\(([A-Z]{2,6})\)/);
  if (vMatch) {
    vendorCode = vMatch[1];
  } else {
    // 2. Or vendor code at the end after space e.g. "Camel Pencil HBC"
    // Only match if preceding text has lowercase letters (Mixed/Title Case)
    // If the entire title is UPPERCASE (e.g. "SN-11-440-UU STICKY NOTES"), the trailing word is part of the name
    const endMatch = rawItemName.match(/\s+([A-Z]{2,6})$/);
    if (endMatch) {
      const preceding = rawItemName.slice(0, endMatch.index);
      if (/[a-z]/.test(preceding)) {
        vendorCode = endMatch[1];
      }
    }
  }

  // Strip vendor code in brackets
  let baseName = rawItemName.replace(/\([A-Z]{2,6}\)/g, " ");

  // If matched at end with space, strip that too
  if (!vMatch && vendorCode) {
    baseName = baseName.replace(new RegExp(`\\s+${vendorCode}$`), "");
  }

  // Strip trailing cut-off brackets e.g. "(PA", "(POCK", "(", "(W" (often cut off by bill printers)
  baseName = baseName.replace(/\s*\([A-Za-z0-9/_-]*\)?\s*$/, "");

  // Clean whitespace
  baseName = baseName.replace(/\s{2,}/g, " ").trim();

  return { baseName, vendorCode };
};

/**
 * Given an item's full name (e.g. "SN-10-440-PSP(HMC) STICKY NOTES"),
 * this function:
 *  1. Extracts the vendor code and clean base name.
 *  2. Searches for an EXISTING item in ShoeItem or ItemGroup using base name (case-insensitive & flexible).
 *  3. If found  → returns existing SKU so the SAME SKU is reused.
 *  4. If not    → returns null so the caller creates a new item (new SKU).
 *  5. Updates vendorPrices[] on the found item to track MRP per vendor.
 *
 * Returns: { baseName, vendorCode, existingSku, existingItemId, existingGroupId, existingGroupItemIndex }
 */
export const findExistingItemByBaseName = async (rawItemName, mrp = 0, costPrice = 0, vendorName = "") => {
  const { baseName, vendorCode } = extractVendorInfo(rawItemName);

  if (!baseName) {
    return { baseName: rawItemName || "", vendorCode: null, existingSku: null, existingItemId: null, existingGroupId: null, existingGroupItemIndex: -1 };
  }

  console.log(`🔍 findExistingItemByBaseName: rawName="${rawItemName}" → baseName="${baseName}", vendorCode="${vendorCode || 'none'}"`);

  const purchaseDate = new Date();
  const vendorEntry = vendorCode ? {
    vendorCode,
    vendorName: vendorName || vendorCode,
    mrp: parseFloat(mrp) || 0,
    costPrice: parseFloat(costPrice) || 0,
    lastPurchaseDate: purchaseDate,
  } : null;
  const vendorItemEntry = vendorCode ? { vendorCode, originalName: rawItemName.trim() } : null;

  // ── 1. Search standalone ShoeItems ──────────────────────────────────────────
  // Match either exact base name OR where the existing itemName starts with/contains baseName
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let shoeItem = await ShoeItem.findOne({
    $or: [
      { itemName: { $regex: `^${escapedBase}$`, $options: "i" } },
      { itemName: { $regex: `^${escapedBase}\\b`, $options: "i" } },
    ]
  });

  // Fallback: If not found, scan recently added shoe items to see if their clean baseName matches
  if (!shoeItem) {
    const candidates = await ShoeItem.find({}).sort({ createdAt: -1 }).limit(100);
    for (const cand of candidates) {
      const candClean = extractVendorInfo(cand.itemName).baseName;
      if (candClean && candClean.toLowerCase() === baseName.toLowerCase()) {
        shoeItem = cand;
        break;
      }
    }
  }

  if (shoeItem) {
    console.log(`  ✅ Found standalone ShoeItem: "${shoeItem.itemName}" (SKU: ${shoeItem.sku})`);

    // Update / insert vendorPrices entry if vendorCode present
    if (vendorEntry) {
      const vpIndex = (shoeItem.vendorPrices || []).findIndex(
        (vp) => vp.vendorCode && vp.vendorCode.toUpperCase() === vendorCode.toUpperCase()
      );
      if (vpIndex === -1) {
        await ShoeItem.findByIdAndUpdate(shoeItem._id, {
          $push: { vendorPrices: vendorEntry },
          ...(vendorItemEntry ? { $addToSet: { vendorItemNames: vendorItemEntry } } : {}),
        });
      } else {
        await ShoeItem.findByIdAndUpdate(shoeItem._id, {
          $set: {
            [`vendorPrices.${vpIndex}.mrp`]: vendorEntry.mrp,
            [`vendorPrices.${vpIndex}.costPrice`]: vendorEntry.costPrice,
            [`vendorPrices.${vpIndex}.lastPurchaseDate`]: purchaseDate,
          },
          ...(vendorItemEntry ? { $addToSet: { vendorItemNames: vendorItemEntry } } : {}),
        });
      }
    }

    return {
      baseName,
      vendorCode,
      existingSku: shoeItem.sku || null,
      existingItemId: shoeItem._id.toString(),
      existingGroupId: null,
      existingGroupItemIndex: -1,
    };
  }

  // ── 2. Search inside ItemGroups ──────────────────────────────────────────────
  const groups = await ItemGroup.find({ isActive: { $ne: false } });
  for (const group of groups) {
    if (!Array.isArray(group.items)) continue;

    const idx = group.items.findIndex((gi) => {
      if (!gi.name) return false;
      const giClean = extractVendorInfo(gi.name).baseName;
      return (
        gi.name.trim().toLowerCase() === baseName.toLowerCase() ||
        (giClean && giClean.toLowerCase() === baseName.toLowerCase())
      );
    });

    if (idx !== -1) {
      const foundItem = group.items[idx];
      console.log(`  ✅ Found item in group "${group.name}": "${foundItem.name}" (SKU: ${foundItem.sku})`);

      if (vendorEntry) {
        const vpIndex = (foundItem.vendorPrices || []).findIndex(
          (vp) => vp.vendorCode && vp.vendorCode.toUpperCase() === vendorCode.toUpperCase()
        );

        const updateOp = vpIndex === -1
          ? {
              $push: { [`items.${idx}.vendorPrices`]: vendorEntry },
              ...(vendorItemEntry ? { $addToSet: { [`items.${idx}.vendorItemNames`]: vendorItemEntry } } : {}),
            }
          : {
              $set: {
                [`items.${idx}.vendorPrices.${vpIndex}.mrp`]: vendorEntry.mrp,
                [`items.${idx}.vendorPrices.${vpIndex}.costPrice`]: vendorEntry.costPrice,
                [`items.${idx}.vendorPrices.${vpIndex}.lastPurchaseDate`]: purchaseDate,
              },
              ...(vendorItemEntry ? { $addToSet: { [`items.${idx}.vendorItemNames`]: vendorItemEntry } } : {}),
            };

        await ItemGroup.findByIdAndUpdate(group._id, updateOp);
      }

      return {
        baseName,
        vendorCode,
        existingSku: foundItem.sku || null,
        existingItemId: foundItem._id?.toString() || null,
        existingGroupId: group._id.toString(),
        existingGroupItemIndex: idx,
      };
    }
  }

  // ── 3. Not found anywhere → caller will create a new item ───────────────────
  console.log(`  ℹ️ No existing item found for baseName="${baseName}" — will create new item`);
  return {
    baseName,
    vendorCode,
    existingSku: null,
    existingItemId: null,
    existingGroupId: null,
    existingGroupItemIndex: -1,
  };
};

// ─────────────────────────────────────────────────────────────────────────────

// Helper function to map locName to warehouse name (same as other controllers)
const mapLocNameToWarehouse = (locName) => {
  if (!locName) return "Warehouse";
  // Remove prefixes like "G.", "Z.", "SG."
  let warehouse = locName.replace(/^[A-Z]\.?\s*/i, "").trim();
  // Add "Branch" if not already present and not "Warehouse"
  if (warehouse && warehouse.toLowerCase() !== "warehouse" && !warehouse.toLowerCase().includes("branch")) {
    warehouse = `${warehouse} Branch`;
  }
  return warehouse || "Warehouse";
};

// Helper function to match warehouse names flexibly (same as transfer orders and purchase receive)
const matchesWarehouse = (itemWarehouse, targetWarehouse) => {
  if (!itemWarehouse || !targetWarehouse) return false;
  
  const itemWarehouseLower = itemWarehouse.toString().toLowerCase().trim();
  const targetWarehouseLower = targetWarehouse.toLowerCase().trim();
  
  // Exact match
  if (itemWarehouseLower === targetWarehouseLower) {
    return true;
  }
  
  // Base name match (e.g., "warehouse" matches "Warehouse", "kannur" matches "Kannur Branch")
  const itemBase = itemWarehouseLower.replace(/\s*(branch|warehouse)\s*$/i, "").trim();
  const targetBase = targetWarehouseLower.replace(/\s*(branch|warehouse)\s*$/i, "").trim();
  
  if (itemBase && targetBase && itemBase === targetBase) {
    return true;
  }
  
  // Partial match (e.g., "kannur branch" contains "kannur")
  if (itemWarehouseLower.includes(targetWarehouseLower) || targetWarehouseLower.includes(itemWarehouseLower)) {
    return true;
  }
  
  return false;
};

// Helper function to add stock for items in bills (similar to purchase receive)
const addItemStock = async (itemIdValue, quantity, warehouseName, itemName = null, itemGroupId = null, itemSku = null) => {
  // Use default warehouse if not provided
  const targetWarehouse = warehouseName?.trim() || "Warehouse";
  console.log(`📦 addItemStock: targetWarehouse="${targetWarehouse}", qty=${quantity}, itemName="${itemName}"`);
  
  // Helper function to update warehouse stock (add)
  const updateWarehouseStock = (warehouseStocks, qty, targetWarehouse) => {
    if (!warehouseStocks || warehouseStocks.length === 0) {
      console.log(`   Creating new warehouse stock entry for "${targetWarehouse}"`);
      return [{
        warehouse: targetWarehouse,
        openingStock: 0,
        openingStockValue: 0,
        stockOnHand: qty,
        committedStock: 0,
        availableForSale: qty,
        physicalOpeningStock: 0,
        physicalStockOnHand: qty,
        physicalCommittedStock: 0,
        physicalAvailableForSale: qty,
      }];
    }
    
    // Use flexible matching to find warehouse stock
    let warehouseStock = warehouseStocks.find(ws => 
      matchesWarehouse(ws.warehouse, targetWarehouse)
    );
    
    if (!warehouseStock) {
      console.log(`   Warehouse "${targetWarehouse}" not found, creating new entry`);
      warehouseStock = {
        warehouse: targetWarehouse,
        openingStock: 0,
        openingStockValue: 0,
        stockOnHand: 0,
        committedStock: 0,
        availableForSale: 0,
        physicalOpeningStock: 0,
        physicalStockOnHand: 0,
        physicalCommittedStock: 0,
        physicalAvailableForSale: 0,
      };
      warehouseStocks.push(warehouseStock);
    } else {
      console.log(`   ✅ Found existing warehouse stock for "${warehouseStock.warehouse}" (matched with "${targetWarehouse}")`);
    }
    
    const currentStockOnHand = parseFloat(warehouseStock.stockOnHand) || 0;
    const currentAvailableForSale = parseFloat(warehouseStock.availableForSale) || 0;
    const currentPhysicalStockOnHand = parseFloat(warehouseStock.physicalStockOnHand) || 0;
    const currentPhysicalAvailableForSale = parseFloat(warehouseStock.physicalAvailableForSale) || 0;
    
    warehouseStock.warehouse = targetWarehouse; // Normalize to target warehouse name
    
    // Add stock (bill increases inventory)
    warehouseStock.stockOnHand = currentStockOnHand + qty;
    warehouseStock.availableForSale = currentAvailableForSale + qty;
    warehouseStock.physicalStockOnHand = currentPhysicalStockOnHand + qty;
    warehouseStock.physicalAvailableForSale = currentPhysicalAvailableForSale + qty;
    
    console.log(`   ✅ Added ${qty} to stock: ${currentStockOnHand} -> ${warehouseStock.stockOnHand}`);
    
    return warehouseStocks;
  };
  
  // PRIORITY: If itemGroupId is provided, prioritize group item search (even if itemId is also provided)
  // This is because items from groups should be updated in the group, not as standalone items
  if (itemGroupId && itemName) {
    console.log(`   🔍 itemGroupId provided (${itemGroupId}), prioritizing group item search...`);
    const nameBasedResult = await addItemStockByName(itemGroupId, itemName, quantity, targetWarehouse, itemSku);
    if (nameBasedResult.success) {
      console.log(`   ✅ Successfully updated stock in group item`);
      return nameBasedResult;
    } else {
      console.log(`   ⚠️ Group item search failed: ${nameBasedResult.message}, trying standalone item search...`);
    }
  }
  
  // If itemId is null but we have itemGroupId and itemName, use name-based search
  if ((!itemIdValue || itemIdValue === null || itemIdValue === "null") && itemGroupId && itemName) {
    return await addItemStockByName(itemGroupId, itemName, quantity, targetWarehouse, itemSku);
  }
  
  // Try to find as standalone item (only if no itemGroupId or group search failed)
  let shoeItem = null;
  if (itemIdValue && itemIdValue !== null && itemIdValue !== "null") {
    console.log(`   🔍 Searching for standalone item with ID: ${itemIdValue}`);
    shoeItem = await ShoeItem.findById(itemIdValue);
  }
  
  if (shoeItem) {
    console.log(`   ✅ Found standalone item: "${shoeItem.itemName}"`);
    
    // Convert to plain object, modify, then update using $set (same fix as PurchaseReceiveController)
    const itemPlain = shoeItem.toObject();
    const oldStock = itemPlain.warehouseStocks?.find(ws => matchesWarehouse(ws.warehouse, targetWarehouse))?.stockOnHand || 0;
    
    if (!itemPlain.warehouseStocks || !Array.isArray(itemPlain.warehouseStocks)) {
      itemPlain.warehouseStocks = [];
    }
    
    // Find or create warehouse stock entry
    let wsEntry = itemPlain.warehouseStocks.find(ws => 
      matchesWarehouse(ws.warehouse, targetWarehouse)
    );
    
    if (!wsEntry) {
      wsEntry = {
        warehouse: targetWarehouse,
        openingStock: 0,
        openingStockValue: 0,
        stockOnHand: 0,
        committedStock: 0,
        availableForSale: 0,
        physicalOpeningStock: 0,
        physicalStockOnHand: 0,
        physicalCommittedStock: 0,
        physicalAvailableForSale: 0,
      };
      itemPlain.warehouseStocks.push(wsEntry);
    }
    
    // Update stock values
    const currentStock = parseFloat(wsEntry.stockOnHand) || 0;
    wsEntry.stockOnHand = currentStock + quantity;
    wsEntry.availableForSale = (parseFloat(wsEntry.availableForSale) || 0) + quantity;
    wsEntry.physicalStockOnHand = (parseFloat(wsEntry.physicalStockOnHand) || 0) + quantity;
    wsEntry.physicalAvailableForSale = (parseFloat(wsEntry.physicalAvailableForSale) || 0) + quantity;
    wsEntry.warehouse = targetWarehouse;
    
    console.log(`   📊 Stock update: ${currentStock} + ${quantity} = ${wsEntry.stockOnHand}`);
    
    // Update using $set to replace entire warehouseStocks array
    const updatedItem = await ShoeItem.findByIdAndUpdate(
      itemIdValue,
      {
        $set: {
          warehouseStocks: itemPlain.warehouseStocks
        }
      },
      { new: true }
    );
    
    if (!updatedItem) {
      console.error(`❌ Failed to update standalone item stock`);
      return { success: false, message: "Failed to update stock" };
    }
    
    console.log(`✅ Added stock for standalone item: ${itemName || itemIdValue}, Quantity: ${quantity}, Warehouse: ${targetWarehouse}`);
    return { success: true, type: 'standalone', warehouse: targetWarehouse };
  } else if (itemIdValue && itemIdValue !== null && itemIdValue !== "null") {
    console.log(`   ❌ Standalone item not found with ID: ${itemIdValue}`);
  }
  
  // Item not found in standalone items, try to find in item groups (fallback if itemGroupId wasn't provided)
  if (itemGroupId && itemName) {
    console.log(`   🔍 Fallback: Trying group item search again...`);
    const nameBasedResult = await addItemStockByName(itemGroupId, itemName, quantity, targetWarehouse, itemSku);
    if (nameBasedResult.success) {
      return nameBasedResult;
    }
  }
  
  let itemGroups = [];
  if (itemGroupId) {
    const specificGroup = await ItemGroup.findById(itemGroupId);
    if (specificGroup && specificGroup.isActive !== false) {
      itemGroups = [specificGroup];
    }
  }
  
  if (itemGroups.length === 0) {
    itemGroups = await ItemGroup.find({ isActive: { $ne: false } });
  }
  
  // Search through groups
  for (const group of itemGroups) {
    if (!group.items || !Array.isArray(group.items)) continue;
    
    for (let i = 0; i < group.items.length; i++) {
      const groupItem = group.items[i];
      const groupItemId = groupItem._id?.toString() || groupItem.id?.toString();
      const compositeId = `${group._id}_${i}`;
      
      const itemIdStr = itemIdValue?.toString() || "";
      const idMatches = itemIdStr && (itemIdStr === groupItemId || itemIdStr === compositeId);
      
      const skuMatches = itemSku && groupItem.sku && 
        groupItem.sku.toLowerCase().trim() === itemSku.toLowerCase().trim();
      
      const nameMatches = itemName && groupItem.name && 
        groupItem.name.toLowerCase().trim() === itemName.toLowerCase().trim();
      
      const isMatch = skuMatches || idMatches || (!itemSku && !groupItem.sku && nameMatches);
      
      if (isMatch) {
        // Use the same fix - convert to plain object, modify, then update using $set
        const groupPlain = group.toObject();
        const itemPlain = groupPlain.items[i];
        
        if (!itemPlain.warehouseStocks) {
          itemPlain.warehouseStocks = [];
        }
        
        let wsEntry = itemPlain.warehouseStocks.find(ws => 
          matchesWarehouse(ws.warehouse, targetWarehouse)
        );
        
        if (!wsEntry) {
          wsEntry = {
            warehouse: targetWarehouse,
            openingStock: 0,
            openingStockValue: 0,
            stockOnHand: 0,
            committedStock: 0,
            availableForSale: 0,
            physicalOpeningStock: 0,
            physicalStockOnHand: 0,
            physicalCommittedStock: 0,
            physicalAvailableForSale: 0,
          };
          itemPlain.warehouseStocks.push(wsEntry);
        }
        
        const currentStock = parseFloat(wsEntry.stockOnHand) || 0;
        wsEntry.stockOnHand = currentStock + quantity;
        wsEntry.availableForSale = (parseFloat(wsEntry.availableForSale) || 0) + quantity;
        wsEntry.physicalStockOnHand = (parseFloat(wsEntry.physicalStockOnHand) || 0) + quantity;
        wsEntry.physicalAvailableForSale = (parseFloat(wsEntry.physicalAvailableForSale) || 0) + quantity;
        wsEntry.warehouse = targetWarehouse;
        
        // Update using $set
        const updateResult = await ItemGroup.findByIdAndUpdate(
          group._id,
          {
            $set: {
              [`items.${i}`]: itemPlain
            }
          },
          { new: true }
        );
        
        if (updateResult) {
          // Update monthly opening stock for purchase
          try {
            const itemId = groupItem._id?.toString() || groupItem.id?.toString();
            if (itemId) {
              await updateMonthlyStockForPurchase(group._id.toString(), itemId, targetWarehouse, quantity, groupItem.name);
            }
          } catch (monthlyError) {
            console.error(`   ⚠️ Error updating monthly stock (non-critical):`, monthlyError);
          }
          
          console.log(`✅ Added stock for item in group: ${groupItem.name} (Group: ${group.name}), Quantity: ${quantity}, Warehouse: ${targetWarehouse}`);
          return { success: true, type: 'group', groupName: group.name, itemName: groupItem.name, warehouse: targetWarehouse };
        }
      }
    }
  }

  // If item is not found in standalone items or groups,
  // first try to match by BASE NAME (stripping vendor code from brackets).
  // e.g. "SN-10-440-PSP(HMC) STICKY NOTES" → baseName "SN-10-440-PSP STICKY NOTES"
  // If that base name already exists → reuse it (same SKU), just add stock.
  if (itemName && itemName.trim() !== "") {
    try {
      const baseMatch = await findExistingItemByBaseName(itemName);
      if (baseMatch.existingItemId || baseMatch.existingGroupId) {
        console.log(`🔗 Base-name match found! vendorCode="${baseMatch.vendorCode}", reusing existing item`);
        // Re-run addItemStock with the resolved IDs so stock goes to the correct item
        return await addItemStock(
          baseMatch.existingItemId,
          quantity,
          targetWarehouse,
          baseMatch.baseName,
          baseMatch.existingGroupId,
          itemSku
        );
      }
    } catch (matchErr) {
      console.error("Error during base-name matching, will auto-create:", matchErr);
    }

    // No base-name match → create as a new standalone item
    try {
      const { baseName: autoBaseName, vendorCode: autoVendorCode } = extractVendorInfo(itemName);
      console.log(`📦 Auto-creating standalone item "${autoBaseName}" with stock ${quantity} in warehouse "${targetWarehouse}" (vendorCode: ${autoVendorCode || "none"})`);
      const newShoeItem = await ShoeItem.create({
        itemName: autoBaseName,          // store the CLEAN base name (no vendor code)
        sku: itemSku || "",
        unit: "PCS",
        trackInventory: true,
        sellable: true,
        purchasable: true,
        isActive: true,
        // Track original vendor name right away
        vendorPrices: autoVendorCode ? [{
          vendorCode: autoVendorCode,
          vendorName: autoVendorCode,
          mrp: 0,
          costPrice: 0,
          lastPurchaseDate: new Date(),
        }] : [],
        vendorItemNames: autoVendorCode ? [{
          vendorCode: autoVendorCode,
          originalName: itemName.trim(),
        }] : [],
        warehouseStocks: [{
          warehouse: targetWarehouse,
          openingStock: quantity,
          openingStockValue: 0,
          stockOnHand: quantity,
          committedStock: 0,
          availableForSale: quantity,
          physicalOpeningStock: quantity,
          physicalStockOnHand: quantity,
          physicalCommittedStock: 0,
          physicalAvailableForSale: quantity,
        }],
      });
      console.log(`✅ Auto-created standalone item "${autoBaseName}" (ID: ${newShoeItem._id}) with ${quantity} stock`);
      return { success: true, type: 'standalone', itemId: newShoeItem._id, warehouse: targetWarehouse };
    } catch (createErr) {
      console.error("Error auto-creating standalone item in addItemStock:", createErr);
    }
  }
  
  console.warn(`⚠️ Item with ID ${itemIdValue || itemName} not found for stock addition`);
  return { success: false, message: `Item with ID ${itemIdValue || itemName} not found` };
};

// Helper function to add stock by name and SKU (when itemId is null)
const addItemStockByName = async (itemGroupId, itemName, quantity, warehouseName, itemSku = null) => {
  console.log(`\n📦 addItemStockByName called:`);
  console.log(`   itemGroupId: ${itemGroupId}`);
  console.log(`   itemName: "${itemName}"`);
  console.log(`   itemSku: "${itemSku || 'none'}"`);
  console.log(`   quantity: ${quantity}`);
  console.log(`   warehouseName: "${warehouseName}"`);
  
  if (!itemGroupId || !itemName) {
    console.log(`   ❌ Missing required fields: itemGroupId=${!!itemGroupId}, itemName=${!!itemName}`);
    return { success: false, message: "itemGroupId and itemName are required when itemId is null" };
  }
  
  const targetWarehouse = warehouseName?.trim() || "Warehouse";
  console.log(`   Target warehouse: "${targetWarehouse}"`);
  
  const group = await ItemGroup.findById(itemGroupId);
  if (!group || group.isActive === false) {
    console.log(`   ❌ Item group ${itemGroupId} not found or inactive`);
    return { success: false, message: `Item group ${itemGroupId} not found or inactive` };
  }
  
  console.log(`   ✅ Found item group: "${group.name}"`);
  
  if (!group.items || !Array.isArray(group.items)) {
    console.log(`   ❌ Item group has no items`);
    return { success: false, message: `Item group ${itemGroupId} has no items` };
  }
  
  console.log(`   Group has ${group.items.length} items`);
  console.log(`   Available items:`, group.items.map((item, idx) => `[${idx}] "${item.name}" (SKU: ${item.sku || 'none'})`).join(', '));
  
  // Find item STRICTLY by SKU first if itemSku is present
  let itemIndex = -1;
  if (itemSku) {
    itemIndex = group.items.findIndex(gi => {
      const skuMatch = gi.sku && gi.sku.trim().toLowerCase() === itemSku.trim().toLowerCase();
      console.log(`   Checking item "${gi.name}" (SKU: ${gi.sku || 'none'}): skuMatch=${skuMatch}`);
      return skuMatch;
    });
  } else {
    itemIndex = group.items.findIndex(gi => {
      const nameMatch = gi.name && gi.name.trim().toLowerCase() === itemName.trim().toLowerCase();
      return nameMatch && !gi.sku;
    });
  }
  
  if (itemIndex === -1) {
    console.log(`   ⚠️ Item with name "${itemName}"${itemSku ? ` and SKU "${itemSku}"` : ''} not found in group "${group.name}". Adding new item to group...`);
    const newItem = {
      name: itemName.trim(),
      sku: itemSku?.trim() || '',
      itemCode: '',
      costPrice: 0,
      sellingPrice: 0,
      stock: quantity,
      warehouseStocks: [{
        warehouse: targetWarehouse,
        openingStock: 0,
        openingStockValue: 0,
        stockOnHand: quantity,
        committedStock: 0,
        availableForSale: quantity,
        physicalOpeningStock: 0,
        physicalStockOnHand: quantity,
        physicalCommittedStock: 0,
        physicalAvailableForSale: quantity,
      }]
    };
    
    const updateResult = await ItemGroup.findByIdAndUpdate(
      itemGroupId,
      { $push: { items: newItem } },
      { new: true }
    );
    
    if (!updateResult) {
      return { success: false, message: "Failed to add item to group" };
    }
    
    return { success: true, type: 'group', groupName: group.name, itemName: itemName, warehouse: targetWarehouse };
  }
  
  console.log(`   ✅ Found item at index ${itemIndex}`);
  const groupItem = group.items[itemIndex];
  console.log(`   Item details: name="${groupItem.name}", SKU="${groupItem.sku || 'none'}"`);
  console.log(`   Current warehouse stocks:`, groupItem.warehouseStocks?.map(ws => `${ws.warehouse} (${ws.stockOnHand})`).join(', ') || 'none');
  
  // Helper function to update warehouse stock
  const updateWarehouseStock = (warehouseStocks, qty, targetWarehouse) => {
    if (!warehouseStocks || warehouseStocks.length === 0) {
      return [{
        warehouse: targetWarehouse,
        openingStock: 0,
        openingStockValue: 0,
        stockOnHand: qty,
        committedStock: 0,
        availableForSale: qty,
        physicalOpeningStock: 0,
        physicalStockOnHand: qty,
        physicalCommittedStock: 0,
        physicalAvailableForSale: qty,
      }];
    }
    
    // Use flexible matching to find warehouse stock
    let warehouseStock = warehouseStocks.find(ws => 
      matchesWarehouse(ws.warehouse, targetWarehouse)
    );
    
    if (!warehouseStock) {
      warehouseStock = {
        warehouse: targetWarehouse,
        openingStock: 0,
        openingStockValue: 0,
        stockOnHand: 0,
        committedStock: 0,
        availableForSale: 0,
        physicalOpeningStock: 0,
        physicalStockOnHand: 0,
        physicalCommittedStock: 0,
        physicalAvailableForSale: 0,
      };
      warehouseStocks.push(warehouseStock);
    }
    
    const currentStockOnHand = parseFloat(warehouseStock.stockOnHand) || 0;
    const currentAvailableForSale = parseFloat(warehouseStock.availableForSale) || 0;
    const currentPhysicalStockOnHand = parseFloat(warehouseStock.physicalStockOnHand) || 0;
    const currentPhysicalAvailableForSale = parseFloat(warehouseStock.physicalAvailableForSale) || 0;
    
    warehouseStock.warehouse = targetWarehouse;
    warehouseStock.stockOnHand = currentStockOnHand + qty;
    warehouseStock.availableForSale = currentAvailableForSale + qty;
    warehouseStock.physicalStockOnHand = currentPhysicalStockOnHand + qty;
    warehouseStock.physicalAvailableForSale = currentPhysicalAvailableForSale + qty;
    
    return warehouseStocks;
  };
  
  // Convert group to plain object, modify, then update using $set (same fix as PurchaseReceiveController)
  const groupPlain = group.toObject();
  const itemPlain = groupPlain.items[itemIndex];
  const oldStock = itemPlain.warehouseStocks?.find(ws => matchesWarehouse(ws.warehouse, targetWarehouse))?.stockOnHand || 0;
  
  // Find or create warehouse stock entry
  if (!itemPlain.warehouseStocks) {
    itemPlain.warehouseStocks = [];
  }
  
  let wsEntry = itemPlain.warehouseStocks.find(ws => 
    matchesWarehouse(ws.warehouse, targetWarehouse)
  );
  
  if (!wsEntry) {
    wsEntry = {
      warehouse: targetWarehouse,
      openingStock: 0,
      openingStockValue: 0,
      stockOnHand: 0,
      committedStock: 0,
      availableForSale: 0,
      physicalOpeningStock: 0,
      physicalStockOnHand: 0,
      physicalCommittedStock: 0,
      physicalAvailableForSale: 0,
    };
    itemPlain.warehouseStocks.push(wsEntry);
  }
  
  // Update stock values
  const currentStock = parseFloat(wsEntry.stockOnHand) || 0;
  wsEntry.stockOnHand = currentStock + quantity;
  wsEntry.availableForSale = (parseFloat(wsEntry.availableForSale) || 0) + quantity;
  wsEntry.physicalStockOnHand = (parseFloat(wsEntry.physicalStockOnHand) || 0) + quantity;
  wsEntry.physicalAvailableForSale = (parseFloat(wsEntry.physicalAvailableForSale) || 0) + quantity;
  wsEntry.warehouse = targetWarehouse;
  
  console.log(`   📊 Stock update: ${currentStock} + ${quantity} = ${wsEntry.stockOnHand}`);
  
  // Update the entire items array using $set
  const updateResult = await ItemGroup.findByIdAndUpdate(
    itemGroupId,
    {
      $set: {
        [`items.${itemIndex}`]: itemPlain
      }
    },
    { new: true }
  );
  
  if (!updateResult) {
    console.error(`❌ Failed to update stock using findByIdAndUpdate`);
    return { success: false, message: "Failed to update stock" };
  }
  
  // Reload to get actual saved values
  const savedGroup = await ItemGroup.findById(itemGroupId);
  const savedItem = savedGroup.items[itemIndex];
  const savedStock = savedItem.warehouseStocks.find(ws => matchesWarehouse(ws.warehouse, targetWarehouse)) || savedItem.warehouseStocks[0];
  
  // Update monthly opening stock for purchase
  try {
    const itemId = savedItem._id?.toString() || savedItem.id?.toString();
    if (itemId) {
      await updateMonthlyStockForPurchase(itemGroupId, itemId, targetWarehouse, quantity, savedItem.name);
    }
  } catch (monthlyError) {
    console.error(`   ⚠️ Error updating monthly stock (non-critical):`, monthlyError);
  }
  
  console.log(`   ✅ Updated warehouse stocks:`, savedItem.warehouseStocks.map(ws => `${ws.warehouse} (${ws.stockOnHand})`).join(', '));
  console.log(`✅ Successfully added stock for item "${groupItem.name}" in group "${group.name}": ${savedStock?.stockOnHand || 0} in "${savedStock?.warehouse || targetWarehouse}"`);
  
  return { success: true, type: 'group', stock: savedStock, groupName: group.name, itemName: groupItem.name, warehouse: targetWarehouse };
};

// Reduce stock (reversing a bill). Uses the central stock service: strict item matching,
// atomic write, and it refuses (instead of clamping to 0) when the pieces were already sold.
const reduceItemStock = async (itemIdValue, quantity, warehouseName, itemName = null, itemGroupId = null, itemSku = null) => {
  const targetWarehouse = warehouseName?.trim() || "Warehouse";
  const qty = Math.abs(parseFloat(quantity) || 0);
  if (!qty) return { success: true, warehouse: targetWarehouse };
  try {
    const target = await resolveLine({
      itemId: itemIdValue && itemIdValue !== "null" ? itemIdValue : null,
      itemGroupId,
      itemSku,
      itemName: itemName ? extractVendorInfo(itemName).baseName : itemName,
    });
    if (!target) return { success: false, message: `Item "${itemName || itemIdValue}" not found` };
    await moveStock(target, targetWarehouse, -qty);
    return { success: true, type: target.kind, warehouse: targetWarehouse };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

const reduceItemStockByName = (itemGroupId, itemName, quantity, warehouseName, itemSku = null) =>
  reduceItemStock(null, quantity, warehouseName, itemName, itemGroupId, itemSku);

const updateVendorBalance = async (vendorId, billAmount, operation = 'add') => {
  try {
    if (!vendorId) return { success: false, message: "Vendor ID is required" };
    
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return { success: false, message: "Vendor not found" };
    }
    
    const currentPayables = parseFloat(vendor.payables) || 0;
    
    if (operation === 'add') {
      vendor.payables = currentPayables + billAmount;
    } else if (operation === 'subtract') {
      vendor.payables = Math.max(0, currentPayables - billAmount);
    }
    
    await vendor.save();
    return { success: true, type: 'mongodb' };
  } catch (error) {
    console.error("Error updating vendor balance:", error);
    return { success: false, message: error.message };
  }
};

// Helper to sync pricing (Cost Price, Selling Price, MRP) from bill items back into ItemGroup and ShoeItem
const syncItemPricesFromBill = async (items) => {
  if (!items || !Array.isArray(items)) return;

  for (const item of items) {
    const cost = parseFloat(item.rate) || parseFloat(item.costPrice) || 0;
    const selling = parseFloat(item.sellingPrice) || 0;
    const mrp = parseFloat(item.mrp) || (selling > 0 ? selling : 0);
    const sku = (item.itemSku || item.sku || "").toString().trim();
    const rawName = (item.itemName || item.name || "").toString().trim();
    // Extract vendor code and use the clean base name for all DB lookups
    const { baseName: name, vendorCode: syncVendorCode } = extractVendorInfo(rawName);
    const itemIdStr = (item.itemId || item._id || item.id || "").toString().trim();
    const itemGroupId = (item.itemGroupId || "").toString().trim();
    if (syncVendorCode) {
      console.log(`🏷️ syncItemPricesFromBill: rawName="${rawName}" → baseName="${name}", vendorCode="${syncVendorCode}"`);
    }

    console.log(`🏷️ syncItemPricesFromBill: item="${name}", SKU="${sku}", cost=${cost}, selling=${selling}, mrp=${mrp}, group="${itemGroupId}"`);

    try {
      let updated = false;

      // 1. Try updating via ItemGroup ID if provided
      if (itemGroupId && mongoose.Types.ObjectId.isValid(itemGroupId)) {
        const group = await ItemGroup.findById(itemGroupId);
        if (group && Array.isArray(group.items)) {
          let itemIndex = group.items.findIndex(gi => {
            const giId = (gi._id?.toString() || gi.id?.toString() || "");
            if (itemIdStr && giId && itemIdStr === giId) return true;
            if (sku && gi.sku && gi.sku.trim().toLowerCase() === sku.toLowerCase()) return true;
            if (!sku && name && gi.name && gi.name.trim().toLowerCase() === name.toLowerCase()) return true;
            return false;
          });

          if (itemIndex !== -1) {
            if (cost > 0) group.items[itemIndex].costPrice = cost;
            if (selling > 0) group.items[itemIndex].sellingPrice = selling;
            if (mrp > 0) group.items[itemIndex].mrp = mrp;
            if (item.returnable !== undefined) group.items[itemIndex].returnable = Boolean(item.returnable);
            group.markModified('items');
            await group.save();
            console.log(`   ✅ Synced prices/returnable in ItemGroup "${group.name}" for item "${group.items[itemIndex].name}"`);
            updated = true;
          }
        }
      }

      // 2. If not updated yet and SKU or name is present, search all groups
      if (!updated && (sku || name)) {
        const queryConditions = [];
        if (sku) queryConditions.push({ "items.sku": { $regex: `^${sku}$`, $options: 'i' } });
        if (name) queryConditions.push({ "items.name": { $regex: `^${name}$`, $options: 'i' } });

        const matchingGroups = await ItemGroup.find({ $or: queryConditions });
        for (const group of matchingGroups) {
          if (!group.items || !Array.isArray(group.items)) continue;
          let itemIndex = group.items.findIndex(gi => {
            if (sku && gi.sku && gi.sku.trim().toLowerCase() === sku.toLowerCase()) return true;
            if (!sku && name && gi.name && gi.name.trim().toLowerCase() === name.toLowerCase()) return true;
            return false;
          });

          if (itemIndex !== -1) {
            if (cost > 0) group.items[itemIndex].costPrice = cost;
            if (selling > 0) group.items[itemIndex].sellingPrice = selling;
            if (mrp > 0) group.items[itemIndex].mrp = mrp;
            if (item.returnable !== undefined) group.items[itemIndex].returnable = Boolean(item.returnable);
            group.markModified('items');
            await group.save();
            console.log(`   ✅ Synced prices/returnable in found ItemGroup "${group.name}" for item "${group.items[itemIndex].name}"`);
            updated = true;
            break;
          }
        }
      }

      // 3. Try updating in standalone ShoeItem
      let shoeItem = null;
      if (itemIdStr && itemIdStr !== "null" && mongoose.Types.ObjectId.isValid(itemIdStr)) {
        shoeItem = await ShoeItem.findById(itemIdStr);
      }
      if (!shoeItem && sku) {
        shoeItem = await ShoeItem.findOne({ sku: { $regex: `^${sku}$`, $options: 'i' } });
      }
      if (!shoeItem && name) {
        shoeItem = await ShoeItem.findOne({ itemName: { $regex: `^${name}$`, $options: 'i' } });
      }

      if (shoeItem) {
        if (cost > 0) shoeItem.costPrice = cost;
        if (selling > 0) shoeItem.sellingPrice = selling;
        if (mrp > 0) shoeItem.mrp = mrp;
        if (item.returnable !== undefined) shoeItem.returnable = Boolean(item.returnable);
        await shoeItem.save();
        console.log(`   ✅ Synced prices/returnable in standalone ShoeItem for "${shoeItem.itemName}"`);
      }
    } catch (err) {
      console.error(`   ❌ Error syncing prices/returnable for "${name || sku}":`, err);
    }
  }
};

/**
 * Track how many pieces of an item came from each vendor.
 *
 * Products like "SN-10-440-PSP(HMC) STICKY NOTES" and "SN-10-440-PSP(UMC) STICKY NOTES"
 * share ONE item/SKU, but the vendor code in brackets tells them apart. For every bill
 * line we add (sign = 1) or remove (sign = -1) its quantity on the matching
 * vendorPrices[vendorCode] entry, and remember the vendor's full product name in
 * vendorItemNames, so the item pages can show a per-vendor breakdown.
 * Lines without a vendor code are skipped. Never throws (stock flow must not break).
 */
export const recordVendorQuantities = async (billItems = [], vendorName = "", sign = 1) => {
  for (const line of billItems || []) {
    try {
      const qty = (parseFloat(line?.quantity) || 0) * sign;
      const fullName = String(line?.itemName || "").trim();
      if (!qty || !fullName) continue;
      const { vendorCode } = extractVendorInfo(fullName);
      if (!vendorCode) continue;

      const itemIdStr = line.itemId ? String(line.itemId) : "";
      const sku = String(line.itemSku || line.sku || "").trim();
      const now = new Date();

      const applyTo = (vendorPrices = [], vendorItemNames = []) => {
        const vp = vendorPrices.find((v) => v.vendorCode === vendorCode);
        if (vp) {
          vp.quantity = Math.max(0, (Number(vp.quantity) || 0) + qty);
          if (!vp.vendorName && vendorName) vp.vendorName = vendorName;
          if (sign > 0) vp.lastPurchaseDate = now;
        } else if (qty > 0) {
          vendorPrices.push({
            vendorCode,
            vendorName: vendorName || "",
            mrp: parseFloat(line.mrp) || 0,
            costPrice: parseFloat(line.rate) || 0,
            quantity: qty,
            lastPurchaseDate: now,
          });
        }
        if (sign > 0 && !vendorItemNames.some((v) => v.vendorCode === vendorCode && v.originalName === fullName)) {
          vendorItemNames.push({ vendorCode, originalName: fullName });
        }
      };

      if (line.itemGroupId) {
        const group = await ItemGroup.findById(line.itemGroupId);
        if (!group) continue;
        const gi = (group.items || []).find(
          (it) => (itemIdStr && String(it._id) === itemIdStr) || (sku && it.sku === sku)
        );
        if (!gi) continue;
        if (!gi.vendorPrices) gi.vendorPrices = [];
        if (!gi.vendorItemNames) gi.vendorItemNames = [];
        applyTo(gi.vendorPrices, gi.vendorItemNames);
        group.markModified("items");
        await group.save();
      } else {
        let item = null;
        if (itemIdStr && mongoose.Types.ObjectId.isValid(itemIdStr)) item = await ShoeItem.findById(itemIdStr);
        if (!item && sku) item = await ShoeItem.findOne({ sku });
        if (!item) continue;
        if (!item.vendorPrices) item.vendorPrices = [];
        if (!item.vendorItemNames) item.vendorItemNames = [];
        applyTo(item.vendorPrices, item.vendorItemNames);
        item.markModified("vendorPrices");
        item.markModified("vendorItemNames");
        await item.save();
      }
    } catch (err) {
      console.error(`   ⚠️ Could not record vendor quantity for "${line?.itemName}":`, err.message);
    }
  }
};

// Create a new bill
export const createBill = async (req, res) => {
  try {
    const billData = req.body;
    
    // Validate required fields
    if (!billData.billNumber || !billData.vendorName || !billData.userId) {
      return res.status(400).json({ message: "Bill number, vendor name, and userId are required" });
    }
    
    // vendorId is now a UUID string from PostgreSQL Vendor (optional field)
    if (!billData.vendorId) {
      billData.vendorId = null;
    }
    
    // Make billNumber unique per user (email) instead of globally unique
    const existingBill = await Bill.findOne({ 
      billNumber: billData.billNumber,
      userId: billData.userId
    });
    
    if (existingBill) {
      return res.status(409).json({ message: "Bill number already exists for this user" });
    }

    billData.stockApplied = false; // set to true below once stock is really added

    const bill = await Bill.create(billData);

    // Reply as soon as the bill is stored. The price sync / stock / vendor updates
    // below can take longer than the client or host (Render) will wait, which left the
    // UI stuck on "Saving…" even though the bill was already saved. They keep running
    // after the response; any failure is logged (see catch → headersSent).
    res.status(201).json(bill);

    // Sync item pricing back to ItemGroup and ShoeItem
    if (billData.items && Array.isArray(billData.items)) {
      await syncItemPricesFromBill(billData.items);
    }
    
    // Log vendor activity for bill creation
    if (billData.vendorId) {
      const formatCurrency = (value) => {
        if (!value && value !== 0) return "0.00";
        return new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 2,
        }).format(value).replace("₹", "₹").replace(/\s/g, "");
      };
      
      const originator = getOriginatorName(
        billData.warehouse,
        billData.branch,
        { locName: billData.locCode }
      );
      
      await logVendorActivity({
        vendorId: billData.vendorId,
        eventType: "BILL_ADDED",
        title: "Bill added",
        description: `Bill ${billData.billNumber} of amount ${formatCurrency(billData.finalTotal || 0)} created by ${originator}`,
        originator: originator,
        relatedEntityId: bill._id.toString(),
        relatedEntityType: "bill",
        metadata: {
          billNumber: billData.billNumber,
          amount: billData.finalTotal || 0,
          status: billData.status || "draft",
        },
        changedBy: billData.userId || "",
      });
    }
    
    // If status is "open", process the bill (add stock and update vendor balance)
    // IMPORTANT: If bill is from Purchase Receive, stock was already added at Receive stage
    // So we should NOT add stock again - only update vendor balance
    console.log(`\n📋 BILL CREATION STOCK CHECK:`);
    console.log(`   Status: "${billData.status}"`);
    console.log(`   Final Total: ${billData.finalTotal}`);
    console.log(`   Source Type: "${billData.sourceType || 'direct'}"`);
    console.log(`   Items count: ${billData.items?.length || 0}`);
    
    // Check if there are items with quantity > 0 (more reliable than checking finalTotal)
    const hasItemsWithQuantity = billData.items && Array.isArray(billData.items) && 
      billData.items.some(item => parseFloat(item.quantity) > 0);
    
    console.log(`   Has items with quantity > 0: ${hasItemsWithQuantity}`);
    if (billData.items && Array.isArray(billData.items)) {
      console.log(`   Item quantities:`, billData.items.map(item => ({
        name: item.itemName,
        quantity: parseFloat(item.quantity) || 0,
        itemId: item.itemId,
        itemGroupId: item.itemGroupId
      })));
    }
    
    // A DRAFT bill does not move stock or payables — only open/completed bills do.
    // (Drafts used to add stock here, and draft → open added it a second time.)
    if ((billData.status === "open" || billData.status === "completed") && hasItemsWithQuantity) {
      const sourceType = billData.sourceType || "direct";
      console.log(`   ✅ Status is "${billData.status}" and items with quantity > 0 found, proceeding...`);
      console.log(`   Source type: "${sourceType}"`);
      console.log(`   Final Total: ${billData.finalTotal || 0} (may be 0, but items have quantity)`);
      
      // Only add stock for Direct Bills
      // IMPORTANT: 
      // - PO → Bill: Does NOT add stock (stock will be added when Receive is created)
      // - PO → Receive → Bill: Does NOT add stock (already added at Receive stage)
      // - Direct Bill: Adds stock (manual entry, no PO/Receive)
      if (sourceType === "direct") {
        console.log(`   ✅ Source type is "direct", will add stock...`);
        // Determine target warehouse from billData.warehouse, user's email, or locCode
        // Admin email (officerootments@gmail.com) always uses "Warehouse" regardless of locCode
        const adminEmails = ['officerootments@gmail.com'];
        const userId = billData.userId || "";
        const isAdminEmail = userId && typeof userId === 'string' && adminEmails.some(email => userId.toLowerCase() === email.toLowerCase());
        
        let warehouseName = billData.warehouse?.trim() || "";
        
        if (isAdminEmail) {
          // Admin email always uses "Warehouse" - has access to all stores
          warehouseName = "Warehouse";
          console.log(`📍 Admin email detected (${userId}), using warehouse: "Warehouse" (ignoring locCode and billData.warehouse)`);
        } else if (!warehouseName) {
          // If warehouse not provided and not admin, determine from locCode
          const fallbackLocations = [
            { "locName": "Warehouse", "locCode": "858" }
          ];
          
          const userLocCode = billData.locCode || "";
          if (userLocCode) {
            const location = fallbackLocations.find(loc => loc.locCode === userLocCode);
            if (location) {
              warehouseName = mapLocNameToWarehouse(location.locName);
              console.log(`📍 Determined warehouse from locCode ${userLocCode}: "${location.locName}" -> "${warehouseName}"`);
            } else {
              warehouseName = "Warehouse";
              console.log(`⚠️ locCode ${userLocCode} not found in fallback locations, using default "Warehouse"`);
            }
          } else {
            warehouseName = "Warehouse";
            console.log(`⚠️ No warehouse or locCode provided, using default "Warehouse"`);
          }
        }
        
        console.log(`📦 Processing Direct Bill with status "open" - adding stock for items to warehouse: ${warehouseName}`);
        
        // Add stock for items (if any) - only to the selected warehouse
        if (billData.items && Array.isArray(billData.items) && billData.items.length > 0) {
        console.log(`   Found ${billData.items.length} items to process`);
        const stockAdditionErrors = [];
        
        // Aggregate items by key to correctly accumulate total quantity when multiple rows share the same item
        const aggregatedItemsMap = new Map();
        for (const item of billData.items) {
          const qty = parseFloat(item.quantity) || 0;
          if (qty <= 0) continue;
          const key = item.itemId?.toString() || `${item.itemGroupId || ''}_${item.itemName || ''}_${item.itemSku || ''}`;
          if (aggregatedItemsMap.has(key)) {
            aggregatedItemsMap.get(key).quantity += qty;
          } else {
            aggregatedItemsMap.set(key, {
              itemId: item.itemId,
              quantity: qty,
              itemName: item.itemName,
              itemGroupId: item.itemGroupId,
              itemSku: item.itemSku,
            });
          }
        }
        
        for (const item of aggregatedItemsMap.values()) {
          try {
            console.log(`   🔍 Processing aggregated item for stock addition:`);
            console.log(`      - Item ID: ${item.itemId}`);
            console.log(`      - Item Name: ${item.itemName}`);
            console.log(`      - Item Group ID: ${item.itemGroupId || 'none'}`);
            console.log(`      - Item SKU: ${item.itemSku || 'none'}`);
            console.log(`      - Total Quantity: ${item.quantity}`);
            console.log(`      - Warehouse: ${warehouseName}`);
            
            const result = await addItemStock(
              item.itemId,
              item.quantity,
              warehouseName,
              item.itemName,
              item.itemGroupId,
              item.itemSku
            );
            if (result.success) {
              console.log(`   ✅ Successfully added stock for ${item.itemName || item.itemId} to ${warehouseName} (Qty: ${item.quantity})`);
              if (result.type === 'group') {
                console.log(`      - Group: ${result.groupName}`);
              }
            } else {
              const errorMsg = `Item ${item.itemName || item.itemId}: ${result.message}`;
              console.warn(`   ⚠️ Failed to add stock: ${errorMsg}`);
              stockAdditionErrors.push(errorMsg);
            }
          } catch (error) {
            const errorMsg = `Item ${item.itemName || item.itemId}: ${error.message}`;
            console.error(`   ❌ Error adding stock for item ${item.itemName}:`, error);
            stockAdditionErrors.push(errorMsg);
          }
        }
        
        // If there are stock addition errors, log them but don't fail the bill creation
        // (unlike vendor credits, bills can be created even if stock update fails)
        if (stockAdditionErrors.length > 0) {
          console.warn(`⚠️ Some items failed to update stock, but bill was created:`, stockAdditionErrors);
        }

        // Per-vendor breakdown (e.g. HMC: 12, UMC: 10) for items shared across vendors
        await recordVendorQuantities(billData.items, billData.vendorName, 1);
        // Remember where the stock really went, so edit/delete reverse it in the same place
        await Bill.updateOne({ _id: bill._id }, { $set: { warehouse: warehouseName, stockApplied: true } });
        } else {
          console.log(`   No items found in bill - skipping stock addition`);
        }
      } else if (sourceType === "from_po") {
        console.log(`📦 Processing bill from Purchase Order - skipping stock addition (stock will be added when Receive is created)`);
      } else if (sourceType === "from_receive") {
        console.log(`📦 Processing bill from Purchase Receive - skipping stock addition (already added at Receive stage)`);
      }
      
      // Update vendor balance (increase payables) - always do this for "open" or "completed" bills
      if (billData.vendorId) {
        await updateVendorBalance(billData.vendorId, billData.finalTotal, 'add');
        console.log(`✅ Updated vendor balance - increased payables by ${billData.finalTotal}`);
      }
    }
  } catch (error) {
    if (res.headersSent) {
      // Bill was saved and returned; a post-save step (stock/vendor sync) failed.
      console.error("Create bill: post-save processing failed:", error);
      return;
    }
    console.error("Create bill error:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      code: error.code,
      keyValue: error.keyValue,
      errors: error.errors
    });
    
    if (error.code === 11000) {
      return res.status(409).json({ message: "Bill number already exists" });
    }
    
    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map(e => e.message).join(", ");
      return res.status(400).json({ message: "Validation error", error: errors });
    }
    
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all bills for a user
export const getBills = async (req, res) => {
  try {
    const { userId, userPower, status, locCode, warehouse } = req.query;
    
    const query = {};
    
    // User is admin if: power === 'admin' OR locCode === '858' (Warehouse) OR email === 'officerootments@gmail.com'
    const adminEmails = ['officerootments@gmail.com'];
    const isAdminEmail = userId && typeof userId === 'string' && adminEmails.some(email => userId.toLowerCase() === email.toLowerCase());
    const isAdmin = isAdminEmail ||
                    (userPower && (userPower.toLowerCase() === 'admin' || userPower.toLowerCase() === 'super_admin')) ||
                    (locCode && (locCode === '858' || locCode === '103')); // 858 = Warehouse, 103 = WAREHOUSE
    
    // If admin has switched to a specific store (not Warehouse), filter by that store
    const isAdminViewingSpecificStore = isAdmin && warehouse && warehouse !== "All Stores";
    
    if ((!isAdmin || isAdminViewingSpecificStore) && warehouse) {
      // Check warehouse, branch, or locCode fields for compatibility with old bills
      query.$or = [
        { warehouse: warehouse },
        { branch: warehouse },
        { locCode: warehouse }
      ];
      console.log(`💰 Filtering bills for warehouse: ${warehouse}`);
    } else if (!isAdmin && userId) {
      const userIdStr = userId.toString();
      // Use email as primary identifier - case insensitive match
      if (userIdStr.includes('@')) {
        query.userId = { $regex: `^${userIdStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
      } else {
        query.userId = userIdStr;
      }
    }
    // If admin, no userId filter - show all bills
    
    if (status) query.status = status;
    
    const bills = await Bill.find(query)
      .sort({ createdAt: -1 });
    res.status(200).json(bills);
  } catch (error) {
    console.error("Get bills error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get a single bill by ID
export const getBillById = async (req, res) => {
  try {
    const { id } = req.params;
    const bill = await Bill.findById(id);
    
    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    const billObj = bill.toObject();
    let hasUpdates = false;

    if (billObj.items && Array.isArray(billObj.items)) {
      for (let i = 0; i < billObj.items.length; i++) {
        const item = billObj.items[i];
        const itemId = item.itemId?.toString();
        const itemGroupId = item.itemGroupId?.toString();
        let targetSku = item.sku || item.itemSku || "";

        let resolved = false;

        // 1. Check group items first if itemGroupId is set
        if (itemGroupId) {
          const group = await ItemGroup.findById(itemGroupId);
          if (group && Array.isArray(group.items)) {
            const found = group.items.find(gi => 
              (itemId && (gi._id?.toString() === itemId || gi.id?.toString() === itemId)) ||
              (targetSku && gi.sku && gi.sku.trim().toLowerCase() === targetSku.trim().toLowerCase())
            );
            if (found) {
              if (found.sku) targetSku = found.sku;
              if (found.name && !billObj.items[i].itemName) billObj.items[i].itemName = found.name;
              if (found.hsnCode && !billObj.items[i].hsnCode) billObj.items[i].hsnCode = found.hsnCode;
              if (found.itemCode && !billObj.items[i].itemCode) billObj.items[i].itemCode = found.itemCode;
              if (found.returnable !== undefined && found.returnable !== null && billObj.items[i].returnable === undefined) {
                billObj.items[i].returnable = found.returnable;
              }
              resolved = true;
            }
          }
        }

        // 2. Check standalone ShoeItem
        if (!resolved && itemId && itemId !== "null" && mongoose.Types.ObjectId.isValid(itemId)) {
          const shoeItem = await ShoeItem.findById(itemId);
          if (shoeItem) {
            if (shoeItem.sku) targetSku = shoeItem.sku;
            if (shoeItem.itemName && !billObj.items[i].itemName) billObj.items[i].itemName = shoeItem.itemName;
            if (shoeItem.hsnCode && !billObj.items[i].hsnCode) billObj.items[i].hsnCode = shoeItem.hsnCode;
            if (shoeItem.itemCode && !billObj.items[i].itemCode) billObj.items[i].itemCode = shoeItem.itemCode;
            if (shoeItem.returnable !== undefined && billObj.items[i].returnable === undefined) {
              billObj.items[i].returnable = shoeItem.returnable;
            }
          }
        }

        if (targetSku) {
          if (billObj.items[i].sku !== targetSku || billObj.items[i].itemSku !== targetSku) {
            billObj.items[i].sku = targetSku;
            billObj.items[i].itemSku = targetSku;
            if (bill.items && bill.items[i]) {
              bill.items[i].sku = targetSku;
              bill.items[i].itemSku = targetSku;
              hasUpdates = true;
            }
          }
        }
      }
    }

    if (hasUpdates) {
      await bill.save().catch(err => console.warn("Could not sync bill SKUs in getBillById:", err));
    }
    
    res.status(200).json(billObj);
  } catch (error) {
    console.error("Get bill error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update a bill
export const updateBill = async (req, res) => {
  try {
    const { id } = req.params;
    const billData = req.body;
    
    // Get existing bill to check status changes
    const existingBill = await Bill.findById(id);
    if (!existingBill) {
      return res.status(404).json({ message: "Bill not found" });
    }
    
    const oldStatus = existingBill.status;
    const newStatus = billData.status || oldStatus;
    const oldFinalTotal = parseFloat(existingBill.finalTotal) || 0;
    const newFinalTotal = parseFloat(billData.finalTotal) || oldFinalTotal;
    const sourceType = billData.sourceType || existingBill.sourceType || "direct";
    
    // Determine target warehouse from billData.warehouse, existingBill.warehouse, user's email, or locCode
    // Admin email (officerootments@gmail.com) always uses "Warehouse" regardless of locCode
    const adminEmails = ['officerootments@gmail.com'];
    const userId = billData.userId || existingBill.userId || "";
    const isAdminEmail = userId && typeof userId === 'string' && adminEmails.some(email => userId.toLowerCase() === email.toLowerCase());
    
    let warehouseName = billData.warehouse?.trim() || existingBill.warehouse?.trim() || "";
    
    if (isAdminEmail) {
      // Admin email always uses "Warehouse" - has access to all stores
      warehouseName = "Warehouse";
      console.log(`📍 Admin email detected (${userId}), using warehouse: "Warehouse" (ignoring locCode and billData.warehouse)`);
    } else if (!warehouseName) {
      // If warehouse not provided and not admin, determine from locCode
       const fallbackLocations = [
        { "locName": "Warehouse", "locCode": "858" }
      ];
      
      const userLocCode = billData.locCode || existingBill.locCode || "";
      if (userLocCode) {
        const location = fallbackLocations.find(loc => loc.locCode === userLocCode);
        if (location) {
          warehouseName = mapLocNameToWarehouse(location.locName);
          console.log(`📍 Determined warehouse from locCode ${userLocCode}: "${location.locName}" -> "${warehouseName}"`);
        } else {
          warehouseName = "Warehouse";
          console.log(`⚠️ locCode ${userLocCode} not found in fallback locations, using default "Warehouse"`);
        }
      } else {
        warehouseName = "Warehouse";
        console.log(`⚠️ No warehouse or locCode provided, using default "Warehouse"`);
      }
    }

    // A bill that recorded where its stock went is always adjusted/reversed in THAT warehouse.
    if (existingBill.stockApplied === true && existingBill.warehouse) {
      warehouseName = existingBill.warehouse;
      billData.warehouse = warehouseName;
    }
    // Older bills (before the stockApplied flag): a DRAFT direct bill already added its stock
    // and payables when it was created — don't add them a second time when it is opened.
    const legacyDraftProcessed = existingBill.stockApplied === undefined && oldStatus === "draft" && sourceType === "direct";
    delete billData.stockApplied; // bookkeeping field, set only below

    console.log(`\n🔄 BILL UPDATE STARTED`);
    console.log(`   Bill ID: ${id}`);
    console.log(`   Old Status: "${oldStatus}"`);
    console.log(`   New Status: "${newStatus}"`);
    console.log(`   Old Final Total: ${oldFinalTotal}`);
    console.log(`   New Final Total: ${newFinalTotal}`);
    console.log(`   Source Type: ${sourceType}`);
    console.log(`   Warehouse: ${warehouseName}`);
    
    // Handle status changes and reversals
    // IMPORTANT: Only add/reduce stock for Direct Bills
    // PO → Bill and PO → Receive → Bill should NOT affect stock
    
    // If changing from "open" or "completed" to "draft", reverse stock and vendor balance
    if ((oldStatus === "open" || oldStatus === "completed") && newStatus === "draft") {
      if (sourceType === "direct") billData.stockApplied = false;
      // Only reverse stock for Direct Bills
      if (sourceType === "direct" && existingBill.items && Array.isArray(existingBill.items)) {
        console.log(`📦 Reversing stock for Direct Bill (changing from open to draft)`);
        const stockReductionErrors = [];
        
        // Aggregate items by key to correctly reverse the full quantity
        const aggregatedExistingMap = new Map();
        for (const item of existingBill.items) {
          const qty = parseFloat(item.quantity) || 0;
          if (qty <= 0) continue;
          const key = item.itemId?.toString() || `${item.itemGroupId || ''}_${item.itemName || ''}_${item.itemSku || ''}`;
          if (aggregatedExistingMap.has(key)) {
            aggregatedExistingMap.get(key).quantity += qty;
          } else {
            aggregatedExistingMap.set(key, {
              itemId: item.itemId,
              quantity: qty,
              itemName: item.itemName,
              itemGroupId: item.itemGroupId,
              itemSku: item.itemSku,
            });
          }
        }
        
        for (const item of aggregatedExistingMap.values()) {
          try {
            console.log(`   🔍 Processing aggregated item for stock reduction:`);
            console.log(`      - Item ID: ${item.itemId || 'null'}`);
            console.log(`      - Item Name: ${item.itemName || 'Unknown'}`);
            console.log(`      - Item Group ID: ${item.itemGroupId || 'null'}`);
            console.log(`      - Item SKU: ${item.itemSku || 'none'}`);
            console.log(`      - Total Quantity: ${item.quantity}`);
            console.log(`      - Warehouse: ${warehouseName}`);
            
            const result = await reduceItemStock(
              item.itemId,
              item.quantity,
              warehouseName,
              item.itemName,
              item.itemGroupId,
              item.itemSku
            );
            
            if (result && result.success) {
              console.log(`   ✅ Successfully reduced stock for ${item.itemName || item.itemId} (Qty: ${item.quantity})`);
              if (result.type === 'group') {
                console.log(`      - Group: ${result.groupName}`);
              }
            } else {
              const errorMsg = `Item ${item.itemName || item.itemId}: ${result?.message || 'Unknown error'}`;
              console.warn(`   ⚠️ Failed to reduce stock: ${errorMsg}`);
              stockReductionErrors.push(errorMsg);
            }
          } catch (error) {
            const errorMsg = `Item ${item.itemName || item.itemId}: ${error.message}`;
            console.error(`   ❌ Error reducing stock for item ${item.itemName}:`, error);
            stockReductionErrors.push(errorMsg);
          }
        }
        
        if (stockReductionErrors.length > 0) {
          console.warn(`⚠️ Some items failed to reduce stock:`, stockReductionErrors);
        } else {
          console.log(`✅ All items successfully reduced from stock`);
        }
      } else {
        console.log(`📦 Skipping stock reversal (bill is from ${sourceType}, stock not managed here)`);
      }
      
      // Reverse vendor balance (reduce payables) - always do this
      if (existingBill.vendorId) {
        await updateVendorBalance(existingBill.vendorId, oldFinalTotal, 'subtract');
      }
    }
    
    // If changing from "draft" to "open" or "completed", process the bill (add stock and update vendor balance)
    if (legacyDraftProcessed && (newStatus === "open" || newStatus === "completed")) {
      billData.stockApplied = true; // stock + payables were already added when this draft was created
    }
    if (oldStatus === "draft" && (newStatus === "open" || newStatus === "completed") && !legacyDraftProcessed) {
      if (sourceType === "direct") {
        billData.stockApplied = true;
        billData.warehouse = warehouseName;
      }
      console.log(`\n📋 BILL STATUS CHANGE DETECTED: draft -> ${newStatus}`);
      console.log(`   Bill ID: ${id}`);
      console.log(`   Source Type: ${sourceType}`);
      console.log(`   Warehouse: ${warehouseName}`);
      console.log(`   Final Total: ${newFinalTotal}`);
      console.log(`   Status comparison: oldStatus="${oldStatus}" === "draft": ${oldStatus === "draft"}`);
      console.log(`   Status comparison: newStatus="${newStatus}" in ["open","completed"]: ${["open","completed"].includes(newStatus)}`);
      
      // Only add stock for Direct Bills
      if (sourceType === "direct") {
        const itemsToProcess = billData.items || existingBill.items || [];
        console.log(`   Items to process: ${itemsToProcess.length}`);
        
        // Check if there are items with quantity > 0
        const hasItemsWithQuantity = Array.isArray(itemsToProcess) && 
          itemsToProcess.some(item => parseFloat(item.quantity) > 0);
        
        console.log(`   Has items with quantity > 0: ${hasItemsWithQuantity}`);
        
        if (hasItemsWithQuantity && Array.isArray(itemsToProcess) && itemsToProcess.length > 0) {
          console.log(`📦 Adding stock for Direct Bill (changing from draft to open)`);
          const stockAdditionErrors = [];
          
          // Aggregate items by key to correctly accumulate total quantity
          const aggregatedDraftToOpenMap = new Map();
          for (const item of itemsToProcess) {
            const qty = parseFloat(item.quantity) || 0;
            if (qty <= 0) continue;
            const key = item.itemId?.toString() || `${item.itemGroupId || ''}_${item.itemName || ''}_${item.itemSku || ''}`;
            if (aggregatedDraftToOpenMap.has(key)) {
              aggregatedDraftToOpenMap.get(key).quantity += qty;
            } else {
              aggregatedDraftToOpenMap.set(key, {
                itemId: item.itemId,
                quantity: qty,
                itemName: item.itemName,
                itemGroupId: item.itemGroupId,
                itemSku: item.itemSku,
              });
            }
          }
          
          for (const item of aggregatedDraftToOpenMap.values()) {
            try {
              console.log(`   🔍 Processing aggregated item for stock addition:`);
              console.log(`      - Item ID: ${item.itemId || 'null'}`);
              console.log(`      - Item Name: ${item.itemName || 'Unknown'}`);
              console.log(`      - Item Group ID: ${item.itemGroupId || 'null'}`);
              console.log(`      - Item SKU: ${item.itemSku || 'none'}`);
              console.log(`      - Total Quantity: ${item.quantity}`);
              console.log(`      - Warehouse: ${warehouseName}`);
              
              const result = await addItemStock(
                item.itemId,
                item.quantity,
                warehouseName,
                item.itemName,
                item.itemGroupId,
                item.itemSku
              );
              
              if (result && result.success) {
                console.log(`   ✅ Successfully added stock for ${item.itemName || item.itemId} (Qty: ${item.quantity})`);
                if (result.type === 'group') {
                  console.log(`      - Group: ${result.groupName}`);
                }
              } else {
                const errorMsg = `Item ${item.itemName || item.itemId}: ${result?.message || 'Unknown error'}`;
                console.warn(`   ⚠️ Failed to add stock: ${errorMsg}`);
                stockAdditionErrors.push(errorMsg);
              }
            } catch (error) {
              const errorMsg = `Item ${item.itemName || item.itemId}: ${error.message}`;
              console.error(`   ❌ Error adding stock for item ${item.itemName}:`, error);
              stockAdditionErrors.push(errorMsg);
            }
          }
          
          if (stockAdditionErrors.length > 0) {
            console.warn(`⚠️ Some items failed to update stock:`, stockAdditionErrors);
          } else {
            console.log(`✅ All items successfully added to stock`);
          }
        } else {
          console.log(`📦 Skipping stock addition (no items with quantity > 0)`);
        }
      } else {
        console.log(`📦 Skipping stock addition (bill is from ${sourceType}, stock not managed here)`);
      }
      
      // Update vendor balance - only if finalTotal > 0
      const vendorId = billData.vendorId || existingBill.vendorId;
      if (vendorId && newFinalTotal > 0) {
        console.log(`💰 Updating vendor balance: adding ${newFinalTotal}`);
        await updateVendorBalance(vendorId, newFinalTotal, 'add');
        console.log(`✅ Vendor balance updated`);
      } else if (vendorId && newFinalTotal === 0) {
        console.log(`💰 Skipping vendor balance update (finalTotal is 0)`);
      } else {
        console.log(`💰 Skipping vendor balance update (no vendorId)`);
      }
      console.log(`=== END BILL STATUS CHANGE ===\n`);
    }
    
    // If status remains "open" or "completed" (or changes between them), handle item quantity changes
    if ((oldStatus === "open" || oldStatus === "completed") && (newStatus === "open" || newStatus === "completed")) {
      // Adjust vendor balance if total changed
      if (oldFinalTotal !== newFinalTotal) {
      const difference = newFinalTotal - oldFinalTotal;
      const vendorId = billData.vendorId || existingBill.vendorId;
      if (vendorId) {
        if (difference > 0) {
          // Bill increased
          await updateVendorBalance(vendorId, difference, 'add');
        } else {
          // Bill decreased
          await updateVendorBalance(vendorId, Math.abs(difference), 'subtract');
        }
        }
      }
      
      // Handle stock changes if items changed (only for Direct Bills)
      if (sourceType === "direct") {
        const oldItems = existingBill.items || [];
        const newItems = billData.items || [];
        
        console.log(`📦 Bill status remains "${newStatus}" - checking for item quantity changes...`);
        console.log(`   Old items count: ${oldItems.length}, New items count: ${newItems.length}`);
        
        // Create maps for easier comparison (accumulate quantities by key)
        const oldItemsMap = new Map();
        oldItems.forEach(item => {
          const key = item.itemId?.toString() || `${item.itemGroupId || ''}_${item.itemName || ''}_${item.itemSku || ''}`;
          oldItemsMap.set(key, (oldItemsMap.get(key) || 0) + (parseFloat(item.quantity) || 0));
        });
        
        const newItemsMap = new Map();
        newItems.forEach(item => {
          const key = item.itemId?.toString() || `${item.itemGroupId || ''}_${item.itemName || ''}_${item.itemSku || ''}`;
          const qty = parseFloat(item.quantity) || 0;
          if (newItemsMap.has(key)) {
            newItemsMap.get(key).quantity += qty;
          } else {
            newItemsMap.set(key, {
              quantity: qty,
              itemId: item.itemId,
              itemName: item.itemName,
              itemGroupId: item.itemGroupId,
              itemSku: item.itemSku
            });
          }
        });
        
        // Process all items - add for new/increased, subtract for removed/decreased
        for (const [key, newItemData] of newItemsMap.entries()) {
          const oldQty = oldItemsMap.get(key) || 0;
          const newQty = newItemData.quantity;
          const qtyDiff = newQty - oldQty;
          
          if (qtyDiff !== 0) {
            console.log(`   📊 Item "${newItemData.itemName || key}": ${oldQty} -> ${newQty} (diff: ${qtyDiff > 0 ? '+' : ''}${qtyDiff})`);
            
            if (qtyDiff > 0) {
              // Quantity increased - add stock
              try {
                await addItemStock(
                  newItemData.itemId,
                  qtyDiff,
                  warehouseName,
                  newItemData.itemName,
                  newItemData.itemGroupId,
                  newItemData.itemSku
                );
                console.log(`   ✅ Added ${qtyDiff} to stock for "${newItemData.itemName || key}"`);
              } catch (error) {
                console.error(`   ❌ Error adding stock for item ${newItemData.itemName}:`, error);
              }
            } else {
              // Quantity decreased - subtract stock
              try {
                await reduceItemStock(
                  newItemData.itemId,
                  Math.abs(qtyDiff),
                  warehouseName,
                  newItemData.itemName,
                  newItemData.itemGroupId,
                  newItemData.itemSku
                );
                console.log(`   ✅ Subtracted ${Math.abs(qtyDiff)} from stock for "${newItemData.itemName || key}"`);
              } catch (error) {
                console.error(`   ❌ Error reducing stock for item ${newItemData.itemName}:`, error);
              }
            }
          }
        }
        
        // Handle items that were removed (in old but not in new)
        for (const [key, oldQty] of oldItemsMap.entries()) {
          if (!newItemsMap.has(key) && oldQty > 0) {
            // Item was removed - subtract its quantity
            const oldItem = oldItems.find(item => {
              const itemKey = item.itemId?.toString() || `${item.itemGroupId || ''}_${item.itemName || ''}_${item.itemSku || ''}`;
              return itemKey === key;
            });
            
            if (oldItem) {
              console.log(`   📊 Item "${oldItem.itemName || key}" was removed (qty: ${oldQty})`);
              try {
                await reduceItemStock(
                  oldItem.itemId,
                  oldQty,
                  warehouseName,
                  oldItem.itemName,
                  oldItem.itemGroupId,
                  oldItem.itemSku
                );
                console.log(`   ✅ Subtracted ${oldQty} from stock for removed item "${oldItem.itemName || key}"`);
              } catch (error) {
                console.error(`   ❌ Error reducing stock for removed item ${oldItem.itemName}:`, error);
              }
            }
          }
        }
      } else {
        console.log(`📦 Skipping stock adjustment (bill is from ${sourceType}, stock not managed here)`);
      }
    }
    
    const bill = await Bill.findByIdAndUpdate(
      id,
      billData,
      { new: true, runValidators: true }
    );
    
    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    // Sync item pricing back to ItemGroup and ShoeItem
    if (billData.items && Array.isArray(billData.items)) {
      await syncItemPricesFromBill(billData.items);
    }
    
    // Log vendor activity for bill updates
    const vendorId = billData.vendorId || existingBill.vendorId;
    if (vendorId) {
      const formatCurrency = (value) => {
        if (!value && value !== 0) return "0.00";
        return new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 2,
        }).format(value).replace("₹", "₹").replace(/\s/g, "");
      };
      
      // Log status changes
      if (oldStatus !== newStatus) {
        const originator = getOriginatorName(
          billData.warehouse || existingBill.warehouse,
          billData.branch || existingBill.branch,
          { locName: billData.locCode || existingBill.locCode }
        );
        
        let description = "";
        if (newStatus === "open") {
          description = `Bill ${bill.billNumber} marked as open by ${originator}`;
        } else if (newStatus === "draft") {
          description = `Bill ${bill.billNumber} marked as draft by ${originator}`;
        } else if (newStatus === "paid") {
          description = `Bill ${bill.billNumber} marked as paid by ${originator}`;
        }
        
        if (description) {
          await logVendorActivity({
            vendorId: vendorId,
            eventType: "BILL_UPDATED",
            title: "Bill updated",
            description: description,
            originator: originator,
            relatedEntityId: bill._id.toString(),
            relatedEntityType: "bill",
            metadata: {
              billNumber: bill.billNumber,
              oldStatus,
              newStatus,
            },
            changedBy: billData.userId || existingBill.userId || "",
          });
        }
      }
    }
    
    res.status(200).json(bill);
  } catch (error) {
    console.error("Update bill error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a bill
export const deleteBill = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the bill before deleting to reverse operations
    const bill = await Bill.findById(id);
    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }
    
    const sourceType = bill.sourceType || "direct";
    const isLegacy = bill.stockApplied === undefined;
    // Payables were added for open/completed bills (and, for older bills, also for drafts)
    const payablesCounted = bill.status === "open" || bill.status === "completed" ||
      (isLegacy && bill.status === "draft" && sourceType === "direct");
    // Stock was added only for direct bills
    const stockCounted = sourceType === "direct" && (bill.stockApplied === true || (isLegacy && payablesCounted));

    if (stockCounted && Array.isArray(bill.items) && bill.items.length > 0) {
      // Older admin bills put stock in "Warehouse" even when another warehouse was saved on the bill
      const isAdminEmail = String(bill.userId || "").toLowerCase() === "officerootments@gmail.com";
      const warehouseName = bill.stockApplied === true
        ? (bill.warehouse?.trim() || "Warehouse")
        : (isAdminEmail ? "Warehouse" : (bill.warehouse?.trim() || "Warehouse"));
      const lines = bill.items.map((it) => ({
        itemId: it.itemId,
        itemGroupId: it.itemGroupId,
        itemSku: it.itemSku || it.sku,
        itemName: it.itemName ? extractVendorInfo(it.itemName).baseName : it.itemName,
        quantity: it.quantity,
      }));
      try {
        // All-or-nothing: if some pieces were already sold/moved, nothing changes and the bill stays
        await applyLines(lines, warehouseName, -1);
      } catch (err) {
        if (err instanceof StockError) {
          return res.status(409).json({
            message: `Cannot delete this bill: ${err.message}. Some of its pieces have already been sold or moved. Record an inventory adjustment instead.`,
            code: "STOCK_ERROR",
            details: err.details,
          });
        }
        throw err;
      }
      // Undo the per-vendor breakdown recorded when this bill was created
      await recordVendorQuantities(bill.items, bill.vendorName, -1);
    }

    if (payablesCounted && bill.vendorId) {
      await updateVendorBalance(bill.vendorId, parseFloat(bill.finalTotal) || 0, 'subtract');
    }
    
    const deletedBill = await Bill.findByIdAndDelete(id);
    
    if (!deletedBill) {
      return res.status(404).json({ message: "Bill not found" });
    }
    
    res.status(200).json({ message: "Bill deleted successfully" });
  } catch (error) {
    console.error("Delete bill error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Convert Purchase Order to Bill
export const convertPurchaseOrderToBill = async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;
    const { billNumber, billDate, dueDate, warehouse, branch } = req.body;
    
    // Import PurchaseOrder model
    const PurchaseOrder = (await import("../model/PurchaseOrder.js")).default;
    
    // Get the purchase order
    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }
    
    // Check if bill already exists for this PO
    const existingBill = await Bill.findOne({ purchaseOrderId: purchaseOrderId });
    if (existingBill) {
      return res.status(409).json({ 
        message: "Bill already exists for this purchase order",
        billId: existingBill._id 
      });
    }
    
    // First, convert items and calculate amounts
    const convertedItems = purchaseOrder.items.map(item => {
        // Ensure we have proper numeric values - parse all amounts
        const quantity = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate) || 0;
        
        // ALWAYS calculate baseAmount from quantity and rate (don't trust stored value if it's 0)
        // This ensures amounts are correct even if PO wasn't saved properly
        const baseAmount = quantity * rate;
        
        // Get tax percentages
        const cgstPercent = parseFloat(item.cgstPercent) || 0;
        const sgstPercent = parseFloat(item.sgstPercent) || 0;
        const igstPercent = parseFloat(item.igstPercent) || 0;
        const isInterState = item.isInterState || false;
        
        // ALWAYS recalculate tax amounts from baseAmount and percentages
        // This ensures taxes are correct
        let cgstAmount = 0;
        let sgstAmount = 0;
        let igstAmount = 0;
        
        if (isInterState && igstPercent > 0) {
          igstAmount = (baseAmount * igstPercent) / 100;
        } else {
          if (cgstPercent > 0) {
            cgstAmount = (baseAmount * cgstPercent) / 100;
          }
          if (sgstPercent > 0) {
            sgstAmount = (baseAmount * sgstPercent) / 100;
          }
        }
        
        // Round tax amounts to 2 decimal places
        cgstAmount = Math.round(cgstAmount * 100) / 100;
        sgstAmount = Math.round(sgstAmount * 100) / 100;
        igstAmount = Math.round(igstAmount * 100) / 100;
        
        // Calculate line tax total
        const lineTaxTotal = cgstAmount + sgstAmount + igstAmount;
        
        // Get discounted amount (if any discount was applied at item level)
        const discountedAmount = parseFloat(item.discountedAmount) || 0;
        
        // Calculate line total (baseAmount + taxes, or discountedAmount + taxes if discount applied)
        const amountForTotal = discountedAmount > 0 ? discountedAmount : baseAmount;
        const lineTotal = amountForTotal + lineTaxTotal;
        
        // Amount field should show baseAmount (quantity * rate)
        const amount = baseAmount;
        
        console.log(`📊 Converting PO item to Bill: ${item.itemName || 'Unknown'}`);
        console.log(`   Quantity: ${quantity}, Rate: ${rate}, BaseAmount: ${baseAmount}`);
        console.log(`   CGST: ${cgstAmount}, SGST: ${sgstAmount}, IGST: ${igstAmount}`);
        console.log(`   LineTaxTotal: ${lineTaxTotal}, LineTotal: ${lineTotal}`);
        
        return {
          itemId: item.itemId,
          itemName: item.itemName,
          itemDescription: item.itemDescription || "",
          account: item.account || "",
          size: item.size || "",
          quantity: quantity,
          rate: rate,
          tax: item.tax || "",
          amount: amount,
          baseAmount: baseAmount,
          discountedAmount: discountedAmount,
          cgstAmount: cgstAmount,
          sgstAmount: sgstAmount,
          igstAmount: igstAmount,
          lineTaxTotal: lineTaxTotal,
          lineTotal: lineTotal,
          taxCode: item.taxCode || "",
          taxPercent: parseFloat(item.taxPercent) || 0,
          cgstPercent: cgstPercent,
          sgstPercent: sgstPercent,
          igstPercent: igstPercent,
          isInterState: isInterState,
          itemGroupId: item.itemGroupId || null,
          itemSku: item.itemSku || "",
        };
      });
    
    // Calculate totals from converted items
    const subTotal = convertedItems.reduce((sum, item) => sum + (item.baseAmount || 0), 0);
    const totalTax = convertedItems.reduce((sum, item) => sum + (item.lineTaxTotal || 0), 0);
    const totalTaxAmount = convertedItems.reduce((sum, item) => {
      return sum + (item.cgstAmount || 0) + (item.sgstAmount || 0) + (item.igstAmount || 0);
    }, 0);
    const discountAmount = parseFloat(purchaseOrder.discountAmount) || 0;
    const tdsTcsAmount = parseFloat(purchaseOrder.tdsTcsAmount) || 0;
    const adjustment = parseFloat(purchaseOrder.adjustment) || 0;
    const finalTotal = subTotal + totalTax - discountAmount - tdsTcsAmount + adjustment;
    
    console.log(`📊 PO to Bill Conversion Totals:`);
    console.log(`   SubTotal: ${subTotal}, TotalTax: ${totalTax}, FinalTotal: ${finalTotal}`);
    
    // Prepare bill data from purchase order
    const billData = {
      vendorId: purchaseOrder.vendorId,
      vendorName: purchaseOrder.vendorName,
      branch: branch || purchaseOrder.branch || "Head Office",
      billNumber: billNumber || `BILL-${purchaseOrder.orderNumber}`,
      orderNumber: purchaseOrder.orderNumber,
      billDate: billDate ? new Date(billDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentTerms: purchaseOrder.paymentTerms || "Net 60",
      subject: `Bill for Purchase Order ${purchaseOrder.orderNumber}`,
      reverseCharge: false,
      taxExclusive: true,
      atTransactionLevel: true,
      sourceOfSupply: "",
      destinationOfSupply: "",
      warehouse: warehouse || "Warehouse",
      items: convertedItems,
      discount: purchaseOrder.discount || { value: "0", type: "%" },
      applyDiscountAfterTax: purchaseOrder.applyDiscountAfterTax || false,
      totalTaxAmount: totalTaxAmount,
      tdsTcsType: purchaseOrder.tdsTcsType || "TDS",
      tdsTcsTax: purchaseOrder.tdsTcsTax || "",
      tdsTcsAmount: tdsTcsAmount,
      adjustment: adjustment,
      subTotal: subTotal,
      discountAmount: discountAmount,
      totalTax: totalTax,
      finalTotal: finalTotal,
      notes: `Converted from Purchase Order ${purchaseOrder.orderNumber}`,
      userId: purchaseOrder.userId,
      locCode: purchaseOrder.locCode || "",
      status: "open", // Default to "open" when converting from PO
      purchaseOrderId: purchaseOrderId,
      sourceType: "from_po",
    };
    
    // Create the bill
    const bill = await Bill.create(billData);
    
    // Process the bill (update vendor balance only, NO stock addition)
    // IMPORTANT: Stock should only be added when Purchase Receive is created
    // PO → Bill conversion does NOT add stock (stock will be added later when Receive is created)
    if (billData.finalTotal > 0) {
      console.log(`📦 Converting PO to Bill - updating vendor balance only (stock will be added when Receive is created)`);
      
      // Update vendor balance only (do NOT add stock)
      if (billData.vendorId) {
        await updateVendorBalance(billData.vendorId, billData.finalTotal, 'add');
        console.log(`✅ Updated vendor balance - increased payables by ${billData.finalTotal}`);
      }
    }
    
    res.status(201).json(bill);
  } catch (error) {
    console.error("Convert purchase order to bill error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Convert Purchase Receive to Bill
export const convertPurchaseReceiveToBill = async (req, res) => {
  try {
    const { purchaseReceiveId } = req.params;
    const { billNumber, billDate, dueDate, branch } = req.body;
    
    // Import PurchaseReceive model
    const PurchaseReceive = (await import("../model/PurchaseReceive.js")).default;
    
    // Get the purchase receive
    const purchaseReceive = await PurchaseReceive.findById(purchaseReceiveId);
    if (!purchaseReceive) {
      return res.status(404).json({ message: "Purchase receive not found" });
    }
    
    // Check if bill already exists for this Receive
    const existingBill = await Bill.findOne({ purchaseReceiveId: purchaseReceiveId });
    if (existingBill) {
      return res.status(409).json({ 
        message: "Bill already exists for this purchase receive",
        billId: existingBill._id 
      });
    }
    
    // Get the purchase order to get item details (rates, taxes, etc.)
    const PurchaseOrder = (await import("../model/PurchaseOrder.js")).default;
    const purchaseOrder = await PurchaseOrder.findById(purchaseReceive.purchaseOrderId);
    
    if (!purchaseOrder) {
      console.error(`❌ Purchase Order not found: ${purchaseReceive.purchaseOrderId}`);
      return res.status(404).json({ message: "Purchase order not found for this receive" });
    }
    
    console.log(`✅ Found Purchase Order: ${purchaseOrder.orderNumber} with ${purchaseOrder.items?.length || 0} items`);
    
    // Create a map of items from PO for rates/taxes
    // Use multiple keys for better matching (itemId, itemName, SKU, itemGroupId)
    const poItemMap = new Map();
    if (purchaseOrder && purchaseOrder.items) {
      purchaseOrder.items.forEach(item => {
        // Add multiple keys for flexible matching
        const itemIdKey = item.itemId?.toString();
        const itemNameKey = item.itemName?.toLowerCase().trim();
        const skuKey = item.itemSku?.toLowerCase().trim();
        const itemGroupIdKey = item.itemGroupId?.toString();
        
        if (itemIdKey) poItemMap.set(itemIdKey, item);
        if (itemNameKey) poItemMap.set(`name:${itemNameKey}`, item);
        if (skuKey) poItemMap.set(`sku:${skuKey}`, item);
        if (itemGroupIdKey && itemNameKey) poItemMap.set(`group:${itemGroupIdKey}:${itemNameKey}`, item);
        
        console.log(`   PO Item: ${item.itemName}, Rate: ${item.rate || 0}, Quantity: ${item.quantity || 0}, ItemId: ${itemIdKey || 'null'}, SKU: ${skuKey || 'none'}`);
      });
    } else {
      console.warn(`⚠️ Purchase Order has no items!`);
    }
    
    // Prepare bill items from purchase receive (use received quantities)
    const billItems = purchaseReceive.items.map(receiveItem => {
      // Try multiple matching strategies
      let poItem = null;
      
      // Strategy 1: Match by itemId
      if (receiveItem.itemId) {
        poItem = poItemMap.get(receiveItem.itemId.toString());
      }
      
      // Strategy 2: Match by itemName (case-insensitive)
      if (!poItem && receiveItem.itemName) {
        poItem = poItemMap.get(`name:${receiveItem.itemName.toLowerCase().trim()}`);
      }
      
      // Strategy 3: Match by SKU
      if (!poItem && receiveItem.itemSku) {
        poItem = poItemMap.get(`sku:${receiveItem.itemSku.toLowerCase().trim()}`);
      }
      
      // Strategy 4: Match by itemGroupId + itemName (for grouped items)
      if (!poItem && receiveItem.itemGroupId && receiveItem.itemName) {
        poItem = poItemMap.get(`group:${receiveItem.itemGroupId.toString()}:${receiveItem.itemName.toLowerCase().trim()}`);
      }
      
      if (!poItem || Object.keys(poItem).length === 0) {
        console.warn(`⚠️ PO item not found for receive item: ${receiveItem.itemName}`);
        console.warn(`   Receive item - ItemId: ${receiveItem.itemId}, ItemName: ${receiveItem.itemName}, SKU: ${receiveItem.itemSku}, GroupId: ${receiveItem.itemGroupId}`);
      }
      
      const receivedQty = parseFloat(receiveItem.received) || 0;
      const rate = parseFloat(poItem?.rate) || 0;
      
      if (rate === 0) {
        console.warn(`⚠️ Rate is 0 for item: ${receiveItem.itemName}`);
        console.warn(`   PO item rate: ${poItem?.rate}, PO item: ${JSON.stringify(poItem ? { name: poItem.itemName, rate: poItem.rate, quantity: poItem.quantity } : 'not found')}`);
      }
      
      // ALWAYS calculate baseAmount from received quantity and rate
      const baseAmount = receivedQty * rate;
      
      // Get tax percentages from PO item (use safe access)
      const cgstPercent = parseFloat(poItem?.cgstPercent) || 0;
      const sgstPercent = parseFloat(poItem?.sgstPercent) || 0;
      const igstPercent = parseFloat(poItem?.igstPercent) || 0;
      const isInterState = poItem?.isInterState || false;
      
      // ALWAYS recalculate tax amounts based on received quantity and baseAmount
      // Don't use PO tax amounts directly as they're based on PO quantity, not received quantity
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;
      
      if (isInterState && igstPercent > 0) {
        igstAmount = (baseAmount * igstPercent) / 100;
      } else {
        if (cgstPercent > 0) {
          cgstAmount = (baseAmount * cgstPercent) / 100;
        }
        if (sgstPercent > 0) {
          sgstAmount = (baseAmount * sgstPercent) / 100;
        }
      }
      
      // Round tax amounts to 2 decimal places
      cgstAmount = Math.round(cgstAmount * 100) / 100;
      sgstAmount = Math.round(sgstAmount * 100) / 100;
      igstAmount = Math.round(igstAmount * 100) / 100;
      
      // Calculate line tax total
      const lineTaxTotal = cgstAmount + sgstAmount + igstAmount;
      
      // Get discounted amount (if any discount was applied at item level in PO)
      const discountedAmount = parseFloat(poItem?.discountedAmount) || 0;
      
      // Calculate line total
      const amountForTotal = discountedAmount > 0 ? discountedAmount : baseAmount;
      const lineTotal = amountForTotal + lineTaxTotal;
      
      console.log(`📊 Converting Receive item to Bill: ${receiveItem.itemName || 'Unknown'}`);
      console.log(`   ReceivedQty: ${receivedQty}, Rate: ${rate}, BaseAmount: ${baseAmount}`);
      console.log(`   CGST: ${cgstAmount}, SGST: ${sgstAmount}, IGST: ${igstAmount}`);
      console.log(`   LineTaxTotal: ${lineTaxTotal}, LineTotal: ${lineTotal}`);
      
      return {
        itemId: receiveItem.itemId,
        itemName: receiveItem.itemName,
        itemDescription: receiveItem.itemDescription || "",
        account: poItem?.account || "",
        size: poItem?.size || "",
        quantity: receivedQty,
        rate: rate,
        tax: poItem?.tax || "",
        amount: baseAmount,
        baseAmount: baseAmount,
        discountedAmount: discountedAmount,
        cgstAmount: cgstAmount,
        sgstAmount: sgstAmount,
        igstAmount: igstAmount,
        lineTaxTotal: lineTaxTotal,
        lineTotal: lineTotal,
        taxCode: poItem?.taxCode || "",
        taxPercent: parseFloat(poItem?.taxPercent) || 0,
        cgstPercent: cgstPercent,
        sgstPercent: sgstPercent,
        igstPercent: igstPercent,
        isInterState: isInterState,
        itemGroupId: receiveItem.itemGroupId || poItem?.itemGroupId || null,
        itemSku: receiveItem.sku || receiveItem.itemSku || poItem?.sku || poItem?.itemSku || "",
        sku: receiveItem.sku || receiveItem.itemSku || poItem?.sku || poItem?.itemSku || "",
        itemCode: receiveItem.itemCode || poItem?.itemCode || "",
      };
    });
    
    // Calculate totals from converted items
    const subTotal = billItems.reduce((sum, item) => sum + (item.baseAmount || 0), 0);
    const totalTax = billItems.reduce((sum, item) => sum + (item.lineTaxTotal || 0), 0);
    const totalTaxAmount = billItems.reduce((sum, item) => {
      return sum + (item.cgstAmount || 0) + (item.sgstAmount || 0) + (item.igstAmount || 0);
    }, 0);
    const discountAmount = parseFloat(purchaseOrder?.discountAmount) || 0;
    const tdsTcsAmount = parseFloat(purchaseOrder?.tdsTcsAmount) || 0;
    const adjustment = parseFloat(purchaseOrder?.adjustment) || 0;
    const finalTotal = subTotal + totalTax - discountAmount - tdsTcsAmount + adjustment;
    
    console.log(`📊 Receive to Bill Conversion Totals:`);
    console.log(`   SubTotal: ${subTotal}, TotalTax: ${totalTax}, FinalTotal: ${finalTotal}`);
    
    // Prepare bill data
    const billData = {
      vendorId: purchaseReceive.vendorId,
      vendorName: purchaseReceive.vendorName,
      branch: branch || "Head Office",
      billNumber: billNumber || `BILL-${purchaseReceive.receiveNumber}`,
      orderNumber: purchaseReceive.purchaseOrderNumber,
      billDate: billDate ? new Date(billDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentTerms: "Net 60",
      subject: `Bill for Purchase Receive ${purchaseReceive.receiveNumber}`,
      reverseCharge: false,
      taxExclusive: true,
      atTransactionLevel: true,
      sourceOfSupply: "",
      destinationOfSupply: "",
      warehouse: "Warehouse", // Use default since stock was already added at Receive
      items: billItems,
      discount: purchaseOrder?.discount || { value: "0", type: "%" },
      applyDiscountAfterTax: purchaseOrder?.applyDiscountAfterTax || false,
      totalTaxAmount: totalTaxAmount,
      tdsTcsType: purchaseOrder?.tdsTcsType || "TDS",
      tdsTcsTax: purchaseOrder?.tdsTcsTax || "",
      tdsTcsAmount: tdsTcsAmount,
      adjustment: adjustment,
      subTotal: subTotal,
      discountAmount: discountAmount,
      totalTax: totalTax,
      finalTotal: finalTotal,
      notes: `Converted from Purchase Receive ${purchaseReceive.receiveNumber}`,
      userId: purchaseReceive.userId,
      locCode: purchaseReceive.locCode || "",
      status: "open", // Default to "open"
      purchaseOrderId: purchaseReceive.purchaseOrderId,
      purchaseReceiveId: purchaseReceiveId,
      sourceType: "from_receive",
    };
    
    // Create the bill
    const bill = await Bill.create(billData);
    
    // IMPORTANT: For PO → Receive → Bill workflow:
    // Stock was already added when Purchase Receive was created
    // So we should NOT add stock again here
    // Only update vendor balance
    
    if (billData.finalTotal > 0) {
      // Update vendor balance only (stock already handled at Receive stage)
      if (billData.vendorId) {
        await updateVendorBalance(billData.vendorId, billData.finalTotal, 'add');
        console.log(`✅ Converted Receive to Bill - updated vendor balance only (stock already added at Receive)`);
      }
    }
    
    res.status(201).json(bill);
  } catch (error) {
    console.error("Convert purchase receive to bill error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Resync stock for all items in a bill (useful to repair stock when multi-row items were under-counted)
// Re-apply the stock of a bill whose stock was NOT added (e.g. a failure during save).
// It never "tops up" to the bill quantity any more — that re-created pieces that had already been sold.
export const resyncBillStock = async (req, res) => {
  try {
    const { id } = req.params;
    const bill = await Bill.findById(id);
    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }
    if ((bill.sourceType || "direct") !== "direct") {
      return res.status(400).json({ success: false, message: "Only direct bills manage stock. Stock for this bill comes from its Purchase Receive." });
    }
    if (bill.status !== "open" && bill.status !== "completed") {
      return res.status(400).json({ success: false, message: "Only open/completed bills add stock." });
    }
    if (bill.stockApplied !== false) {
      return res.status(409).json({
        success: false,
        message: bill.stockApplied === true
          ? "This bill is already counted in stock."
          : "This is an older bill — it cannot be known whether its stock was added. Use an inventory adjustment to correct stock.",
      });
    }
    const warehouseName = bill.warehouse?.trim() || "Warehouse";
    const lines = (bill.items || []).map((it) => ({
      itemId: it.itemId,
      itemGroupId: it.itemGroupId,
      itemSku: it.itemSku || it.sku,
      itemName: it.itemName ? extractVendorInfo(it.itemName).baseName : it.itemName,
      quantity: it.quantity,
    }));
    const applied = await applyLines(lines, warehouseName, 1);
    await Bill.updateOne({ _id: bill._id }, { $set: { stockApplied: true, warehouse: warehouseName } });
    return res.status(200).json({
      success: true,
      message: `Stock added for ${applied.length} items in ${warehouseName}.`,
      results: applied.map((m) => ({ item: m.target.name, added: m.delta })),
    });
  } catch (err) {
    console.error("Resync bill stock error:", err);
    return res.status(err instanceof StockError ? 409 : 500).json({ success: false, message: err.message });
  }
};
