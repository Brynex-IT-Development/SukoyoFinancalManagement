import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import * as ui from "../components/docDetailStyles";
import { Star, Warehouse, ChevronDown, Plus, Copy, Pause, Trash2, ArrowUpRight, XCircle, ArrowLeft, MoreHorizontal, Pencil, Package, ShoppingCart, Box } from "lucide-react";
import { mapLocNameToWarehouse as mapWarehouse } from "../utils/warehouseMapping";
import AttachmentDisplay from "../components/AttachmentDisplay";
import baseUrl from "../api/api";
import useSidebar from "../hooks/useSidebar";
import VendorBreakdown from "../components/VendorBreakdown.jsx";
import ItemStockManagement from "./ItemStockManagement.jsx";
import { getActiveStores, isAllowedStoreNameOrCode } from "../utils/storeService.js";

// Warehouse name mapping: actual names from API -> display names for Stocks page
const WAREHOUSE_NAME_MAPPING = {
  // Actual API names -> Display names
  "G.Palakkad": "Palakkad Branch",
  "G-Palakkad": "Palakkad Branch",
  "G.Palakkad ": "Palakkad Branch",
  "GPalakkad": "Palakkad Branch",
  "Palakkad Branch": "Palakkad Branch",
  "Warehouse": "Warehouse",
  "G.Calicut": "Calicut",
  "G-Calicut": "Calicut",
  "G.Calicut ": "Calicut",
  "GCalicut": "Calicut",
  "Calicut": "Calicut",
  "G.Manjeri": "Manjery Branch",
  "G-Manjeri": "Manjery Branch",
  "G.Manjery": "Manjery Branch",
  "G-Manjery": "Manjery Branch",
  "GManjeri": "Manjery Branch",
  "GManjery": "Manjery Branch",
  "Manjery Branch": "Manjery Branch",
  "G.Kannur": "Kannur Branch",
  "G-Kannur": "Kannur Branch",
  "GKannur": "Kannur Branch",
  "Kannur Branch": "Kannur Branch",
  "G.Edappal": "Edappal Branch",
  "G-Edappal": "Edappal Branch",
  "GEdappal": "Edappal Branch",
  "Edappal Branch": "Edappal Branch",
  "G.Kalpetta": "Kalpetta Branch",
  "G-Kalpetta": "Kalpetta Branch",
  "GKalpetta": "Kalpetta Branch",
  "Kalpetta Branch": "Kalpetta Branch",
  "G.Kottakkal": "Kottakkal Branch",
  "G-Kottakkal": "Kottakkal Branch",
  "GKottakkal": "Kottakkal Branch",
  "Kottakkal Branch": "Kottakkal Branch",
  "Z.Kottakkal": "Kottakkal Branch",
  "Z-Kottakkal": "Kottakkal Branch",
  "G.Perinthalmanna": "Perinthalmanna Branch",
  "G-Perinthalmanna": "Perinthalmanna Branch",
  "GPerinthalmanna": "Perinthalmanna Branch",
  "Perinthalmanna Branch": "Perinthalmanna Branch",
  "Z.Perinthalmanna": "Perinthalmanna Branch",
  "Z-Perinthalmanna": "Perinthalmanna Branch",
  // Trivandrum variations - fix typo and add correct mapping
  "Grooms Trivandum": "Grooms Trivandrum",
  "Grooms Trivandrum": "Grooms Trivandrum",
  "SG-Trivandrum": "Grooms Trivandrum",
  "SG.Trivandrum": "Grooms Trivandrum",
  "G.Chavakkad": "Chavakkad Branch",
  "G-Chavakkad": "Chavakkad Branch",
  "GChavakkad": "Chavakkad Branch",
  "Chavakkad Branch": "Chavakkad Branch",
  "G.Thrissur": "Thrissur Branch",
  "G-Thrissur": "Thrissur Branch",
  "GThrissur": "Thrissur Branch",
  "Thrissur Branch": "Thrissur Branch",
  "G.Perumbavoor": "Perumbavoor Branch",
  "G-Perumbavoor": "Perumbavoor Branch",
  "GPerumbavoor": "Perumbavoor Branch",
  "Perumbavoor Branch": "Perumbavoor Branch",
  "G.Kottayam": "Kottayam Branch",
  "G-Kottayam": "Kottayam Branch",
  "GKottayam": "Kottayam Branch",
  "Kottayam Branch": "Kottayam Branch",
  "G.Edappally": "Edapally Branch",
  "G-Edappally": "Edapally Branch",
  "GEdappally": "Edapally Branch",
  "Edapally Branch": "Edapally Branch",
  "Edapallyadmin Branch": "Edapally Branch",
  "Edapallyadmin": "Edapally Branch",
  "Z-Edapally1": "Edapally Branch",
  "Z-Edapally1 Branch": "Edapally Branch",
  "-Edapally1 Branch": "Edapally Branch",
  "-Edapally1": "Edapally Branch",
  "G.MG Road": "MG Road",
  "G-MG Road": "MG Road",
  "G.Mg Road": "MG Road",
  "G-Mg Road": "MG Road",
  "GMG Road": "MG Road",
  "GMg Road": "MG Road",
  "MG Road": "MG Road",
  "SuitorGuy MG Road": "MG Road",
  // Vadakara variations
  "G.Vadakara": "Vadakara Branch",
  "GVadakara": "Vadakara Branch",
  "Vadakara Branch": "Vadakara Branch"
};

// Display names for the Stocks page (what users see) - restricted to active stores
const getAllowedWarehousesDisplay = () => {
  const stores = getActiveStores();
  return stores && stores.length > 0 ? stores.map(s => s.locName) : ["Warehouse"];
};

// Get all possible actual warehouse names that map to allowed warehouses
const getAllowedActualNames = () => {
  const allowed = getAllowedWarehousesDisplay();
  const actualNames = new Set();
  Object.keys(WAREHOUSE_NAME_MAPPING).forEach(actualName => {
    if (allowed.includes(WAREHOUSE_NAME_MAPPING[actualName])) {
      actualNames.add(actualName);
    }
  });
  return Array.from(actualNames);
};

// Helper function to normalize warehouse name to display name
const normalizeWarehouseName = (warehouseName) => {
  if (!warehouseName) return null;
  const trimmed = warehouseName.toString().trim();
  
  // Check exact match first
  if (WAREHOUSE_NAME_MAPPING[trimmed]) {
    return WAREHOUSE_NAME_MAPPING[trimmed];
  }
  
  // Check case-insensitive match
  const lowerName = trimmed.toLowerCase();
  for (const [key, value] of Object.entries(WAREHOUSE_NAME_MAPPING)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  
  // If it's an allowed store name (Warehouse, MG Road, or newly added store)
  if (isAllowedStoreNameOrCode("", trimmed)) {
    return trimmed;
  }
  
  return null;
};

const formatCurrency = (value) => {
  if (!value && value !== 0) return "—";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return value;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(numberValue);
};

const ShoeSalesItemDetailFromGroup = () => {
  const isSidebarOpen = useSidebar();
  const ALLOWED_WAREHOUSES_DISPLAY = getAllowedWarehousesDisplay();
  const { id, itemId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [itemGroup, setItemGroup] = useState(null);
  const [item, setItem] = useState(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [showStockModal, setShowStockModal] = useState(false);
  const [stockType, setStockType] = useState("accounting"); // "accounting" or "physical"
  const [showInactiveWarehouses, setShowInactiveWarehouses] = useState(false);
  const [warehouseStocks, setWarehouseStocks] = useState([]);
  const [allWarehouses, setAllWarehouses] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showInactiveModal, setShowInactiveModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allItemGroups, setAllItemGroups] = useState([]);
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const moreMenuRef = useRef(null);

  // Fetch all warehouses from account settings and filter to only allowed ones
  const fetchAllWarehouses = useCallback(async () => {
    // Always use the display names for the Stocks page
    const sortedWarehouses = [...ALLOWED_WAREHOUSES_DISPLAY].sort((a, b) => {
      if (a === "Warehouse") return -1;
      if (b === "Warehouse") return 1;
      return a.localeCompare(b);
    });
    setAllWarehouses(sortedWarehouses);
  }, []);

  const fetchData = useCallback(async () => {
    if (!id || !itemId) return;
    
      try {
        const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
        const response = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`);
        
        if (!response.ok) {
          throw new Error("Failed to fetch item group");
        }
        
        const data = await response.json();
        setItemGroup(data);
        
        // Find the specific item
        if (data.items && Array.isArray(data.items)) {
          const foundItem = data.items.find(i => (i._id || i.id) === itemId);
          if (foundItem) {
            console.log("📦 Item detail: Found item:", foundItem.name);
            console.log("📦 Item detail: Item warehouseStocks:", foundItem.warehouseStocks);
            if (foundItem.warehouseStocks && Array.isArray(foundItem.warehouseStocks)) {
              foundItem.warehouseStocks.forEach(ws => {
                console.log(`   - Warehouse: "${ws.warehouse}", Stock: ${ws.stockOnHand || 0}`);
              });
            }
            setItem(foundItem);
          } else {
            console.warn("📦 Item detail: Item not found in group items");
          }
        }
      } catch (error) {
        console.error("Error fetching item:", error);
        setItemGroup(null);
        setItem(null);
      }
  }, [id, itemId]);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    if (!id || !itemId) {
      console.log("Missing id or itemId for history fetch:", { id, itemId });
      return;
    }
    
    try {
      setLoadingHistory(true);
      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      const url = `${API_URL}/api/shoe-sales/item-groups/${id}/items/${itemId}/history`;
      console.log("Fetching history from:", url);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to fetch history:", response.status, errorText);
        throw new Error("Failed to fetch history");
      }
      
      let data = await response.json();
      console.log("History data received:", data);
      
      // Ensure we have an array
      const historyArray = Array.isArray(data) ? data : [];
      
      // Check if we have a CREATE entry, if not and item exists, add one
      const hasCreateEntry = historyArray.some(entry => entry.changeType === "CREATE");
      if (!hasCreateEntry && item && (item.createdAt || itemGroup?.createdAt)) {
        // Add creation entry from item's or group's createdAt
        const createdAt = item.createdAt ? new Date(item.createdAt) : (itemGroup?.createdAt ? new Date(itemGroup.createdAt) : new Date());
        // Try to get createdBy from item, itemGroup, or history entries, or get current user, or use "System"
        let createdBy = item.createdBy || itemGroup?.changedBy || itemGroup?.createdBy;
        if (!createdBy) {
          // Try to get from history entries if available
          const createHistoryEntry = historyArray.find(entry => entry.changeType === "CREATE");
          if (createHistoryEntry && createHistoryEntry.changedBy) {
            createdBy = createHistoryEntry.changedBy;
          } else {
            // Get current user as fallback
            const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
            createdBy = currentUser.username || currentUser.locName || "System";
          }
        }
        const createEntry = {
          itemId: itemId.toString(),
          itemGroupId: id,
          changeType: "CREATE",
          details: "created",
          changedBy: createdBy,
          changedAt: createdAt,
          createdAt: createdAt,
          oldData: null,
          newData: item,
        };
        // Add at the end (will be sorted by changedAt)
        historyArray.push(createEntry);
      }
      
      // Sort by changedAt descending (most recent first)
      historyArray.sort((a, b) => {
        const dateA = new Date(a.changedAt || a.createdAt || 0);
        const dateB = new Date(b.changedAt || b.createdAt || 0);
        return dateB - dateA;
      });
      
      setHistory(historyArray);
    } catch (error) {
      console.error("Error fetching history:", error);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [id, itemId, item, itemGroup]);

  // Fetch all item groups for the move modal
  const fetchAllItemGroups = useCallback(async () => {
    try {
      setLoadingGroups(true);
      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      const response = await fetch(`${API_URL}/api/shoe-sales/item-groups`);
      
      if (!response.ok) {
        throw new Error("Failed to fetch item groups");
      }
      
      const data = await response.json();
      // Filter out the current group and only show active groups
      const filteredGroups = data.filter(group => {
        const groupIdStr = (group._id || group.id || "").toString();
        return groupIdStr !== id.toString() && (group.isActive !== false);
      });
      
      setAllItemGroups(filteredGroups);
    } catch (error) {
      console.error("Error fetching item groups:", error);
      alert("Failed to load item groups. Please try again.");
    } finally {
      setLoadingGroups(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    fetchAllWarehouses();
  }, [fetchData, fetchAllWarehouses]);

  useEffect(() => {
    if (activeTab === "History") {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  // Fetch groups when move modal opens
  useEffect(() => {
    if (showMoveModal) {
      fetchAllItemGroups();
      setSelectedTargetGroupId("");
    }
  }, [showMoveModal, fetchAllItemGroups]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setShowMoreMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Get user info for filtering
  const userStr = localStorage.getItem("rootfinuser");
  const user = userStr ? JSON.parse(userStr) : null;
  // User is admin if: power === 'admin' OR locCode === '858' (Warehouse) OR locCode === '103' (WAREHOUSE) OR email === 'officerootments@gmail.com'
  const userEmail = user?.email || user?.username || "";
  const adminEmails = ['officerootments@gmail.com'];
  const isAdminEmail = userEmail && adminEmails.some(email => userEmail.toLowerCase() === email.toLowerCase());
  const isAdmin = isAdminEmail ||
                  user?.power === "admin" || 
                  (user?.locCode && (user.locCode === '858' || user.locCode === '103'));
  
  // Fallback locations mapping (same as other pages)
  const fallbackLocations = getActiveStores();
  
  // Get location name - prioritize locCode lookup over username
  let userLocName = "";
  if (user?.locCode) {
    const location = fallbackLocations.find(loc => loc.locCode === user.locCode || loc.locCode === String(user.locCode));
    if (location) {
      userLocName = location.locName;
      console.log(`Item Detail: Found location by locCode ${user.locCode}: "${location.locName}"`);
    }
  }
  // Fallback to username/locName if locCode lookup didn't work
  if (!userLocName) {
    userLocName = user?.username || user?.locName || "";
    console.log(`Item Detail: Using username/locName fallback: "${userLocName}"`);
  }
  
  // Use the shared warehouse mapping utility
  const mapLocNameToWarehouse = (locName) => {
    if (!locName) return "";
    return mapWarehouse(locName);
  };
  
  const userWarehouse = mapLocNameToWarehouse(userLocName);
  console.log(`Item Detail: Mapped warehouse: "${userWarehouse}" (from locName: "${userLocName}")`);
  
  // Every location this item has a stock record for.
  // Admins (incl. anyone signed in at the Warehouse) see all locations;
  // store users see only their own store. Names are tidied for display only,
  // and no location is hidden because of an old/retired store-name list.
  useEffect(() => {
    const raw = Array.isArray(item?.warehouseStocks) ? item.warehouseStocks : [];
    const byName = new Map();
    raw.forEach((stock) => {
      if (!stock?.warehouse) return;
      const name = (WAREHOUSE_NAME_MAPPING[stock.warehouse.trim()] || stock.warehouse).toString().trim();
      const prev = byName.get(name);
      if (!prev) {
        byName.set(name, { ...stock, warehouse: name });
      } else {
        // Same store saved under two spellings: add the quantities together.
        const add = (k) => (parseFloat(prev[k]) || 0) + (parseFloat(stock[k]) || 0);
        byName.set(name, { ...prev, stockOnHand: add("stockOnHand"), availableForSale: add("availableForSale"), committedStock: add("committedStock"), openingStock: add("openingStock") });
      }
    });

    let list = [...byName.values()];
    if (!isAdmin && userWarehouse) {
      const mine = userWarehouse.toLowerCase();
      list = list.filter((s) => {
        const n = s.warehouse.toLowerCase();
        return n === mine || n.includes(mine) || mine.includes(n);
      });
    }
    list.sort((x, y) => (x.warehouse === "Warehouse" ? -1 : y.warehouse === "Warehouse" ? 1 : x.warehouse.localeCompare(y.warehouse)));
    setWarehouseStocks(list);
  }, [allWarehouses, item, isAdmin, userWarehouse]);

  // Check if returning from stock management page and refresh data
  useEffect(() => {
    const stocksUpdated = searchParams.get('stocksUpdated');
    const message = searchParams.get('message');
    
    if (stocksUpdated === 'true') {
      // (No blocking alert: the Stocks tab refreshes with the new numbers.)
      // Switch to Stocks tab
      setActiveTab("Stocks");
      // Refresh data
      fetchData();
      // Remove the query parameters after data is refreshed
      setTimeout(() => {
        setSearchParams({}, { replace: true });
      }, 100);
    }
  }, [searchParams, setSearchParams, fetchData]);

  // Listen for stock updates from purchase receive, bills, transfer orders, etc.
  useEffect(() => {
    const handleStockUpdated = (event) => {
      console.log("📦 Stock updated event received, refreshing item data...", event.detail);
      
      // Check if this item was affected by the stock update
      const updatedItems = event.detail?.items || event.detail?.updatedItems || [];
      const itemIds = event.detail?.itemIds || [];
      
      // Check if current item is in the updated items
      const isItemAffected = updatedItems.some(updatedItem => {
        const updatedItemId = updatedItem.itemId?._id || updatedItem.itemId || updatedItem.itemIdValue;
        const updatedItemGroupId = updatedItem.itemGroupId || updatedItem.itemGroupIdValue;
        const updatedItemName = updatedItem.itemName || updatedItem.name;
        const updatedItemSku = updatedItem.itemSku || updatedItem.sku;
        
        // Match by itemGroupId - if group ID matches, always refresh (any item in group might have been updated)
        if (id && updatedItemGroupId) {
          const groupIdMatch = id.toString() === updatedItemGroupId.toString();
          if (groupIdMatch) {
            // If we have a specific item, also check if name/SKU matches (more precise)
            if (item && item.name) {
              const nameMatch = item.name === updatedItemName || item.sku === updatedItemSku;
              if (nameMatch) {
                console.log(`✅ Group ID and item name match - refreshing`);
                return true;
              }
            } else {
              // Group ID matches but no specific item loaded - refresh anyway (group stock changed)
              console.log(`✅ Group ID matches - refreshing (group stock may have changed)`);
              return true;
            }
          }
        }
        
        // Match by itemId (for standalone items)
        if (itemId && updatedItemId) {
          if (itemId.toString() === updatedItemId.toString()) {
            console.log(`✅ Item ID matches - refreshing`);
            return true;
          }
        }
        
        // Match by itemIds array
        if (itemId && itemIds.includes(itemId.toString())) {
          console.log(`✅ Item ID in array matches - refreshing`);
          return true;
        }
        
        return false;
      });
      
      // If item is affected or no specific items specified (global update), refresh
      if (isItemAffected || updatedItems.length === 0) {
        console.log("✅ Item is affected by stock update, refreshing...");
        fetchData();
        fetchAllWarehouses(); // Also refresh warehouses to get latest stock
      } else {
        console.log("ℹ️ Stock updated but this item was not affected");
      }
    };
    
    // Listen for stockUpdated event
    window.addEventListener("stockUpdated", handleStockUpdated);
    
    // Also listen for receiveSaved event (purchase receive)
    // Always refresh when purchase receive is saved, as stock might have been updated
    const handleReceiveSaved = () => {
      console.log("📦 Purchase receive saved, refreshing item data...");
      // Small delay to ensure database has been updated
      setTimeout(() => {
        console.log("🔄 Refreshing after purchase receive saved...");
        fetchData();
        fetchAllWarehouses();
      }, 1000); // Increased delay to ensure backend has finished updating
    };
    window.addEventListener("receiveSaved", handleReceiveSaved);
    
    // Listen for transferOrderReceived event
    const handleTransferOrderReceived = (event) => {
      console.log("📦 Transfer order received, refreshing item data...", event.detail);
      // Check if this warehouse is affected
      const destinationWarehouse = event.detail?.destinationWarehouse;
      if (destinationWarehouse && userWarehouse) {
        const destLower = destinationWarehouse.toLowerCase();
        const userWhLower = userWarehouse.toLowerCase();
        if (destLower === userWhLower || destLower.includes(userWhLower) || userWhLower.includes(destLower)) {
          console.log("✅ Transfer order affects this warehouse, refreshing...");
          fetchData();
          fetchAllWarehouses();
        }
      } else {
        // If no specific warehouse, refresh anyway
        fetchData();
        fetchAllWarehouses();
      }
    };
    window.addEventListener("transferOrderReceived", handleTransferOrderReceived);
    
    // Also refresh when page becomes visible (user navigated back)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("📦 Page became visible, refreshing item data...");
        // Small delay to ensure any pending updates are complete
        setTimeout(() => {
          fetchData();
          fetchAllWarehouses();
        }, 500);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      window.removeEventListener("stockUpdated", handleStockUpdated);
      window.removeEventListener("receiveSaved", handleReceiveSaved);
      window.removeEventListener("transferOrderReceived", handleTransferOrderReceived);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchData, fetchAllWarehouses, id, itemId, item, userWarehouse]);

  // Calculate stock totals
  const stockTotals = useMemo(() => {
    console.log("📊 Calculating stock totals from warehouseStocks:", warehouseStocks);
    console.log("📊 Current item:", item ? { name: item.name, stock: item.stock } : null);
    console.log("📊 isAdmin:", isAdmin);
    
    const totals = {
      accounting: {
        openingStock: 0,
        stockOnHand: 0,
        availableForSale: 0,
      },
      physical: {
        openingStock: 0,
        stockOnHand: 0,
        availableForSale: 0,
      },
    };
    
    if (warehouseStocks && Array.isArray(warehouseStocks)) {
      warehouseStocks.forEach(stock => {
        console.log(`   Processing warehouse: "${stock.warehouse}", stockOnHand: ${stock.stockOnHand || 0}`);
        const opening = parseFloat(stock.openingStock || 0);
        // Don't fallback to opening if stockOnHand is 0 - 0 is a valid value!
        const onHand = stock.stockOnHand !== undefined && stock.stockOnHand !== null
          ? parseFloat(stock.stockOnHand)
          : parseFloat(stock.openingStock || 0);
        const available = stock.availableForSale !== undefined && stock.availableForSale !== null
          ? parseFloat(stock.availableForSale)
          : parseFloat(onHand);
        
        totals.accounting.openingStock += opening;
        totals.accounting.stockOnHand += onHand;
        totals.accounting.availableForSale += available;

        // Physical totals read from dedicated fields when present
        const pOpening = parseFloat(stock.physicalOpeningStock || 0);
        // Don't fallback to pOpening if physicalStockOnHand is 0 - 0 is a valid value!
        const pOnHand = stock.physicalStockOnHand !== undefined && stock.physicalStockOnHand !== null 
          ? parseFloat(stock.physicalStockOnHand) 
          : parseFloat(pOpening || 0);
        const pAvailable = stock.physicalAvailableForSale !== undefined && stock.physicalAvailableForSale !== null
          ? parseFloat(stock.physicalAvailableForSale)
          : parseFloat(pOnHand || 0);
        totals.physical.openingStock += isNaN(pOpening) ? 0 : pOpening;
        totals.physical.stockOnHand += isNaN(pOnHand) ? 0 : pOnHand;
        totals.physical.availableForSale += isNaN(pAvailable) ? 0 : pAvailable;
      });
    }
    
    console.log("📊 Calculated totals BEFORE fallback:", totals);
    
    // Fallback to item.stock if no warehouse stocks - but NOT for store users who should only see their warehouse
    if (totals.accounting.stockOnHand === 0 && typeof item?.stock === 'number' && isAdmin) {
      console.log("📊 Using fallback item.stock (admin only):", item.stock);
      totals.accounting.stockOnHand = item.stock;
      totals.accounting.openingStock = item.stock;
      totals.accounting.availableForSale = item.stock;
    } else if (!isAdmin) {
      console.log("📊 Store user - not using fallback item.stock, showing warehouse-specific totals");
    }
    
    console.log("📊 Final calculated totals:", totals);
    
    // Physical totals are independent; rely only on physical fields
    return totals;
  }, [warehouseStocks, item, isAdmin]);

  if (!itemGroup || !item) {
    return (
      <div className={`transition-all duration-300 flex min-h-screen items-center justify-center bg-[#f5f7fb] p-6 ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-[#1f2937]">We couldn&apos;t find the item.</h2>
          <p className="mt-2 text-sm text-[#6b7280]">Please try again or go back to the item group.</p>
          <button
            onClick={() => navigate(`/shoe-sales/item-groups/${id}`)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#15171D] px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
          >
            <ArrowLeft size={16} />
            Back to Item Group
          </button>
        </div>
      </div>
    );
  }

  // Extract attribute values from item name or attributeCombination
  const getAttributeValue = (attributeName) => {
    if (item.attributeCombination && Array.isArray(item.attributeCombination)) {
      // Try to match attribute name with the combination
      if (itemGroup.attributeRows && Array.isArray(itemGroup.attributeRows)) {
        const attrRow = itemGroup.attributeRows.find(row => 
          row.attribute && row.attribute.toLowerCase() === attributeName.toLowerCase()
        );
        if (attrRow) {
          const index = itemGroup.attributeRows.indexOf(attrRow);
          return item.attributeCombination[index] || "";
        }
      }
    }
    return "";
  };

  // Handler functions for More menu options
  const handleCloneItem = async () => {
    try {
      setLoading(true);
      setShowMoreMenu(false);
      
      if (!itemGroup || !item) {
        alert("Item data not available.");
        return;
      }

      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      
      // Create a copy of the item with a new name
      const clonedItem = {
        ...item,
        name: `${item.name} (Copy)`,
        sku: item.sku ? `${item.sku}-COPY` : "",
        _id: undefined, // Remove _id so it creates a new item
        id: undefined,
      };

      // Add the cloned item to the group
      const updatedItems = [...(itemGroup.items || []), clonedItem];
      
      const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
      const changedBy = currentUser.username || currentUser.locName || "System";

      const updatePayload = {
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
        changedBy: changedBy,
      };

      const response = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!response.ok) {
        throw new Error("Failed to clone item");
      }

      alert("Item cloned successfully!");
      // Refresh the page to show the new item
      window.location.reload();
    } catch (error) {
      console.error("Error cloning item:", error);
      alert("Failed to clone item. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsInactive = async () => {
    try {
      setLoading(true);
      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      
      if (!itemGroup || !item) {
        alert("Item data not available.");
        return;
      }

      // Mark the item as inactive instead of removing it
      const updatedItems = itemGroup.items.map(i => {
        const itemIdStr = (i._id?.toString() || i.id || "").toString();
        if (itemIdStr === itemId.toString()) {
          return {
            ...i,
            isActive: false
          };
        }
        return i;
      });

      const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
      const changedBy = currentUser.username || currentUser.locName || "System";

      const updatePayload = {
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
        changedBy: changedBy,
      };

      const response = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!response.ok) {
        throw new Error("Failed to mark item as inactive");
      }

      setShowInactiveModal(false);
      alert("Item has been marked as inactive.");
      navigate(`/shoe-sales/inactive-items`);
    } catch (error) {
      console.error("Error marking item as inactive:", error);
      alert("Failed to mark item as inactive. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setLoading(true);
      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      
      if (!itemGroup || !item) {
        alert("Item data not available.");
        return;
      }

      // Remove the item from the items array
      const updatedItems = itemGroup.items.filter(i => {
        const itemIdStr = (i._id?.toString() || i.id || "").toString();
        return itemIdStr !== itemId.toString();
      });

      const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
      const changedBy = currentUser.username || currentUser.locName || "System";

      const updatePayload = {
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
        itemId: itemId,
        changedBy: changedBy,
      };

      const response = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!response.ok) {
        throw new Error("Failed to delete item");
      }

      setShowDeleteModal(false);
      alert("Item deleted successfully.");
      navigate(`/shoe-sales/item-groups/${id}`);
    } catch (error) {
      console.error("Error deleting item:", error);
      alert("Failed to delete item. Please try again.");
    } finally {
      setLoading(false);
    }
  };


  const handleMoveToGroup = async () => {
    if (!selectedTargetGroupId) {
      alert("Please select a target group.");
      return;
    }

    if (!itemGroup || !item) {
      alert("Item data not available.");
      return;
    }

    try {
      setLoading(true);
      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      
      // Fetch the target group
      const targetGroupResponse = await fetch(`${API_URL}/api/shoe-sales/item-groups/${selectedTargetGroupId}`);
      if (!targetGroupResponse.ok) {
        throw new Error("Failed to fetch target group");
      }
      const targetGroup = await targetGroupResponse.json();

      // Prepare the item to move (preserve all properties)
      const itemToMove = {
        ...item,
        _id: undefined, // Remove _id so it gets a new one in the target group
        id: undefined,
      };

      const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
      const changedBy = currentUser.username || currentUser.locName || "System";

      // Remove item from current group
      const updatedCurrentGroupItems = itemGroup.items.filter(i => {
        const itemIdStr = (i._id?.toString() || i.id || "").toString();
        return itemIdStr !== itemId.toString();
      });

      const currentGroupPayload = {
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
        items: updatedCurrentGroupItems,
        stock: itemGroup.stock || 0,
        reorder: itemGroup.reorder || "",
        isActive: itemGroup.isActive !== undefined ? itemGroup.isActive : true,
        itemId: itemId,
        changedBy: changedBy,
      };

      // Add item to target group
      const updatedTargetGroupItems = [...(targetGroup.items || []), itemToMove];

      const targetGroupPayload = {
        name: targetGroup.name,
        sku: targetGroup.sku || "",
        itemType: targetGroup.itemType || "goods",
        unit: targetGroup.unit || "",
        manufacturer: targetGroup.manufacturer || "",
        brand: targetGroup.brand || "",
        taxPreference: targetGroup.taxPreference || "taxable",
        intraStateTaxRate: targetGroup.intraStateTaxRate || "",
        interStateTaxRate: targetGroup.interStateTaxRate || "",
        inventoryValuationMethod: targetGroup.inventoryValuationMethod || "",
        createAttributes: targetGroup.createAttributes !== undefined ? targetGroup.createAttributes : true,
        attributeRows: targetGroup.attributeRows || [],
        sellable: targetGroup.sellable !== undefined ? targetGroup.sellable : true,
        purchasable: targetGroup.purchasable !== undefined ? targetGroup.purchasable : true,
        trackInventory: targetGroup.trackInventory !== undefined ? targetGroup.trackInventory : false,
        items: updatedTargetGroupItems,
        stock: targetGroup.stock || 0,
        reorder: targetGroup.reorder || "",
        isActive: targetGroup.isActive !== undefined ? targetGroup.isActive : true,
        changedBy: changedBy,
      };

      // Update both groups
      const [currentGroupResponse, targetGroupResponse2] = await Promise.all([
        fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(currentGroupPayload),
        }),
        fetch(`${API_URL}/api/shoe-sales/item-groups/${selectedTargetGroupId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetGroupPayload),
        }),
      ]);

      if (!currentGroupResponse.ok || !targetGroupResponse2.ok) {
        throw new Error("Failed to move item");
      }

      setShowMoveModal(false);
      alert(`Item "${item.name}" has been moved successfully!`);
      navigate(`/shoe-sales/item-groups/${selectedTargetGroupId}`);
    } catch (error) {
      console.error("Error moving item:", error);
      alert("Failed to move item. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`transition-all duration-300 min-h-screen bg-[#f4f5f3] p-4 sm:p-6 ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
      <main className="space-y-6">
        {showStockModal && (
          <ItemStockManagement modal groupId={id} itemId={itemId} onClose={() => setShowStockModal(false)} />
        )}
        {/* Top Navigation */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => navigate(`/shoe-sales/item-groups/${id}`)}
            className={`${ui.btnOutline} h-10 px-4 text-sm`}
          >
            <ArrowLeft size={15} /> Back to Item Group
          </button>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Link
                  to={`/shoe-sales/item-groups/${id}/items/${itemId}/edit${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}
                  className={`${ui.btnPrimary} h-10 px-4 text-sm`}
                >
                  <Pencil size={14} />
                  Edit
                </Link>
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className={`${ui.btnOutline} h-10 w-10 px-0 ${showMoreMenu ? "border-[#15171D]" : ""}`}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-200 bg-white shadow-xl z-50 overflow-hidden py-1">
                      <button
                        onClick={handleCloneItem}
                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#1f2937] hover:bg-[#f8fafc] transition-colors flex items-center gap-2.5"
                      >
                        <Copy size={16} className="text-[#64748b]" />
                        Clone Item
                      </button>
                      <div className="h-px bg-[#e7ebf8]"></div>
                      <button
                        onClick={() => { setShowInactiveModal(true); setShowMoreMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#1f2937] hover:bg-[#f8fafc] transition-colors flex items-center gap-2.5"
                      >
                        <Pause size={16} className="text-[#64748b]" />
                        Mark as Inactive
                      </button>
                      <button
                        onClick={() => { setShowMoveModal(true); setShowMoreMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#1f2937] hover:bg-[#f8fafc] transition-colors flex items-center gap-2.5"
                      >
                        <ArrowUpRight size={16} className="text-[#64748b]" />
                        Move to another group
                      </button>
                      <button
                        onClick={() => { setShowRemoveModal(true); setShowMoreMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#1f2937] hover:bg-[#f8fafc] transition-colors flex items-center gap-2.5"
                      >
                        <XCircle size={16} className="text-[#64748b]" />
                        Remove from Group
                      </button>
                      <div className="h-px bg-[#e7ebf8]"></div>
                      <button
                        onClick={() => { setShowDeleteModal(true); setShowMoreMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#ef4444] hover:bg-[#fef2f2] transition-colors flex items-center gap-2.5"
                      >
                        <Trash2 size={16} className="text-[#ef4444]" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        {/* Item Header Card */}
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6 sm:mb-8">
            <div className="flex items-center gap-5">
              {(() => {
                const itemImg = item.image || (item.images && item.images[0]?.data) || (item.images && typeof item.images[0] === 'string' && item.images[0]) || (itemGroup.image) || (itemGroup.images && itemGroup.images[0]) || "";
                if (itemImg) {
                  return (
                    <div className="w-20 h-20 rounded-xl overflow-hidden border border-gray-200 bg-white flex items-center justify-center shrink-0 shadow-sm p-1">
                      <img src={itemImg} alt={item.name} className="w-full h-full object-contain" />
                    </div>
                  );
                }
                return null;
              })()}
              <div>
                <h1 className="text-3xl font-bold text-[#1a1a2e] tracking-tight">
                  {item.name || "Item Detail"}
                  {searchParams.get("unitIndex") && <span className="ml-2 text-base font-semibold text-purple-600">(Unit {searchParams.get("unitIndex")})</span>}
                </h1>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <p className="text-base text-[#64748b]">
                    SKU: <span className="font-mono font-bold text-gray-900">{searchParams.get("pieceSku") || item.sku || "N/A"}</span>
                  </p>
                  <span className="text-sm text-[#64748b]">• Group: <span className="font-semibold text-[#1a1a2e]">{itemGroup.name}</span></span>
                  {searchParams.get("pieceSku") && (
                    <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-xs font-bold px-2.5 py-0.5 rounded shadow-2xs">
                      Unit {searchParams.get("unitIndex") || "1"} Piece Tag
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-[#64748b] mb-1">Selling Price</p>
              <p className="text-3xl font-bold text-[#10b981]">{formatCurrency(item.sellingPrice)}</p>
            </div>
          </div>

          {/* Stock Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6" key={`stock-summary-${warehouseStocks.length}-${JSON.stringify(stockTotals)}`}>
            <div className="bg-gradient-to-br from-[#F6FCE6] to-[#ECF9C7]/50 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <Package size={20} className="text-[#15171D]" />
                <span className="text-sm font-medium text-[#64748b]">Stock on Hand</span>
              </div>
              <p className="text-3xl font-bold text-[#1a1a2e]">{searchParams.get("pieceSku") ? "1" : stockTotals.accounting.stockOnHand.toFixed(0)}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <ShoppingCart size={20} className="text-emerald-600" />
                <span className="text-sm font-medium text-[#64748b]">Available for Sale</span>
              </div>
              <p className="text-3xl font-bold text-[#1a1a2e]">{searchParams.get("pieceSku") ? "1" : stockTotals.accounting.availableForSale.toFixed(0)}</p>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <Box size={20} className="text-amber-600" />
                <span className="text-sm font-medium text-[#64748b]">Reorder Point</span>
              </div>
              <p className="text-3xl font-bold text-[#1a1a2e]">{item.reorderPoint || "—"}</p>
            </div>
          </div>
        </div>

        {/* Tabs - Clean Underline Style */}
        <div>
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white border border-gray-200/80 shadow-sm">
            {["Overview", "Stocks", ...(isAdmin || user?.power === 'warehouse' ? ["History"] : [])].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`no-hover-anim inline-flex items-center h-9 px-5 rounded-full text-sm font-semibold transition ${
                  activeTab === tab
                    ? "bg-[#15171D] text-white"
                    : "text-gray-500 hover:text-[#15171D]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm">
          {/* Content */}
          <div className="p-5 sm:p-8">
            {activeTab === "Overview" && (
              <div className="space-y-10">
                {/* Images Section */}
                {itemGroup.groupImages && itemGroup.groupImages.length > 0 && (
                  <div>
                    <AttachmentDisplay attachments={itemGroup.groupImages} />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10">
                  {/* Left Column */}
                  <div className="space-y-10">
                    {/* Pricing */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Pricing</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Cost Price</span>
                          <span className="text-sm font-semibold text-[#1a1a2e]">{formatCurrency(item.costPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Selling Price</span>
                          <span className="text-sm font-semibold text-[#10b981]">{formatCurrency(item.sellingPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">MRP</span>
                          <span className="text-sm font-semibold text-[#15171D]">{parseFloat(item.mrp) > 0 ? formatCurrency(item.mrp) : formatCurrency(item.sellingPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Purchase Price</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{formatCurrency(item.purchasePrice ?? item.costPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Landing Cost</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.landingCost != null ? formatCurrency(item.landingCost) : "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Selling Discount</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.sellingDiscount != null ? formatCurrency(item.sellingDiscount) : "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Selling Margin</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.sellingMargin != null ? formatCurrency(item.sellingMargin) : "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Membership Margin</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.membershipMargin != null ? formatCurrency(item.membershipMargin) : "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">HSN Code</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.hsnCode || "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Tax */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Tax</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Tax Preference</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.taxPreference === "taxable" ? "Taxable" : "Non-Taxable"}</span>
                        </div>
                        {itemGroup.intraStateTaxRate && (
                          <div className="flex justify-between items-center py-2">
                            <span className="text-sm text-[#64748b]">Intra State Tax</span>
                            <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.intraStateTaxRate}</span>
                          </div>
                        )}
                        {itemGroup.interStateTaxRate && (
                          <div className="flex justify-between items-center py-2">
                            <span className="text-sm text-[#64748b]">Inter State Tax</span>
                            <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.interStateTaxRate}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Purchase Tax</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.purchaseTax || itemGroup.purchaseTax || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Sales Tax</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.salesTax || itemGroup.salesTax || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Cess %</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.cess != null && item.cess !== false ? (item.cess === true ? "Yes" : item.cess) : "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Manage Multiple Batch</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.manageBatch || item.manageMultipleBatch || itemGroup.manageMultipleBatch ? "Yes" : "No"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Status</h3>
                      <div className="flex flex-wrap gap-3">
                        <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${itemGroup.sellable !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-2 h-2 rounded-full ${itemGroup.sellable !== false ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
                          Sellable
                        </span>
                        <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${itemGroup.purchasable !== false ? 'bg-[#F6FCE6] text-[#0F1115]' : 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-2 h-2 rounded-full ${itemGroup.purchasable !== false ? 'bg-[#1C1F26]' : 'bg-gray-400'}`}></span>
                          Purchasable
                        </span>
                        {item.returnable === true && (
                          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-purple-50 text-purple-700">
                            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                            Returnable
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-10">
                    {/* Details */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Details</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Item Group</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.name}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Item Type</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.itemType === "goods" ? "Inventory Item" : "Service"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">SKU</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{searchParams.get("pieceSku") || item.sku || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Item Code / Barcode</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.barcode || item.sku || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Print Name</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.printName || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Category</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.category || itemGroup.category || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Sub Category</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.subCategory || itemGroup.subCategory || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Brand</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.brand || itemGroup.brand || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Sub Brand</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.subBrand || itemGroup.subBrand || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Manufacturer</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.manufacturer || itemGroup.manufacturer || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Unit</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.unit || "pcs"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Minimum Quantity</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.reorderPoint ?? item.minQty ?? "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Opening Qty</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.openingQty ?? "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Net Weight</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">{item.netWeight ?? item.weight ?? "—"}</span>
                        </div>
                        {itemGroup.attributeRows && itemGroup.attributeRows.map((attrRow, idx) => {
                          const attrValue = item.attributeCombination && item.attributeCombination[idx]
                            ? item.attributeCombination[idx]
                            : getAttributeValue(attrRow.attribute);
                          return attrRow.attribute ? (
                            <div key={idx} className="flex justify-between items-center py-2">
                              <span className="text-sm text-[#64748b]">{attrRow.attribute}</span>
                              <span className="text-sm font-medium text-[#1a1a2e]">{attrValue || "—"}</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>

                    {/* Inventory */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Inventory</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Inventory Account</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">Inventory Asset</span>
                        </div>
                        {itemGroup.inventoryValuationMethod && (
                          <div className="flex justify-between items-center py-2">
                            <span className="text-sm text-[#64748b]">Valuation Method</span>
                            <span className="text-sm font-medium text-[#1a1a2e]">{itemGroup.inventoryValuationMethod}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-[#64748b]">Track Inventory</span>
                          <span className={`text-sm font-medium ${itemGroup.trackInventory ? 'text-emerald-600' : 'text-gray-500'}`}>
                            {itemGroup.trackInventory ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Accounts */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-5">Accounts</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center py-2 border-b border-[#f1f5f9]">
                          <span className="text-sm text-[#64748b]">Sales Account</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">Sales</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-[#f1f5f9]">
                          <span className="text-sm text-[#64748b]">Purchase Account</span>
                          <span className="text-sm font-medium text-[#1a1a2e]">Cost of Goods Sold</span>
                        </div>
                      </div>
                    </div>

                    {/* Vendors (same SKU bought from several vendors) */}
                    <VendorBreakdown item={item} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Stocks" && (() => {
              const rows = warehouseStocks.map((stock) => {
                const onHand = stock.stockOnHand !== undefined && stock.stockOnHand !== null
                  ? parseFloat(stock.stockOnHand)
                  : parseFloat(stock.openingStock || 0);
                const committed = parseFloat(stock.committedStock || 0);
                const available = stock.availableForSale !== undefined && stock.availableForSale !== null
                  ? parseFloat(stock.availableForSale)
                  : onHand - committed;
                return { name: stock.warehouse, onHand: isNaN(onHand) ? 0 : onHand, available: isNaN(available) ? 0 : available, main: stock.warehouse === "Warehouse" };
              });
              const totalOnHand = rows.reduce((s, r) => s + r.onHand, 0);
              const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
              const withStock = rows.filter((r) => r.onHand > 0).length;
              const fmtQty = (n) => (Number.isInteger(n) ? n : n.toFixed(2));
              const addStock = () => setShowStockModal(true);

              return (
                <div className="space-y-5">
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-bold tracking-tight text-[#15171D]">Stock by location</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {rows.length ? `${withStock} of ${rows.length} locations have stock` : "No locations yet"}
                      </p>
                    </div>
                    {(isAdmin || user?.power === "warehouse") && (
                      <button type="button" onClick={addStock} className={`${ui.btnPrimary} h-10 px-4 text-sm`}>
                        <Plus size={15} /> Add Stock
                      </button>
                    )}
                  </div>

                  {rows.length > 0 ? (
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="min-w-full">
                          <thead>
                            <tr>
                              <th className={`${ui.th} text-left`}>Location</th>
                              <th className={`${ui.th} text-right`}>Stock on hand</th>
                              <th className={`${ui.th} text-right`}>Available for sale</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={`${r.name}-${i}`} className={`${ui.tr(i)} hover:bg-[#F6FCE6]/60 transition-colors`}>
                                <td className="px-4 py-3.5">
                                  <div className="flex items-center gap-2.5">
                                    <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${r.main ? "bg-[#15171D] text-[#C6F135]" : "bg-gray-100 text-gray-500"}`}>
                                      {r.main ? <Star size={14} className="fill-current" /> : <Warehouse size={14} />}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-[#15171D]">{r.name}</p>
                                      {r.main && <p className="text-[11px] text-gray-400">Main warehouse</p>}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <span className={`text-sm font-bold tabular-nums ${r.onHand > 0 ? "text-[#15171D]" : "text-gray-300"}`}>{fmtQty(r.onHand)}</span>
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  {r.available > 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-sm font-bold tabular-nums">{fmtQty(r.available)}</span>
                                  ) : (
                                    <span className="text-sm font-semibold text-gray-300 tabular-nums">{fmtQty(r.available)}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 bg-[#F6FCE6]">
                              <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Total</td>
                              <td className="px-4 py-3 text-right text-sm font-extrabold tabular-nums text-[#15171D]">{fmtQty(totalOnHand)}</td>
                              <td className="px-4 py-3 text-right text-sm font-extrabold tabular-nums text-emerald-700">{fmtQty(totalAvailable)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 py-12 px-6 text-center">
                      <span className="mx-auto grid place-items-center w-12 h-12 rounded-2xl bg-[#15171D] text-[#C6F135] mb-4">
                        <Warehouse size={22} />
                      </span>
                      <p className="text-sm font-bold text-[#15171D]">No stock added yet</p>
                      <p className="text-xs text-gray-500 mt-1 mb-5">Add opening stock for this item at your warehouse or stores.</p>
                      {(isAdmin || user?.power === "warehouse") && (
                        <button type="button" onClick={addStock} className={`${ui.btnPrimary} h-10 px-5 text-sm`}>
                          <Plus size={15} /> Add Stock
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === "History" && (isAdmin || user?.power === 'warehouse') && (
              <div className="py-6">
                {loadingHistory ? (
                  <div className="py-12 text-center text-sm text-[#64748b]">
                    Loading history...
                  </div>
                ) : history.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[#64748b]">
                    No history available
                  </div>
                ) : (
                  <div className="rounded-lg border border-[#e4e6f2] bg-white overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                            DATE
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                            DETAILS
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {history.map((entry, idx) => {
                          const dateValue = entry.changedAt || entry.createdAt || new Date();
                          const date = new Date(dateValue);
                          
                          if (isNaN(date.getTime())) {
                            console.error("Invalid date for history entry:", entry);
                          }
                          
                          const formattedDate = date.toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          });
                          const formattedTime = date.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          });
                          let detailsText = entry.details || "updated";
                          if (entry.changedBy) {
                            if (entry.changeType === "CREATE") {
                              detailsText = `created by - ${entry.changedBy}`;
                            } else {
                              detailsText = entry.details && entry.details !== "updated" 
                                ? `${entry.details} - ${entry.changedBy}`
                                : `updated by - ${entry.changedBy}`;
                            }
                          }
                          
                          return (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {formattedDate} {formattedTime}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {detailsText}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab !== "Overview" && activeTab !== "Stocks" && activeTab !== "History" && (
              <div className="py-12 text-center text-sm text-[#64748b]">
                {activeTab} content coming soon...
              </div>
            )}
          </div>
        </div>
      </main>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 px-4">
            <div className="relative w-full max-w-md rounded-2xl border border-[#e4e6f2] bg-white shadow-[0_18px_50px_-24px_rgba(15,23,42,0.18)]">
              <div className="px-6 py-4 border-b border-[#e4e6f2]">
                <h2 className="text-lg font-semibold text-[#1f2937]">Delete Item</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-[#475569] leading-relaxed">
                  Are you sure you want to delete <span className="font-bold text-[#111827]">"{item?.name}"</span>? This action cannot be undone.
                </p>
              </div>
              <div className="px-6 py-4 border-t border-[#e4e6f2] flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={loading}
                  className="no-hover-anim px-4 py-2 text-sm font-medium text-[#475569] bg-white border border-[#ECF9C7] rounded-lg hover:bg-[#f8fafc] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mark as Inactive Confirmation Modal */}
        {showInactiveModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 px-4">
            <div className="relative w-full max-w-md rounded-2xl border border-[#e4e6f2] bg-white shadow-[0_18px_50px_-24px_rgba(15,23,42,0.18)]">
              <div className="px-6 py-4 border-b border-[#e4e6f2]">
                <h2 className="text-lg font-semibold text-[#1f2937]">Mark as Inactive</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-[#475569] leading-relaxed">
                  Are you sure you want to mark <span className="font-bold text-[#111827]">"{item?.name}"</span> as inactive? This will remove the item from the group.
                </p>
              </div>
              <div className="px-6 py-4 border-t border-[#e4e6f2] flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowInactiveModal(false)}
                  disabled={loading}
                  className="no-hover-anim px-4 py-2 text-sm font-medium text-[#475569] bg-white border border-[#ECF9C7] rounded-lg hover:bg-[#f8fafc] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMarkAsInactive}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#15171D] rounded-lg hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Updating..." : "Mark as Inactive"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Move to Another Group Modal */}
        {showMoveModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 px-4">
            <div className="relative w-full max-w-md rounded-2xl border border-[#e4e6f2] bg-white shadow-[0_18px_50px_-24px_rgba(15,23,42,0.18)]">
              <div className="px-6 py-4 border-b border-[#e4e6f2]">
                <h2 className="text-lg font-semibold text-[#1f2937]">Move to Another Group</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-[#475569] mb-3">
                  Select a target group to move <span className="font-bold text-[#111827]">"{item?.name}"</span> to:
                </p>
                {loadingGroups ? (
                  <div className="text-center py-4 text-sm text-[#64748b]">Loading groups...</div>
                ) : allItemGroups.length === 0 ? (
                  <div className="text-center py-4 text-sm text-[#64748b]">
                    No other item groups available.
                  </div>
                ) : (
                  <select
                    value={selectedTargetGroupId}
                    onChange={(e) => setSelectedTargetGroupId(e.target.value)}
                    className="w-full rounded-lg border border-[#ECF9C7] bg-white px-4 py-2 text-sm text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#A8D11E] focus:border-transparent"
                  >
                    <option value="">Select a group...</option>
                    {allItemGroups.map((group) => (
                      <option key={group._id || group.id} value={group._id || group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="px-6 py-4 border-t border-[#e4e6f2] flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowMoveModal(false);
                    setSelectedTargetGroupId("");
                  }}
                  disabled={loading}
                  className="no-hover-anim px-4 py-2 text-sm font-medium text-[#475569] bg-white border border-[#ECF9C7] rounded-lg hover:bg-[#f8fafc] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMoveToGroup}
                  disabled={loading || !selectedTargetGroupId || loadingGroups || allItemGroups.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#15171D] rounded-lg hover:bg-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Moving..." : "Move"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remove from Item Group Modal */}
        {showRemoveModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 px-4">
            <div className="relative w-full max-w-md rounded-2xl border border-[#e4e6f2] bg-white shadow-[0_18px_50px_-24px_rgba(15,23,42,0.18)]">
              <div className="px-6 py-4 border-b border-[#e4e6f2]">
                <h2 className="text-lg font-semibold text-[#1f2937]">Remove from Item Group</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-[#475569] leading-relaxed">
                  Are you sure you want to remove <span className="font-bold text-[#111827]">"{item?.name}"</span> from this item group? This action cannot be undone.
                </p>
              </div>
              <div className="px-6 py-4 border-t border-[#e4e6f2] flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowRemoveModal(false)}
                  disabled={loading}
                  className="no-hover-anim px-4 py-2 text-sm font-medium text-[#475569] bg-white border border-[#ECF9C7] rounded-lg hover:bg-[#f8fafc] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMarkAsInactive}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#15171D] rounded-lg hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default ShoeSalesItemDetailFromGroup;

