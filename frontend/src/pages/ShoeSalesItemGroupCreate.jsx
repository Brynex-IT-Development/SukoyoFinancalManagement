import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useEnterToSave } from "../hooks/useEnterToSave";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Trash2, ArrowLeft, X, ChevronDown, Search, Settings, Check, ShoppingBag, ShoppingCart, Edit, MoreHorizontal, Package, Layers, Plus, Info, AlertCircle, Warehouse, DollarSign } from "lucide-react";
import Header from "../components/Header";
import * as ui from "../components/docDetailStyles";
import ImageUpload from "../components/ImageUpload";
import baseUrl from "../api/api";
import useSidebar from "../hooks/useSidebar";

const STORAGE_KEYS = {
  manufacturers: "shoeSalesManufacturers",
  brands: "shoeSalesBrands",
};

const loadStoredList = (key) => {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage`, error);
  }
  return [];
};

const unitOptions = [
  "box",
  "cm",
  "dz",
  "ft",
  "g",
  "in",
  "kg",
  "km",
  "lb",
  "mg",
  "ml",
  "m",
  "pcs",
  "PCS",
];

const ShoeSalesItemGroupCreate = () => {
  const isSidebarOpen = useSidebar();
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(isEditMode);
  const [showAccounts, setShowAccounts] = useState(false);
  const [itemType, setItemType] = useState("goods");
  const [createAttributes, setCreateAttributes] = useState(true);
  const [attributeRows, setAttributeRows] = useState([
    { id: 1, attribute: "", options: [], optionInput: "" }
  ]);
  const [showSingleItemModal, setShowSingleItemModal] = useState(false);
  const [itemGroupName, setItemGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [itemGroupSku, setItemGroupSku] = useState("");
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false);
  const [sellable, setSellable] = useState(true);
  const [purchasable, setPurchasable] = useState(true);
  const [returnable, setReturnable] = useState(true);
  const [manufacturers, setManufacturers] = useState([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState("");
  const [showManufacturerModal, setShowManufacturerModal] = useState(false);
  const [newManufacturer, setNewManufacturer] = useState("");
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [category, setCategory] = useState("other");
  const [unit, setUnit] = useState("pcs");
  const [inventoryValuation, setInventoryValuation] = useState("FIFO (First In First Out)");
  const [taxPreference, setTaxPreference] = useState("taxable");
  const [exemptionReason, setExemptionReason] = useState("");
  const [intraStateTaxRate, setIntraStateTaxRate] = useState("");
  const [interStateTaxRate, setInterStateTaxRate] = useState("");
  const [itemRows, setItemRows] = useState([]);
  const [generatedItems, setGeneratedItems] = useState([]);
  const [manualItemsSnapshot, setManualItemsSnapshot] = useState([]);
  const [itemSkuManuallyEdited, setItemSkuManuallyEdited] = useState({}); // Track which items have manually edited SKU
  const previousGeneratedItemsRef = useRef([]); // Store previous items to preserve manual edits
  const [priceIncludesGST, setPriceIncludesGST] = useState(true);
  const [groupImages, setGroupImages] = useState([]);
  // Snapshot of attribute rows when the group was loaded (edit mode) to detect newly added attributes/options
  const initialAttributeRowsRef = useRef([]);

  const API_ROOT = (baseUrl?.baseUrl || "").replace(/\/$/, "");
  const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";

  // Fetch manufacturers from backend
  useEffect(() => {
    const fetchManufacturers = async () => {
      try {
        const response = await fetch(`${API_ROOT}/api/shoe-sales/manufacturers?isActive=true`);
        if (response.ok) {
          const data = await response.json();
          const manufacturerNames = data.map((m) => m.name);
          setManufacturers(manufacturerNames);
          if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEYS.manufacturers, JSON.stringify(manufacturerNames));
          }
        } else {
          const stored = loadStoredList(STORAGE_KEYS.manufacturers);
          setManufacturers(stored);
        }
      } catch (error) {
        console.error("Error fetching manufacturers:", error);
        const stored = loadStoredList(STORAGE_KEYS.manufacturers);
        setManufacturers(stored);
      }
    };
    fetchManufacturers();
  }, []);

  // Fetch brands from backend
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const response = await fetch(`${API_ROOT}/api/shoe-sales/brands?isActive=true`);
        if (response.ok) {
          const data = await response.json();
          const brandNames = data.map((b) => b.name);
          setBrands(brandNames);
          if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEYS.brands, JSON.stringify(brandNames));
          }
        } else {
          const stored = loadStoredList(STORAGE_KEYS.brands);
          setBrands(stored);
        }
      } catch (error) {
        console.error("Error fetching brands:", error);
        const stored = loadStoredList(STORAGE_KEYS.brands);
        setBrands(stored);
      }
    };
    fetchBrands();
  }, []);

  const extractGSTPercentage = useCallback((taxRate) => {
    if (!taxRate) return null;
    const match = taxRate.match(/\[(\d+(?:\.\d+)?)%\]/);
    if (match) {
      const parsed = parseFloat(match[1]);
      return Number.isNaN(parsed) ? null : parsed;
    }
    const fallback = parseFloat(taxRate);
    return Number.isNaN(fallback) ? null : fallback;
  }, []);

  const calculateGSTDetails = useCallback((amount, taxRate, isInclusive = false) => {
    if (!amount || !taxRate) return null;
    const price = parseFloat(amount);
    if (!Number.isFinite(price) || price === 0) return null;

    const percentage = extractGSTPercentage(taxRate);
    if (percentage === null) return null;

    let basePrice = 0;
    let gstAmount = 0;
    let finalPrice = 0;

    if (isInclusive) {
      basePrice = price / (1 + percentage / 100);
      gstAmount = price - basePrice;
      finalPrice = price;
    } else {
      basePrice = price;
      gstAmount = price * (percentage / 100);
      finalPrice = price + gstAmount;
    }

    return {
      basePrice: basePrice.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      finalPrice: finalPrice.toFixed(2),
      percentage,
    };
  }, [extractGSTPercentage]);

  // Generate SKU from item group name (similar to ShoeSalesItemCreate.jsx)
  const generateSkuPreview = useCallback((name = "", size = "", attributeCombo = []) => {
    const words = name
      .replace(/[^a-zA-Z0-9\s-]/g, " ")
      .split(/[\s-_,]+/)
      .filter(Boolean);

    if (words.length === 0) {
      return "";
    }

    const alphaWords = words.filter((word) => /[A-Za-z]/.test(word));
    const numericWords = words.filter((word) => /^\d+$/.test(word));

    // Build SKU with shorter format but still unique
    let letters = "";
    
    if (alphaWords.length > 0) {
      // Take minimal characters but ensure uniqueness, especially for last word
      if (alphaWords.length === 1) {
        // Single word: take first 3 chars
        letters = alphaWords[0].slice(0, 3).toUpperCase();
      } else if (alphaWords.length === 2) {
        // Two words: first 2 chars from first, first 2 chars from second
        letters = (alphaWords[0].slice(0, 2) + alphaWords[1].slice(0, 2)).toUpperCase();
      } else if (alphaWords.length === 3) {
        // Three words: first letter of first two + first 3 chars of last (ensures uniqueness)
        letters = (alphaWords[0][0] + alphaWords[1][0] + alphaWords[2].slice(0, 3)).toUpperCase();
      } else {
        // Four or more words: first letter of first two + first 2 chars from rest
        letters = (alphaWords[0][0] + alphaWords[1][0]).toUpperCase();
        for (let i = 2; i < alphaWords.length && letters.length < 6; i++) {
          letters += alphaWords[i].slice(0, 2).toUpperCase();
        }
      }
    }

    if (!letters && words.length > 0) {
      letters = words[0].slice(0, 4).toUpperCase();
    }

    let base = letters || "IGRP";
    const digits = numericWords.join("");
    if (digits) {
      base += `-${digits}`;
    }

    // Add attribute combination to SKU for uniqueness (if provided)
    // This ensures each color/size combination gets a unique SKU
    if (attributeCombo && attributeCombo.length > 0) {
      // Create a short code from the attribute values
      const attrCode = attributeCombo
        .map(attr => {
          if (!attr) return "";
          // Take first 2 chars of each attribute value
          return attr.slice(0, 2).toUpperCase();
        })
        .filter(Boolean)
        .join("");
      
      if (attrCode) {
        base += `-${attrCode}`;
      }
    } else if (size && size.trim()) {
      // Fallback to size if no attribute combo provided
      base += `-${size.trim()}`;
    }

    return base;
  }, []);

  // Auto-generate SKU when item group name changes (only in create mode)
  useEffect(() => {
    if (!isEditMode && !skuManuallyEdited && itemGroupName) {
      setItemGroupSku(generateSkuPreview(itemGroupName));
    }
  }, [itemGroupName, skuManuallyEdited, generateSkuPreview, isEditMode]);

  // Fetch item group data when in edit mode
  useEffect(() => {
    if (isEditMode && id) {
      const fetchItemGroup = async () => {
        try {
          setLoading(true);
          const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
          const response = await fetch(`${API_URL}/api/shoe-sales/item-groups/${id}`);
          
          if (!response.ok) {
            throw new Error("Failed to fetch item group");
          }
          
          const data = await response.json();
          
          // Populate all form fields with existing data
          const rawAttributeRows = Array.isArray(data.attributeRows)
            ? data.attributeRows.map((row, idx) => ({
                id: idx + 1,
                attribute: row?.attribute || "",
                options: Array.isArray(row?.options) ? row.options : [],
                optionInput: ""
              }))
            : [];
          const validAttributeRows = rawAttributeRows.filter(
            (row) =>
              row.attribute.trim() !== "" &&
              row.options.some((opt) => typeof opt === "string" && opt.trim() !== "")
          );
          const hasAttributeRows = validAttributeRows.length > 0;
          const shouldUseAttributes =
            (data.createAttributes !== undefined ? data.createAttributes : hasAttributeRows) && hasAttributeRows;

          setItemGroupName(data.name || "");
          setItemGroupSku(data.sku || "");
          setDescription(data.description || "");
          setSkuManuallyEdited(!!data.sku);
          setItemType(data.itemType || "goods");
          setUnit(data.unit || "");
          setSelectedManufacturer(data.manufacturer || "");
          setSelectedBrand(data.brand || "");
          if (data.manufacturer) {
            setManufacturers((prev) =>
              prev.includes(data.manufacturer) ? prev : [...prev, data.manufacturer]
            );
          }
          if (data.brand) {
            setBrands((prev) =>
              prev.includes(data.brand) ? prev : [...prev, data.brand]
            );
          }
          setInventoryValuation(data.inventoryValuationMethod || "FIFO (First In First Out)");
          setTaxPreference(data.taxPreference || "taxable");
          setExemptionReason(data.exemptionReason || "");
          setIntraStateTaxRate(data.intraStateTaxRate || data.taxRateIntra || "");
          setInterStateTaxRate(data.interStateTaxRate || data.taxRateInter || "");
          setCreateAttributes(shouldUseAttributes);
          setSellable(data.sellable !== undefined ? data.sellable : true);
          setPurchasable(data.purchasable !== undefined ? data.purchasable : true);
          setReturnable(data.returnable !== undefined ? data.returnable : true);
          setGroupImages(data.groupImages || data.images || []);
          
          // Set attribute rows if they exist
          setAttributeRows(rawAttributeRows.length > 0 ? rawAttributeRows : [{ id: 1, attribute: "", options: [], optionInput: "" }]);
          // Keep a snapshot to compare later (edit mode)
          initialAttributeRowsRef.current = (rawAttributeRows || []).map(r => ({
            attribute: (r.attribute || "").toLowerCase().trim(),
            options: Array.isArray(r.options) ? [...r.options] : []
          }));
          
          // Set items - either from generated items or manual items
          if (data.items && Array.isArray(data.items) && data.items.length > 0) {
            if (shouldUseAttributes) {
              // Items were generated from attributes
              const loadedItems = data.items.map(item => {
                // Regenerate item name from attributeCombination to reflect any changes made in edit mode
                let itemName = item.name || "";
                if (item.attributeCombination && Array.isArray(item.attributeCombination) && item.attributeCombination.length > 0) {
                  const optionsStr = item.attributeCombination.join("/");
                  itemName = `${data.name || "Item"} - ${optionsStr}`;
                  console.log(`Loading item: original name="${item.name}", regenerated name="${itemName}", attributeCombination=`, item.attributeCombination);
                }
                
                // Extract size from attributeCombination if size attribute exists
                const sizeAttributeIndex = rawAttributeRows.findIndex(row => row.attribute?.toLowerCase() === "size");
                const sizeValue = sizeAttributeIndex !== -1 && item.attributeCombination && item.attributeCombination[sizeAttributeIndex]
                  ? item.attributeCombination[sizeAttributeIndex]
                  : (item.size || "");
                
                return {
                  id: item._id || item.id || `item-${Date.now()}-${Math.random()}`,
                  _id: item._id && item._id.match(/^[0-9a-fA-F]{24}$/) ? item._id : undefined, // Only set _id if it's a valid MongoDB ObjectId
                  name: itemName, // Use regenerated name based on current attributeCombination
                  sku: item.sku || "",
                  size: sizeValue, // Include size
                  costPrice: item.costPrice !== undefined && item.costPrice !== null ? item.costPrice.toString() : "",
                  sellingPrice: item.sellingPrice !== undefined && item.sellingPrice !== null ? item.sellingPrice.toString() : "",
                  upc: item.upc || "",
                  hsnCode: item.hsnCode || "",
                  isbn: item.isbn || "",
                  reorderPoint: item.reorderPoint || "",
                  sac: item.sac || "",
                  stock: item.stock || 0,
                  attributeCombination: item.attributeCombination || [],
                  warehouseStocks: item.warehouseStocks || [] // PRESERVE warehouse stocks
                };
              });
              console.log(`Loaded ${loadedItems.length} items from database:`, loadedItems);
              setGeneratedItems(loadedItems);
              // Update the ref so regeneration preserves these values
              previousGeneratedItemsRef.current = loadedItems;
            } else {
              // Manual items
              const manualItems = data.items.map(item => ({
                id: item._id || item.id || `item-${Date.now()}-${Math.random()}`,
                _id: item._id && item._id.match(/^[0-9a-fA-F]{24}$/) ? item._id : undefined, // Only set _id if it's a valid MongoDB ObjectId
                name: item.name || "",
                sku: item.sku || "",
                costPrice: item.costPrice !== undefined && item.costPrice !== null ? item.costPrice.toString() : "",
                sellingPrice: item.sellingPrice !== undefined && item.sellingPrice !== null ? item.sellingPrice.toString() : "",
                upc: item.upc || "",
                hsnCode: item.hsnCode || "",
                isbn: item.isbn || "",
                reorderPoint: item.reorderPoint || "",
                sac: item.sac || "",
                stock: item.stock || 0,
                warehouseStocks: item.warehouseStocks || [] // PRESERVE warehouse stocks
              }));
              setItemRows(manualItems);
              setManualItemsSnapshot(manualItems);
            }
          }
          
        } catch (error) {
          console.error("Error fetching item group:", error);
          alert("Failed to load item group data. Please try again.");
          navigate("/shoe-sales/item-groups");
        } finally {
          setLoading(false);
        }
      };
      
      fetchItemGroup();
    }
  }, [isEditMode, id, navigate]);

  // Generate items from attribute rows - combining all attribute options
  useEffect(() => {
    // In edit mode, only regenerate if user actually ADDED a new attribute or option
    if (isEditMode) {
      const normalizedCurrent = (attributeRows || []).map(r => ({
        attribute: (r.attribute || "").toLowerCase().trim(),
        options: Array.isArray(r.options) ? r.options : []
      }));
      const normalizedInitial = initialAttributeRowsRef.current || [];
      // Detect new attribute row
      const currentAttrSet = new Set(normalizedCurrent.map(r => r.attribute).filter(Boolean));
      const initialAttrSet = new Set(normalizedInitial.map(r => r.attribute).filter(Boolean));
      let added = false;
      for (const attr of currentAttrSet) {
        if (!initialAttrSet.has(attr)) {
          added = true;
          break;
        }
      }
      // Detect new option appended to any existing attribute
      if (!added) {
        for (const curr of normalizedCurrent) {
          const ini = normalizedInitial.find(r => r.attribute === curr.attribute);
          if (!ini) continue;
          const iniSet = new Set(ini.options);
          const newOpt = (curr.options || []).some(opt => !iniSet.has(opt));
          if (newOpt) {
            added = true;
            break;
          }
        }
      }
      if (!added) {
        // No new attributes/options introduced → do not regenerate
        return;
      }
      // else fall through to regeneration logic below
    }
    if (!createAttributes || !attributeRows || attributeRows.length === 0) {
      // Only clear generatedItems if we're switching away from attribute mode
      // Don't clear if we have existing items that should be preserved
      if (previousGeneratedItemsRef.current.length === 0) {
        setGeneratedItems([]);
      } else {
        // Preserve existing items even if attributes are empty/invalid
        // This happens when toggling checkbox in edit mode
        setGeneratedItems(previousGeneratedItemsRef.current);
      }
      return;
    }

    // Get all rows with attributes and options
    const validRows = attributeRows.filter(row => row.attribute && row.options.length > 0);
    
    if (validRows.length === 0) {
      // Preserve existing items if we have them
      // Only clear if we're starting fresh
      if (previousGeneratedItemsRef.current.length === 0) {
        setGeneratedItems([]);
      } else {
        // Preserve existing items even if attributes are temporarily invalid
        setGeneratedItems(previousGeneratedItemsRef.current);
      }
      return;
    }

    // Generate cartesian product of all options
    const generateCombinations = (arrays) => {
      if (arrays.length === 0) return [[]];
      if (arrays.length === 1) return arrays[0].map(opt => [opt]);
      
      const [first, ...rest] = arrays;
      const restCombinations = generateCombinations(rest);
      const result = [];
      
      first.forEach(option => {
        restCombinations.forEach(combo => {
          result.push([option, ...combo]);
        });
      });
      
      return result;
    };

    const optionArrays = validRows.map(row => row.options);
    const combinations = generateCombinations(optionArrays);
    
    console.log(`Generating ${combinations.length} item combinations from attributes:`, {
      validRows: validRows.map(r => ({ attribute: r.attribute, options: r.options })),
      combinations: combinations,
      previousItemsCount: previousGeneratedItemsRef.current.length
    });
    
    // Find size attribute index
    const sizeAttributeIndex = validRows.findIndex(row => row.attribute?.toLowerCase() === "size");
    
    const items = combinations.map((combo, idx) => {
      // Extract size from attribute combination if size attribute exists
      const sizeValue = sizeAttributeIndex !== -1 && combo[sizeAttributeIndex] ? combo[sizeAttributeIndex] : "";
      
      // Create item name: "ItemGroupName - option1/option2/option3"
      const optionsStr = combo.join("/");
      const itemName = `${itemGroupName || "Item"} - ${optionsStr}`;
      
      // For SKU generation, use base name without size in the name part
      const baseName = itemGroupName || "Item";
      
      // Check if this item already exists in previous items (by matching attribute combination or by ID)
      // First try to match by attribute combination
      let existingItem = previousGeneratedItemsRef.current.find(existing => 
        JSON.stringify(existing.attributeCombination) === JSON.stringify(combo)
      );
      
      // If not found by combination, try to match by name (for backward compatibility)
      if (!existingItem) {
        existingItem = previousGeneratedItemsRef.current.find(existing => 
          existing.name === itemName
        );
      }
      
      if (existingItem) {
        console.log(`Found existing item for combination [${combo.join(", ")}], preserving data`);
      } else {
        console.log(`Creating new item for combination [${combo.join(", ")}]`);
      }
      
      // If item exists and SKU was manually edited, preserve it
      // Otherwise, auto-generate SKU from item name + size + attribute combination
      const itemSku = existingItem && itemSkuManuallyEdited[existingItem.id]
        ? existingItem.sku
        : generateSkuPreview(baseName, sizeValue, combo);
      
      // Preserve other fields from existing item if it exists
      return {
        id: existingItem?.id || `item-${Date.now()}-${idx}`,
        name: itemName,
        sku: itemSku,
        size: existingItem?.size || sizeValue, // Store size
        costPrice: existingItem?.costPrice !== undefined && existingItem?.costPrice !== null ? existingItem.costPrice.toString() : "",
        sellingPrice: existingItem?.sellingPrice !== undefined && existingItem?.sellingPrice !== null ? existingItem.sellingPrice.toString() : "0",
        upc: existingItem?.upc || "",
        hsnCode: existingItem?.hsnCode || "",
        isbn: existingItem?.isbn || "",
        reorderPoint: existingItem?.reorderPoint || "",
        sac: existingItem?.sac || "",
        stock: existingItem?.stock || 0,
        attributeCombination: combo // Store which options were combined
      };
    });
    
    // Preserve items from previous items that don't match any generated combinations
    // These are likely transferred/manually added items without attribute combinations
    const matchedIds = new Set(items.map(item => item.id));
    const unmatchedItems = previousGeneratedItemsRef.current.filter(existing => {
      // Check if this item doesn't have a matching attribute combination
      const existingCombo = existing.attributeCombination || [];
      const hasMatchingCombo = combinations.some(combo => 
        JSON.stringify(existingCombo) === JSON.stringify(combo)
      );
      // Also check if it's not already matched by ID
      const alreadyMatched = matchedIds.has(existing.id);
      // Include items that don't have matching combinations
      // This includes transferred items (with empty attributeCombination) or items without attribute combinations
      return !hasMatchingCombo && !alreadyMatched && (existingCombo.length === 0 || !existing.attributeCombination);
    });
    
    // Combine generated items with unmatched items (transferred items)
    const allItems = [...items, ...unmatchedItems];
    
    setGeneratedItems(allItems);
    // Update ref with new items for next regeneration
    previousGeneratedItemsRef.current = allItems;
  }, [createAttributes, attributeRows, itemGroupName, generateSkuPreview, itemSkuManuallyEdited]);

  // Copy to All handlers
  useEffect(() => {
    if (!createAttributes) {
      setManualItemsSnapshot(itemRows);
    }
  }, [createAttributes, itemRows]);

  const handleCopyToAll = (field) => {
    if (createAttributes) {
      // For generated items
      if (generatedItems.length === 0) return;
      const firstValue = generatedItems[0][field] || "";
      const updated = generatedItems.map((item) => ({
        ...item,
        [field]: firstValue,
      }));
      setGeneratedItems(updated);
      previousGeneratedItemsRef.current = updated;
    } else {
      // For manual items
      if (itemRows.length === 0) return;
      const firstValue = itemRows[0][field] || "";
      const updated = itemRows.map((item) => ({
        ...item,
        [field]: firstValue,
      }));
      setItemRows(updated);
    }
  };

  const switchToAttributeMode = () => {
    setManualItemsSnapshot(itemRows);
    // If we have itemRows and no generatedItems, convert itemRows to generatedItems
    // This preserves items when switching from manual to attribute mode
    if (itemRows.length > 0 && generatedItems.length === 0) {
      const convertedItems = itemRows.map(item => ({
        ...item,
        id: item.id || `item-${Date.now()}-${Math.random()}`,
        attributeCombination: item.attributeCombination || []
      }));
      setGeneratedItems(convertedItems);
      previousGeneratedItemsRef.current = convertedItems;
    } else if (generatedItems.length > 0) {
      // Preserve existing generatedItems
      previousGeneratedItemsRef.current = generatedItems;
    }
    setItemRows([]);
    setCreateAttributes(true);
  };

  const switchToManualMode = () => {
    setCreateAttributes(false);
    if (manualItemsSnapshot.length > 0) {
      setItemRows(
        manualItemsSnapshot.map((item) => ({
          ...item,
          id: item.id || `item-${Date.now()}-${Math.random()}`
        }))
      );
    } else if (itemRows.length === 0) {
      setItemRows([
        {
          id: Date.now(),
          name: "",
          sku: "",
          costPrice: "",
          sellingPrice: "0",
          upc: "",
          hsnCode: "",
          isbn: "",
          reorderPoint: "",
          sac: ""
        }
      ]);
    }
  };

  const handleCreateAttributesToggle = (checked) => {
    if (checked) {
      switchToAttributeMode();
    } else {
      setShowSingleItemModal(true);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!itemGroupName || itemGroupName.trim() === "") {
      alert("Item Group Name is required");
      return;
    }
    
    if (!unit || unit.trim() === "") {
      alert("Unit is required");
      return;
    }

    if (taxPreference === "non-taxable" && (!exemptionReason || exemptionReason.trim() === "")) {
      alert("Exemption reason is required for non-taxable items");
      return;
    }
    
    try {
      const normalizedIntra = taxPreference === "taxable" ? (intraStateTaxRate || "") : "";
      const normalizedInter = taxPreference === "taxable" ? (interStateTaxRate || "") : "";
      const normalizedExemption = taxPreference === "non-taxable" ? exemptionReason.trim() : "";

      // Get items (either generated or manual)
      const items = createAttributes ? generatedItems : itemRows;
      
      // Filter out items without names (required field)
      const validItems = items.filter(item => item && item.name && item.name.trim() !== "");
      
      // Check for duplicate SKUs within the items being saved
      const skuMap = new Map();
      const duplicateSkus = [];
      validItems.forEach((item, idx) => {
        if (item.sku && item.sku.trim()) {
          const sku = item.sku.trim().toUpperCase();
          if (skuMap.has(sku)) {
            duplicateSkus.push({ sku, indices: [skuMap.get(sku), idx] });
          } else {
            skuMap.set(sku, idx);
          }
        }
      });
      
      if (duplicateSkus.length > 0) {
        const duplicateSkuList = [...new Set(duplicateSkus.map(d => d.sku))].join(", ");
        alert(`Duplicate SKUs found within the group: ${duplicateSkuList}. Each item must have a unique SKU.`);
        return;
      }
      
      // Check for duplicate SKUs with existing items in database (for standalone items)
      // Note: For item groups, SKUs are unique within the group, but we should still check against standalone items
      // SKIP THIS CHECK IN EDIT MODE - SKUs are already unique
      if (!isEditMode) {
        const skusToCheck = validItems.filter(item => item.sku && item.sku.trim()).map(item => item.sku.trim().toUpperCase());
        if (skusToCheck.length > 0) {
          try {
            const checkPromises = skusToCheck.map(async (sku) => {
              const response = await fetch(`${API_ROOT}/api/shoe-sales/items?sku=${encodeURIComponent(sku)}`);
              if (response.ok) {
                const data = await response.json();
                const items = Array.isArray(data) ? data : (data.items || []);
                return items.some(item => item.sku?.toUpperCase() === sku);
              }
              return false;
            });
            
            const results = await Promise.all(checkPromises);
            const existingSkus = skusToCheck.filter((_, idx) => results[idx]);
            
            if (existingSkus.length > 0) {
              alert(`The following SKUs already exist in the system: ${existingSkus.join(", ")}. Please use different SKUs.`);
              return;
            }
          } catch (error) {
            console.error("Error checking SKU uniqueness:", error);
            // Continue with save even if check fails (network issue)
          }
        }
      }
      
      console.log("Items to save:", validItems.length, validItems);
      
      // Create item group data
      const itemGroupData = {
        name: itemGroupName.trim(),
        sku: itemGroupSku.trim(),
        itemType,
        description: description.trim(),
        unit,
        manufacturer: selectedManufacturer || "",
        brand: selectedBrand || "",
        category: category || "other",
        inventoryValuationMethod: inventoryValuation || "",
        taxPreference,
        exemptionReason: normalizedExemption,
        intraStateTaxRate: normalizedIntra,
        interStateTaxRate: normalizedInter,
        taxRateIntra: normalizedIntra,
        taxRateInter: normalizedInter,
        createAttributes,
        attributeRows: attributeRows || [],
        sellable,
        purchasable,
        returnable,
        trackInventory: itemType === "goods",
        items: validItems.map(item => {
          // Regenerate item name from attributeCombination before saving to ensure consistency
          let itemName = item.name.trim();
          if (createAttributes && item.attributeCombination && Array.isArray(item.attributeCombination) && item.attributeCombination.length > 0) {
            const optionsStr = item.attributeCombination.join("/");
            itemName = `${itemGroupName.trim()} - ${optionsStr}`;
          }
          
          return {
            _id: item._id && item._id.match(/^[0-9a-fA-F]{24}$/) ? item._id : undefined, // Only include _id if it's a valid MongoDB ObjectId
            name: itemName,
            sku: item.sku || "",
            size: item.size || "", // Include size field
            costPrice: parseFloat(item.costPrice) || 0,
            sellingPrice: parseFloat(item.sellingPrice) || 0,
            upc: item.upc || "",
            hsnCode: item.hsnCode || "",
            isbn: item.isbn || "",
            reorderPoint: item.reorderPoint || "",
            sac: item.sac || "",
            stock: parseFloat(item.stock) || 0, // Add stock field for each item
            attributeCombination: item.attributeCombination || [],
            returnable: null, // Items inherit returnable status from group
            warehouseStocks: item.warehouseStocks || [], // PRESERVE warehouse stocks
          };
        }),
        stock: 0,
        reorder: "",
      };
      
      console.log("Item group data being sent:", {
        name: itemGroupData.name,
        itemsCount: itemGroupData.items.length,
        items: itemGroupData.items
      });

      // Get user's warehouse information
      const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
      const userLocName = currentUser.username || currentUser.locName || "";
      
      // Helper function to map locName to warehouse name
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
      
      const userWarehouse = mapLocNameToWarehouse(userLocName);
      
      // Process images: extract base64 data and format properly
      const processedGroupImages = groupImages.map(img => {
        let base64Data = img.base64 || img.data || img;
        if (typeof base64Data === "string" && base64Data.startsWith("data:")) {
          base64Data = base64Data.split(",")[1] || base64Data;
        }
        return {
          filename: img.name || img.filename || "image",
          contentType: img.type || img.contentType || "image/jpeg",
          data: base64Data,
        };
      });

      // Add warehouse information to itemGroupData
      const itemGroupDataWithWarehouse = {
        ...itemGroupData,
        userWarehouse: userWarehouse,
        userLocName: userLocName,
        groupImages: processedGroupImages,
      };
      
      // Save to backend
      const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7000";
      const url = isEditMode 
        ? `${API_URL}/api/shoe-sales/item-groups/${id}`
        : `${API_URL}/api/shoe-sales/item-groups`;
      
      const response = await fetch(url, {
        method: isEditMode ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(itemGroupDataWithWarehouse),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: isEditMode ? "Failed to update item group" : "Failed to save item group" }));
        const errorMessage = errorData.errors 
          ? errorData.errors.join(", ") 
          : (errorData.message || (isEditMode ? "Failed to update item group" : "Failed to save item group"));
        
        // If it's a SKU duplicate error (409), show a clear alert
        if (response.status === 409) {
          alert(errorMessage);
          return; // Stop execution, don't navigate
        }
        
        throw new Error(errorMessage);
      }

      // Navigate to groups page or detail page
      if (isEditMode) {
        navigate(`/shoe-sales/item-groups/${id}`);
      } else {
        navigate("/shoe-sales/item-groups");
      }
    } catch (error) {
      console.error("Error saving item group:", error);
      alert(error.message || "Failed to save item group. Please try again.");
    }
  };

  // Enter key to save item group
  useEnterToSave((e) => {
    const syntheticEvent = e || { preventDefault: () => {} };
    handleSave(syntheticEvent);
  }, loading);  if (loading) {
    return (
      <div className={`transition-all duration-300 min-h-screen bg-[#F8FAFC] p-6 flex items-center justify-center ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="rounded-2xl border border-gray-200/80 bg-white shadow-md p-8 text-center max-w-sm w-full">
          <div className="w-8 h-8 border-3 border-[#A8D11E] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm font-semibold text-gray-700">Loading item group...</p>
        </div>
      </div>
    );
  }

  const selectedTaxRateValue = intraStateTaxRate || interStateTaxRate;

  // Derived values for the live summary sidebar
  const activeVariants = createAttributes ? generatedItems : itemRows;
  const variantCount = activeVariants.length;
  const sellingPrices = activeVariants
    .map((v) => parseFloat(v.sellingPrice))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const minPrice = sellingPrices.length ? Math.min(...sellingPrices) : null;
  const maxPrice = sellingPrices.length ? Math.max(...sellingPrices) : null;
  const firstGroupImage = groupImages && groupImages.length > 0 ? groupImages[0] : null;
  const firstGroupImageSrc = firstGroupImage ? (firstGroupImage.base64 || firstGroupImage) : "";


  // Header "Generate SKU" / "Clear" for the variants table
  const setAllSkus = (clear) => {
    const baseName = itemGroupName || "Item";
    if (createAttributes) {
      const sizeIdx = attributeRows.findIndex((r) => r.attribute?.toLowerCase() === "size");
      const updated = generatedItems.map((it) => {
        const size = sizeIdx !== -1 && it.attributeCombination?.[sizeIdx] ? it.attributeCombination[sizeIdx] : (it.size || "");
        return { ...it, sku: clear ? "" : generateSkuPreview(baseName, size, it.attributeCombination) };
      });
      setGeneratedItems(updated);
      previousGeneratedItemsRef.current = updated;
      setItemSkuManuallyEdited(clear ? Object.fromEntries(updated.map((it) => [it.id, true])) : {});
    } else {
      const updated = itemRows.map((it) => ({ ...it, sku: clear ? "" : generateSkuPreview(it.name || "", it.size || "") }));
      setItemRows(updated);
      setItemSkuManuallyEdited(clear ? Object.fromEntries(updated.map((it, i) => [it.id || i, true])) : {});
    }
  };
  const backTo = isEditMode ? `/shoe-sales/item-groups/${id}` : "/shoe-sales/item-groups";
  const validAttrCount = attributeRows.filter((r) => (r.attribute || "").trim() && r.options.length > 0).length;
  const steps = [
    { href: "#section-basic", label: "Basics", icon: Package, done: !!itemGroupName.trim() && !!unit },
    { href: "#section-tax", label: "Tax", icon: DollarSign, done: taxPreference === "non-taxable" ? !!exemptionReason.trim() : !!selectedTaxRateValue },
    { href: "#section-attributes", label: "Attributes", icon: Settings, done: !createAttributes || validAttrCount > 0 },
    { href: "#section-variants", label: "Variants", icon: Layers, done: variantCount > 0, count: variantCount },
  ];

  return (
    <div className="invoice-page-wrapper min-h-screen bg-[#f4f5f3] text-[#15171D]">
      <Header title={isEditMode ? "Edit Item Group" : "Create Item Group"} />

      <div className={`transition-all duration-300 ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className="p-4 sm:p-6 max-w-[1440px] mx-auto space-y-5">

        {/* ── Title bar ── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to={backTo} className={`${ui.btnOutline} h-10 w-10 px-0 shrink-0`} title={isEditMode ? "Back to details" : "Back to groups"}>
              <ArrowLeft size={16} />
            </Link>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[#15171D] text-[#C6F135] shrink-0">
              <Layers size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-tight truncate">
                {isEditMode ? "Edit Item Group" : "New Item Group"}
              </h1>
              <p className="text-sm text-gray-500 truncate">
                {isEditMode ? "Update details, tax, attributes and variants." : "One template with shared details — each size or colour becomes a variant."}
              </p>
            </div>
          </div>

          {/* Step jump */}
          <nav className="flex items-center gap-1 p-1 rounded-full bg-white border border-gray-200/80 shadow-sm">
            {steps.map((s, i) => (
              <a
                key={s.href}
                href={s.href}
                className="inline-flex items-center gap-1.5 h-8 pl-1.5 pr-3 rounded-full text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-[#15171D] transition"
              >
                <span className={`grid place-items-center w-5 h-5 rounded-full text-[10px] font-bold ${s.done ? "bg-[#C6F135] text-[#15171D]" : "bg-gray-100 text-gray-500"}`}>
                  {s.done ? <Check size={11} /> : i + 1}
                </span>
                {s.label}
                {s.count > 0 && <span className="px-1.5 rounded-full bg-[#15171D] text-[10px] font-bold text-[#C6F135]">{s.count}</span>}
              </a>
            ))}
          </nav>
        </div>

        <div className="grid grid-cols-1 gap-5 items-start">
        <div className="min-w-0 space-y-5">

        {/* ── 1. Basic information ── */}
        <SectionCard id="section-basic" step={1} title="Basic information" description="Name, unit and who makes it. Shared by every variant.">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-5 min-w-0">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={labelCls}>Item group name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={itemGroupName}
                    onChange={(e) => {
                      setItemGroupName(e.target.value);
                      if (!skuManuallyEdited) setItemGroupSku(generateSkuPreview(e.target.value));
                    }}
                    className={fieldCls}
                    placeholder="e.g. Classmate Notebook"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>SKU</label>
                    {skuManuallyEdited ? (
                      <button
                        type="button"
                        onClick={() => { setSkuManuallyEdited(false); setItemGroupSku(generateSkuPreview(itemGroupName)); }}
                        className="no-hover-anim text-[11px] font-semibold text-gray-500 hover:text-[#15171D] underline-offset-4 hover:underline"
                      >
                        Use auto SKU
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400">
                        <Info size={12} /> Auto-generated
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={itemGroupSku}
                    onChange={(e) => { setSkuManuallyEdited(true); setItemGroupSku(e.target.value.toUpperCase()); }}
                    className={`${fieldCls} font-mono`}
                    placeholder="e.g. IGRP-001"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this group? e.g. 200-page ruled notebooks, A4 and A5"
                  className={`${fieldCls} h-auto py-2.5 resize-none`}
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <UnitSelect label="Unit" required placeholder="Select or type to add" value={unit} onChange={setUnit} options={unitOptions} />
                {itemType === "goods" ? (
                  <InventoryValuationSelect label="Inventory valuation method" value={inventoryValuation} onChange={setInventoryValuation} />
                ) : <div />}
                <ManufacturerSelect
                  label="Manufacturer"
                  placeholder="Select or add manufacturer"
                  value={selectedManufacturer}
                  onChange={setSelectedManufacturer}
                  manufacturers={manufacturers}
                  onManageClick={() => setShowManufacturerModal(true)}
                />
                <BrandSelect
                  label="Brand"
                  placeholder="Select or add brand"
                  value={selectedBrand}
                  onChange={setSelectedBrand}
                  brands={brands}
                  onManageClick={() => setShowBrandModal(true)}
                />
              </div>
            </div>

            {/* Images */}
            <div className="space-y-2 min-w-0">
              <label className={labelCls}>Group images</label>
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-3">
                <ImageUpload
                  onImagesSelect={(images) => setGroupImages(images)}
                  existingImages={groupImages}
                  onRemoveImage={(index) => setGroupImages(groupImages.filter((_, i) => i !== index))}
                  multiple={true}
                />
              </div>
              <p className="text-[11px] text-gray-400">The first image is used as the cover.</p>
            </div>
          </div>
        </SectionCard>

        {/* ── 2. Tax ── */}
        <SectionCard id="section-tax" step={2} title="Tax" description="Default GST applied to every variant in this group.">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
              {[
                { v: "taxable", label: "Taxable", hint: "GST is charged on sale" },
                { v: "non-taxable", label: "Non-taxable", hint: "Exempt from GST" },
              ].map((o) => {
                const on = taxPreference === o.v;
                return (
                  <button
                    type="button"
                    key={o.v}
                    onClick={() => { setTaxPreference(o.v); if (o.v === "taxable") setExemptionReason(""); }}
                    className={`no-hover-anim flex items-start gap-3 text-left p-3.5 rounded-xl border transition ${
                      on ? "border-[#15171D] bg-[#F6FCE6] ring-2 ring-[#C6F135]/60" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className={`mt-0.5 grid place-items-center w-4 h-4 rounded-full border ${on ? "border-[#15171D] bg-[#15171D]" : "border-gray-300"}`}>
                      {on && <span className="w-1.5 h-1.5 rounded-full bg-[#C6F135]" />}
                    </span>
                    <span>
                      <span className="block text-sm font-bold">{o.label}</span>
                      <span className="block text-xs text-gray-500">{o.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {taxPreference === "non-taxable" ? (
              <div className="space-y-1.5 max-w-xl">
                <label className={labelCls}>Exemption reason <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={exemptionReason}
                  onChange={(e) => setExemptionReason(e.target.value)}
                  placeholder="e.g. Educational books (exempt)"
                  className={fieldCls}
                />
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                <TaxRateSelect label="Intra-state tax rate (CGST + SGST)" value={intraStateTaxRate} onChange={setIntraStateTaxRate} type="intra" />
                <TaxRateSelect label="Inter-state tax rate (IGST)" value={interStateTaxRate} onChange={setInterStateTaxRate} type="inter" />
                <div className="md:col-span-2">
                  <ToggleRow
                    checked={priceIncludesGST}
                    onChange={setPriceIncludesGST}
                    label="Selling price includes GST"
                    hint={priceIncludesGST ? "GST is taken out of the price you enter." : "GST is added on top of the price you enter."}
                  />
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── 3. Attributes ── */}
        <SectionCard
          id="section-attributes"
          step={3}
          title="Attributes & options"
          description="e.g. Size: A4, A5 · Colour: Red, Blue. One variant is created for each combination."
          right={<Switch checked={createAttributes} onChange={(v) => handleCreateAttributesToggle(v)} label={createAttributes ? "On" : "Off"} />}
        >
          {!createAttributes ? (
            <p className="text-sm text-gray-500">
              Attributes are off. Add variants by hand in the table below, or switch this on to generate them automatically.
            </p>
          ) : (
            <div className="space-y-3">
              {attributeRows.map((row, rowIndex) => (
                <div key={row.id} className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] items-start p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Attribute</label>
                    <input
                      type="text"
                      value={row.attribute}
                      onChange={(e) => {
                        const updated = [...attributeRows];
                        updated[rowIndex].attribute = e.target.value;
                        setAttributeRows(updated);
                      }}
                      placeholder="e.g. Size"
                      className={fieldCls}
                    />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Options <span className="normal-case font-medium tracking-normal">· press Enter after each</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-1.5 min-h-10 focus-within:border-[#A8D11E] focus-within:ring-2 focus-within:ring-[#C6F135]/30 transition">
                      {row.options.map((opt, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-[#15171D] text-xs font-semibold text-white">
                          {opt}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...attributeRows];
                              updated[rowIndex].options = updated[rowIndex].options.filter((_, i) => i !== idx);
                              setAttributeRows(updated);
                            }}
                            className="no-hover-anim grid place-items-center w-4 h-4 rounded-full text-white/70 hover:text-[#C6F135] hover:bg-white/10"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={row.optionInput}
                        onChange={(e) => {
                          const updated = [...attributeRows];
                          updated[rowIndex].optionInput = e.target.value;
                          setAttributeRows(updated);
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === ",") && row.optionInput.trim()) {
                            e.preventDefault();
                            const val = row.optionInput.trim().replace(/,$/, "");
                            const updated = [...attributeRows];
                            if (!updated[rowIndex].options.some((o) => o.toLowerCase() === val.toLowerCase())) {
                              updated[rowIndex].options = [...updated[rowIndex].options, val];
                            }
                            updated[rowIndex].optionInput = "";
                            setAttributeRows(updated);
                          } else if (e.key === "Backspace" && !row.optionInput && row.options.length) {
                            const updated = [...attributeRows];
                            updated[rowIndex].options = updated[rowIndex].options.slice(0, -1);
                            setAttributeRows(updated);
                          }
                        }}
                        data-handle-enter="true"
                        placeholder={row.options.length === 0 ? "e.g. A4, A5, B5" : "Add more…"}
                        className="no-focus-ring flex-1 min-w-[120px] h-7 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-gray-400"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttributeRows(attributeRows.filter((_, i) => i !== rowIndex))}
                    className="no-hover-anim md:mt-6 grid place-items-center h-10 w-10 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                    title="Remove attribute"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setAttributeRows([...attributeRows, { id: Date.now(), attribute: "", options: [], optionInput: "" }])}
                className={`${ui.btnOutline} h-10 px-4 text-sm border-dashed`}
              >
                <Plus size={15} /> Add attribute
              </button>
            </div>
          )}
        </SectionCard>

        {/* ── 4. Variants ── */}
        <SectionCard
          id="section-variants"
          step={4}
          title={<span className="inline-flex items-center gap-2">Variants <span className="px-2 rounded-full bg-[#15171D] text-[11px] font-bold text-[#C6F135]">{variantCount}</span></span>}
          description="Set SKU, HSN, reorder point and prices for each variant."
          bodyClass="p-0"
        >
          <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-gray-100 bg-gray-50/50">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1">Applies to all</span>
            <Switch checked={sellable} onChange={setSellable} label="Sellable" />
            <Switch checked={purchasable} onChange={setPurchasable} label="Purchasable" />
            {itemType === "goods" && <Switch checked={returnable} onChange={setReturnable} label="Returnable" />}
            {itemType === "goods" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 ml-1">
                <Check size={13} className="text-emerald-600" /> Stock is tracked
              </span>
            )}
          </div>
          <div className="p-4 sm:p-5">
            {!createAttributes && (
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setItemRows([...itemRows, { id: `item-${Date.now()}`, name: "", size: "", sku: "", costPrice: "", sellingPrice: "", upc: "", hsnCode: "", isbn: "", reorderPoint: "", sac: "" }])}
                  className={`${ui.btnLime} h-9 px-4 text-xs`}
                >
                  <Plus size={14} /> Add variant
                </button>
              </div>
            )}
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded-xl border border-gray-200/80">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-[#15171D] sticky top-0 z-10">
                  <tr>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>{createAttributes ? "Item" : "Item Name*"}</div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>Size</div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>SKU</div>
                      <div className="mt-1 flex gap-1.5 text-[10px] font-medium normal-case">
                        <button type="button" onClick={() => setAllSkus(false)} className="no-hover-anim px-1.5 py-0.5 rounded bg-[#C6F135] text-[#15171D] hover:bg-[#B8E62A] transition">Generate SKU</button>
                        <button type="button" onClick={() => setAllSkus(true)} className="no-hover-anim px-1.5 py-0.5 rounded bg-white/10 text-white/80 hover:bg-white/20 transition">Clear</button>
                      </div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>HSN Code</div>
                      <div className="mt-1 flex gap-1.5 text-[10px] font-medium normal-case">
                        <button 
                          onClick={() => handleCopyToAll("hsnCode")}
                          type="button" className="no-hover-anim px-1.5 py-0.5 rounded bg-white/10 text-white/80 hover:bg-[#C6F135] hover:text-[#15171D] transition"
                        >
                          Copy to All
                        </button>
                      </div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>Reorder Point</div>
                      <div className="mt-1 flex gap-1.5 text-[10px] font-medium normal-case">
                        <button 
                          onClick={() => handleCopyToAll("reorderPoint")}
                          type="button" className="no-hover-anim px-1.5 py-0.5 rounded bg-white/10 text-white/80 hover:bg-[#C6F135] hover:text-[#15171D] transition"
                        >
                          Copy to All
                        </button>
                      </div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>Cost Price (₹)*</div>
                      <div className="mt-1 flex gap-1.5 text-[10px] font-medium normal-case">
                        <button 
                          onClick={() => handleCopyToAll("costPrice")}
                          type="button" className="no-hover-anim px-1.5 py-0.5 rounded bg-white/10 text-white/80 hover:bg-[#C6F135] hover:text-[#15171D] transition"
                        >
                          Copy to All
                        </button>
                      </div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>Selling Price (₹)*</div>
                      <div className="mt-1 flex gap-1.5 text-[10px] font-medium normal-case">
                        <button 
                          onClick={() => handleCopyToAll("sellingPrice")}
                          type="button" className="no-hover-anim px-1.5 py-0.5 rounded bg-white/10 text-white/80 hover:bg-[#C6F135] hover:text-[#15171D] transition"
                        >
                          Copy to All
                        </button>
                      </div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top">
                      <div>Price with GST (₹)</div>
                    </th>
                    <th className="px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white whitespace-nowrap align-top"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {!createAttributes ? (
                    <>
                      {itemRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-4 py-8 text-center text-sm font-medium text-gray-400"
                          >
                            No manual items configured
                          </td>
                        </tr>
                      )}
                      {itemRows.map((item, idx) => (
                        <tr key={item.id || idx} className={`hover:bg-[#F6FCE6]/60 transition-colors ${idx % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].name = e.target.value;
                                if (!itemSkuManuallyEdited[item.id || idx]) {
                                  updated[idx].sku = generateSkuPreview(e.target.value, item.size || "");
                                }
                                setItemRows(updated);
                              }}
                              placeholder="Item Name"
                              className={cellCls}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.size || ""}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].size = e.target.value;
                                if (!itemSkuManuallyEdited[item.id || idx]) {
                                  updated[idx].sku = generateSkuPreview(item.name || "", e.target.value);
                                }
                                setItemRows(updated);
                              }}
                              placeholder="Size"
                              className={cellCls}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.sku}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].sku = e.target.value.toUpperCase();
                                setItemRows(updated);
                                setItemSkuManuallyEdited(prev => ({ ...prev, [item.id || idx]: true }));
                              }}
                              onFocus={(e) => {
                                if (!item.sku && !itemSkuManuallyEdited[item.id || idx] && item.name) {
                                  const updated = [...itemRows];
                                  updated[idx].sku = generateSkuPreview(item.name, item.size || "");
                                  setItemRows(updated);
                                }
                              }}
                              placeholder="Auto-generated"
                              className={`${cellCls} font-mono`}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.hsnCode || ""}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].hsnCode = e.target.value;
                                setItemRows(updated);
                              }}
                              placeholder="HSN"
                              className={cellCls}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.reorderPoint || ""}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].reorderPoint = e.target.value;
                                setItemRows(updated);
                              }}
                              placeholder="Qty"
                              className={cellCls}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.costPrice}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].costPrice = e.target.value;
                                setItemRows(updated);
                              }}
                              placeholder="0.00"
                              className={`${cellCls} font-mono`}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={item.sellingPrice}
                              onChange={(e) => {
                                const updated = [...itemRows];
                                updated[idx].sellingPrice = e.target.value;
                                setItemRows(updated);
                              }}
                              placeholder="0.00"
                              className={`${cellCls} font-mono`}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            {(() => {
                              const gstDetails = calculateGSTDetails(
                                item.sellingPrice,
                                selectedTaxRateValue,
                                priceIncludesGST
                              );
                              if (!gstDetails) {
                                return <span className="text-xs text-gray-400 font-mono">—</span>;
                              }
                              return priceIncludesGST ? (
                                <div className="text-[11px] font-mono space-y-0.5">
                                  <div className="text-gray-600">Base: ₹{gstDetails.basePrice}</div>
                                  <div className="text-[#15171D] font-bold">Total: ₹{gstDetails.finalPrice}</div>
                                </div>
                              ) : (
                                <div className="text-[11px] font-mono space-y-0.5">
                                  <div className="text-[#15171D] font-bold">Total: ₹{gstDetails.finalPrice}</div>
                                  <div className="text-gray-500">GST ({gstDetails.percentage}%): ₹{gstDetails.gstAmount}</div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => {
                                const confirmDelete = window.confirm(`Are you sure you want to delete "${item.name || "this item"}"?`);
                                if (confirmDelete) {
                                  setItemRows(itemRows.filter((_, i) => i !== idx));
                                }
                              }}
                              className="h-7 w-7 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 transition flex items-center justify-center cursor-pointer"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : createAttributes && generatedItems.length > 0 ? (
                    generatedItems.map((item, idx) => {
                      let displayName = item.name;
                      if (item.attributeCombination && Array.isArray(item.attributeCombination) && item.attributeCombination.length > 0) {
                        const optionsStr = item.attributeCombination.join("/");
                        displayName = `${itemGroupName || "Item"} - ${optionsStr}`;
                      }
                      
                      const sizeAttributeIndex = attributeRows.findIndex(row => row.attribute?.toLowerCase() === "size");
                      const sizeValue = sizeAttributeIndex !== -1 && item.attributeCombination && item.attributeCombination[sizeAttributeIndex] 
                        ? item.attributeCombination[sizeAttributeIndex] 
                        : (item.size || "");
                      
                      const baseName = itemGroupName || "Item";
                      
                      return (
                      <tr key={item.id} className={`hover:bg-[#F6FCE6]/60 transition-colors ${idx % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                        <td className="px-3.5 py-3 text-xs font-semibold text-gray-900">
                          <div className="flex items-center gap-2">
                            <span>{displayName}</span>
                            <button
                              onClick={() => {
                                const newName = window.prompt("Enter item name", item.name);
                                if (newName !== null) {
                                  const trimmedName = newName.trim();
                                  if (trimmedName !== "") {
                                    const updated = [...generatedItems];
                                    updated[idx].name = trimmedName;
                                    if (!itemSkuManuallyEdited[item.id]) {
                                      updated[idx].sku = generateSkuPreview(baseName, sizeValue, item.attributeCombination);
                                    }
                                    setGeneratedItems(updated);
                                    previousGeneratedItemsRef.current = updated;
                                  }
                                }
                              }}
                              className="h-5 w-5 rounded-md bg-[#F6FCE6] text-[#15171D] hover:bg-[#F6FCE6] flex items-center justify-center transition cursor-pointer"
                              title="Rename Item"
                            >
                              <Edit size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={sizeValue}
                            onChange={(e) => {
                              const updated = [...generatedItems];
                              const newSize = e.target.value;
                              updated[idx].size = newSize;
                              if (sizeAttributeIndex !== -1 && updated[idx].attributeCombination) {
                                updated[idx].attributeCombination[sizeAttributeIndex] = newSize;
                              }
                              if (!itemSkuManuallyEdited[item.id]) {
                                updated[idx].sku = generateSkuPreview(baseName, newSize, updated[idx].attributeCombination);
                              }
                              setGeneratedItems(updated);
                              previousGeneratedItemsRef.current = updated;
                            }}
                            placeholder="Size"
                            className={cellCls}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={item.sku}
                            onChange={(e) => {
                              const updated = [...generatedItems];
                              updated[idx].sku = e.target.value.toUpperCase();
                              setGeneratedItems(updated);
                              previousGeneratedItemsRef.current = updated;
                              setItemSkuManuallyEdited(prev => ({ ...prev, [item.id]: true }));
                            }}
                            onFocus={(e) => {
                              if (!item.sku && !itemSkuManuallyEdited[item.id] && baseName) {
                                const updated = [...generatedItems];
                                updated[idx].sku = generateSkuPreview(baseName, sizeValue, item.attributeCombination);
                                setGeneratedItems(updated);
                                previousGeneratedItemsRef.current = updated;
                              }
                            }}
                            placeholder="Auto-generated"
                            className={`${cellCls} font-mono`}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={item.hsnCode || ""}
                            onChange={(e) => {
                              const updated = [...generatedItems];
                              updated[idx].hsnCode = e.target.value;
                              setGeneratedItems(updated);
                              previousGeneratedItemsRef.current = updated;
                            }}
                            placeholder="HSN"
                            className={cellCls}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={item.reorderPoint || ""}
                            onChange={(e) => {
                              const updated = [...generatedItems];
                              updated[idx].reorderPoint = e.target.value;
                              setGeneratedItems(updated);
                              previousGeneratedItemsRef.current = updated;
                            }}
                            placeholder="Qty"
                            className={cellCls}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={item.costPrice}
                            onChange={(e) => {
                              const updated = [...generatedItems];
                              updated[idx].costPrice = e.target.value;
                              setGeneratedItems(updated);
                            }}
                            placeholder="0.00"
                            className={`${cellCls} font-mono`}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={item.sellingPrice}
                            onChange={(e) => {
                              const updated = [...generatedItems];
                              updated[idx].sellingPrice = e.target.value;
                              setGeneratedItems(updated);
                            }}
                            placeholder="0.00"
                            className={`${cellCls} font-mono`}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          {(() => {
                            const gstDetails = calculateGSTDetails(
                              item.sellingPrice,
                              selectedTaxRateValue,
                              priceIncludesGST
                            );
                            if (!gstDetails) {
                              return <span className="text-xs text-gray-400 font-mono">—</span>;
                            }
                            return priceIncludesGST ? (
                              <div className="text-[11px] font-mono space-y-0.5">
                                <div className="text-gray-600">Base: ₹{gstDetails.basePrice}</div>
                                <div className="text-[#15171D] font-bold">Total: ₹{gstDetails.finalPrice}</div>
                              </div>
                            ) : (
                              <div className="text-[11px] font-mono space-y-0.5">
                                <div className="text-[#15171D] font-bold">Total: ₹{gstDetails.finalPrice}</div>
                                <div className="text-gray-500">GST ({gstDetails.percentage}%): ₹{gstDetails.gstAmount}</div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2.5">
                          <button 
                            onClick={() => {
                              const confirmDelete = window.confirm(`Are you sure you want to delete "${displayName}"?`);
                              if (confirmDelete) {
                                const updated = generatedItems.filter((_, i) => i !== idx);
                                setGeneratedItems(updated);
                                previousGeneratedItemsRef.current = updated;
                              }
                            }}
                            className="h-7 w-7 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 transition flex items-center justify-center cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center text-sm font-medium text-gray-400"
                      >
                        Please enter attributes and options to generate items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>

        {/* Bottom actions (in page flow, never covers content) */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-gray-200/80 shadow-sm px-5 py-4">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-[#15171D]">{variantCount}</span> {createAttributes ? "variant(s) generated" : "variant(s) added"}
            {minPrice !== null && <> · {minPrice === maxPrice ? `₹${minPrice}` : `₹${minPrice} – ₹${maxPrice}`}</>}
          </p>
          <div className="flex items-center gap-2">
            <Link to={backTo} className={`${ui.btnOutline} h-11 px-5 text-sm`}>Cancel</Link>
            <button type="button" onClick={handleSave} className={`${ui.btnPrimary} h-11 px-6 text-sm`}>
              <Check size={15} /> {isEditMode ? "Update item group" : "Save item group"}
            </button>
          </div>
        </div>

        </div>
        {/* End left column */}

        </div>
        {/* End grid */}
        </div>
      </div>

      {/* Manufacturer Modal */}
      {showManufacturerModal && (
        <ManufacturerModal
          onClose={() => {
            setShowManufacturerModal(false);
            setNewManufacturer("");
          }}
          onAdd={async (name) => {
            if (name.trim()) {
              try {
                const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
                const createdBy = currentUser.username || currentUser.locName || "System";
                
                const response = await fetch(`${API_ROOT}/api/shoe-sales/manufacturers`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: name.trim(),
                    createdBy: createdBy,
                  }),
                });
                
                if (response.ok) {
                  const data = await response.json();
                  const manufacturerName = data.name;
                  setManufacturers((prev) =>
                    prev.includes(manufacturerName) ? prev : [...prev, manufacturerName]
                  );
                  setSelectedManufacturer(manufacturerName);
                  setShowManufacturerModal(false);
                  setNewManufacturer("");
                } else {
                  const errorData = await response.json().catch(() => ({ message: "Failed to create manufacturer" }));
                  alert(errorData.message || "Failed to create manufacturer. Please try again.");
                }
              } catch (error) {
                console.error("Error creating manufacturer:", error);
                alert("Failed to create manufacturer. Please try again.");
              }
            }
          }}
          newManufacturer={newManufacturer}
          setNewManufacturer={setNewManufacturer}
        />
      )}

      {/* Brand Modal */}
      {showBrandModal && (
        <BrandModal
          onClose={() => {
            setShowBrandModal(false);
            setNewBrand("");
          }}
          onAdd={async (name) => {
            if (name.trim()) {
              try {
                const currentUser = JSON.parse(localStorage.getItem("rootfinuser")) || {};
                const createdBy = currentUser.username || currentUser.locName || "System";
                
                const response = await fetch(`${API_ROOT}/api/shoe-sales/brands`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: name.trim(),
                    createdBy: createdBy,
                  }),
                });
                
                if (response.ok) {
                  const data = await response.json();
                  const brandName = data.name;
                  setBrands((prev) =>
                    prev.includes(brandName) ? prev : [...prev, brandName]
                  );
                  setSelectedBrand(brandName);
                  setShowBrandModal(false);
                  setNewBrand("");
                } else {
                  const errorData = await response.json().catch(() => ({ message: "Failed to create brand" }));
                  alert(errorData.message || "Failed to create brand. Please try again.");
                }
              } catch (error) {
                console.error("Error creating brand:", error);
                alert("Failed to create brand. Please try again.");
              }
            }
          }}
          newBrand={newBrand}
          setNewBrand={setNewBrand}
        />
      )}

      {/* Single Item Confirmation Modal */}
      {showSingleItemModal && (
        <SingleItemModal
          onYes={() => {
            switchToManualMode();
            setShowSingleItemModal(false);
          }}
          onNo={() => {
            setShowSingleItemModal(false);
          }}
          onClose={() => {
            setShowSingleItemModal(false);
            setCreateAttributes(true);
          }}
        />
      )}
    </div>
  );
};


// ── Layout helpers (ink + lime) ───────────────────────────────────────
const labelCls = "block text-xs font-semibold text-gray-700";
const fieldCls =
  "no-focus-ring w-full h-10 rounded-xl border border-gray-200 bg-white px-3.5 text-sm text-[#15171D] placeholder:text-gray-400 outline-none transition hover:border-gray-300 focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30";
const cellCls =
  "no-focus-ring w-full h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-[#15171D] placeholder:text-gray-400 outline-none transition hover:border-gray-300 focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30";

const SectionCard = ({ id, step, title, description, right, bodyClass = "p-6", children }) => (
  <section id={id} className="scroll-mt-24 bg-white rounded-2xl border border-gray-200/80 shadow-sm">
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gray-100">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-6 h-6 mt-0.5 rounded-full bg-[#15171D] text-[11px] font-bold text-[#C6F135] shrink-0">{step}</span>
        <div>
          <h2 className="text-[15px] font-bold tracking-tight text-[#15171D]">{title}</h2>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {right}
    </div>
    <div className={bodyClass}>{children}</div>
  </section>
);

const Switch = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={!!checked}
    onClick={() => onChange(!checked)}
    className={`no-hover-anim inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border text-xs font-semibold transition ${
      checked ? "border-[#15171D] bg-[#15171D] text-white" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
    }`}
  >
    <span className={`relative w-8 h-5 rounded-full transition ${checked ? "bg-[#C6F135]" : "bg-gray-200"}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-all ${checked ? "left-[14px] bg-[#15171D]" : "left-0.5 bg-white"}`} />
    </span>
    {label}
  </button>
);

const ToggleRow = ({ checked, onChange, label, hint }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="no-hover-anim w-full flex items-center justify-between gap-4 text-left p-3.5 rounded-xl border border-gray-200 bg-gray-50/60 hover:border-gray-300 transition"
  >
    <span>
      <span className="block text-sm font-semibold text-[#15171D]">{label}</span>
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </span>
    <span className={`relative w-10 h-6 rounded-full shrink-0 transition ${checked ? "bg-[#15171D]" : "bg-gray-200"}`}>
      <span className={`absolute top-1 w-4 h-4 rounded-full transition-all ${checked ? "left-5 bg-[#C6F135]" : "left-1 bg-white shadow-sm"}`} />
    </span>
  </button>
);

const InventoryValuationSelect = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  const options = [
    "FIFO (First In First Out)",
    "WAC (Weighted Average Costing)",
    "LIFO (Last In First Out)",
  ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return options;
    }
    return options.filter((o) => o.toLowerCase().includes(term));
  }, [search]);

  const displayValue = value || "";

  return (
    <div className="relative flex w-full flex-col gap-1.5 text-sm" ref={containerRef}>
      <span className="text-xs font-semibold text-gray-700">{label}</span>
      <div
        className={`flex h-10 items-center justify-between rounded-xl border px-3.5 text-sm transition ${
          open ? "border-[#A8D11E] ring-2 ring-[#C6F135]/40" : "border-gray-200 hover:border-gray-300"
        } bg-white text-gray-900 cursor-pointer`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={value ? "text-gray-900 font-medium" : "text-gray-400"}>{displayValue || "Select valuation method"}</span>
        <ChevronDown
          size={16}
          className={`ml-3 text-gray-400 transition-transform duration-200 ${open ? "rotate-180 text-[#15171D]" : "rotate-0"}`}
        />
      </div>
      {open && (
        <div className="absolute top-full z-50 mt-1.5 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5 bg-gray-50/50">
            <Search size={14} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search..."
              className="h-7 w-full border-none text-xs text-gray-900 outline-none placeholder:text-gray-400 bg-transparent"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">No matching results</p>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = value === option;
                return (
                  <div
                    key={option}
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`flex items-center justify-between px-3.5 py-2 text-xs cursor-pointer transition ${
                      isSelected
                        ? "bg-[#F6FCE6] font-bold text-[#15171D]"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span>{option}</span>
                    {isSelected && <Check size={14} className="text-[#15171D]" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SingleItemModal = ({ onYes, onNo, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs px-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-gray-100 bg-white shadow-2xl p-6 overflow-hidden">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition"
        >
          <X size={18} />
        </button>
        <div>
          <h2 className="mb-6 text-lg font-bold text-gray-900">Do you want to create a single item?</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <button
              onClick={onYes}
              className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[#DEF39A] bg-[#F6FCE6]/50 p-6 text-center transition hover:bg-[#F6FCE6]/70 hover:border-[#DEF39A] cursor-pointer shadow-2xs"
            >
              <div className="w-10 h-10 rounded-xl bg-[#15171D] text-white flex items-center justify-center shadow-xs">
                <ShoppingBag size={20} />
              </div>
              <p className="text-xs font-semibold text-[#15171D] leading-relaxed">
                Yes, proceed to create a single standalone item.
              </p>
            </button>
            <button
              onClick={onNo}
              className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50/50 p-6 text-center transition hover:bg-gray-100 hover:border-gray-300 cursor-pointer shadow-2xs"
            >
              <div className="w-10 h-10 rounded-xl bg-gray-800 text-white flex items-center justify-center shadow-xs">
                <ShoppingCart size={20} />
              </div>
              <p className="text-xs font-semibold text-gray-800 leading-relaxed">
                No, continue on this page to create grouped items.
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShoeSalesItemGroupCreate;

const FloatingCheckbox = ({ label, defaultChecked = false, checked, onChange }) => {
  const isChecked = checked !== undefined ? checked : defaultChecked;
  return (
    <label className="inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 cursor-pointer hover:border-[#DEF39A] hover:bg-[#F6FCE6]/30 transition select-none shadow-2xs">
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onChange}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-gray-200 peer-checked:bg-[#15171D] transition-colors duration-200" />
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-4" />
      </span>
      {label}
    </label>
  );
};

const UnitSelect = ({ label, placeholder, value, onChange, options = [], required = false }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return options;
    }
    return options.filter((o) => o.toLowerCase().includes(term));
  }, [options, search]);

  const displayValue = value || "";

  return (
    <div className="relative flex w-full flex-col gap-1.5 text-sm" ref={containerRef}>
      <span className="text-xs font-semibold text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </span>
      <div
        className={`flex h-10 items-center justify-between rounded-xl border px-3.5 text-sm transition ${
          open ? "border-[#A8D11E] ring-2 ring-[#C6F135]/40" : "border-gray-200 hover:border-gray-300"
        } bg-white text-gray-900 cursor-pointer`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={value ? "text-gray-900 font-medium" : "text-gray-400"}>{displayValue || placeholder}</span>
        <ChevronDown
          size={16}
          className={`ml-3 text-gray-400 transition-transform duration-200 ${open ? "rotate-180 text-[#15171D]" : "rotate-0"}`}
        />
      </div>
      {open && (
        <div className="absolute top-full z-50 mt-1.5 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5 bg-gray-50/50">
            <Search size={14} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim() && !filteredOptions.includes(search.trim())) {
                  e.preventDefault();
                  onChange(search.trim());
                  setOpen(false);
                  setSearch("");
                }
              }}
              placeholder="Select or type to add..."
              className="h-7 w-full border-none bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 && search.trim() ? (
              <div
                onClick={() => {
                  onChange(search.trim());
                  setOpen(false);
                  setSearch("");
                }}
                className="flex w-full items-center px-3.5 py-2.5 text-left text-xs cursor-pointer transition font-bold text-[#15171D] hover:bg-[#F6FCE6]"
              >
                + Add "{search.trim()}"
              </div>
            ) : filteredOptions.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">No matching results</p>
            ) : (
              <>
                {search.trim() && !filteredOptions.includes(search.trim()) && (
                  <div
                    onClick={() => {
                      onChange(search.trim());
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex w-full items-center px-3.5 py-2.5 text-left text-xs cursor-pointer transition font-bold text-[#15171D] hover:bg-[#F6FCE6] border-b border-gray-100"
                  >
                    + Add "{search.trim()}"
                  </div>
                )}
                {filteredOptions.map((option) => {
                  const isSelected = value === option;
                  return (
                    <div
                      key={option}
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={`flex w-full items-center px-3.5 py-2 text-left text-xs cursor-pointer transition ${
                        isSelected
                          ? "bg-[#F6FCE6] font-bold text-[#15171D]"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {option}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ManufacturerSelect = ({ label, placeholder, value, onChange, manufacturers = [], onManageClick }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredManufacturers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return manufacturers;
    }
    return manufacturers.filter((m) => m.toLowerCase().includes(term));
  }, [manufacturers, search]);

  const displayValue = value || "";

  return (
    <div className="relative flex w-full flex-col gap-1.5 text-sm" ref={containerRef}>
      <span className="text-xs font-semibold text-gray-700">{label}</span>
      <div
        className={`flex h-10 items-center justify-between rounded-xl border px-3.5 text-sm transition ${
          open ? "border-[#A8D11E] ring-2 ring-[#C6F135]/40" : "border-gray-200 hover:border-gray-300"
        } bg-white text-gray-900 cursor-pointer`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={displayValue ? "text-gray-900 font-medium" : "text-gray-400"}>{displayValue || placeholder}</span>
        <ChevronDown
          size={16}
          className={`ml-3 text-gray-400 transition-transform duration-200 ${open ? "rotate-180 text-[#15171D]" : "rotate-0"}`}
        />
      </div>
      {open && (
        <div className="absolute top-full z-50 mt-1.5 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5 bg-gray-50/50">
            <Search size={14} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search manufacturer..."
              className="h-7 w-full border-none text-xs text-gray-900 outline-none placeholder:text-gray-400 bg-transparent"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredManufacturers.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">No matching results</p>
            ) : (
              filteredManufacturers.map((manufacturer) => {
                const isSelected = value === manufacturer;
                return (
                  <button
                    key={manufacturer}
                    type="button"
                    onClick={() => {
                      onChange(manufacturer);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`flex w-full items-center px-3.5 py-2 text-left text-xs transition ${
                      isSelected
                        ? "bg-[#F6FCE6] font-bold text-[#15171D]"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {manufacturer}
                  </button>
                );
              })
            )}
          </div>
          {onManageClick && (
            <div className="border-t border-gray-100 px-3.5 py-2 bg-gray-50/50">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManageClick();
                  setOpen(false);
                  setSearch("");
                }}
                className="flex w-full items-center gap-2 text-xs font-semibold text-[#15171D] hover:text-[#15171D] transition"
              >
                <Settings size={13} />
                Manage Manufacturers
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ManufacturerModal = ({ onClose, onAdd, newManufacturer, setNewManufacturer }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (newManufacturer.trim()) {
      onAdd(newManufacturer.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-gray-100 bg-white shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-gradient-to-r from-gray-50/80 to-white">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Add Manufacturer</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-gray-700">
              Manufacturer Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newManufacturer}
              onChange={(e) => setNewManufacturer(e.target.value)}
              placeholder="Enter manufacturer name"
              className="w-full h-10 rounded-xl border border-gray-200 bg-white px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/40 transition outline-none"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newManufacturer.trim()}
              className="rounded-xl bg-[#15171D] px-5 py-2 text-xs font-bold text-white transition hover:bg-black shadow-sm shadow-black/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Manufacturer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const BrandSelect = ({ label, placeholder, value, onChange, brands = [], onManageClick }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredBrands = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return brands;
    }
    return brands.filter((b) => b.toLowerCase().includes(term));
  }, [brands, search]);

  const displayValue = value || "";

  return (
    <div className="relative flex w-full flex-col gap-1.5 text-sm" ref={containerRef}>
      <span className="text-xs font-semibold text-gray-700">{label}</span>
      <div
        className={`flex h-10 items-center justify-between rounded-xl border px-3.5 text-sm transition ${
          open ? "border-[#A8D11E] ring-2 ring-[#C6F135]/40" : "border-gray-200 hover:border-gray-300"
        } bg-white text-gray-900 cursor-pointer`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={displayValue ? "text-gray-900 font-medium" : "text-gray-400"}>{displayValue || placeholder}</span>
        <ChevronDown
          size={16}
          className={`ml-3 text-gray-400 transition-transform duration-200 ${open ? "rotate-180 text-[#15171D]" : "rotate-0"}`}
        />
      </div>
      {open && (
        <div className="absolute top-full z-50 mt-1.5 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5 bg-gray-50/50">
            <Search size={14} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search brand..."
              className="h-7 w-full border-none bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredBrands.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">No matching results</p>
            ) : (
              filteredBrands.map((brand) => {
                const isSelected = value === brand;
                return (
                  <div
                    key={brand}
                    onClick={() => {
                      onChange(brand);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`flex w-full items-center px-3.5 py-2 text-left text-xs cursor-pointer transition ${
                      isSelected
                        ? "bg-[#F6FCE6] font-bold text-[#15171D]"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {brand}
                  </div>
                );
              })
            )}
          </div>
          {onManageClick && (
            <div className="border-t border-gray-100 px-3.5 py-2 bg-gray-50/50">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManageClick();
                  setOpen(false);
                  setSearch("");
                }}
                className="flex w-full items-center gap-2 text-xs font-semibold text-[#15171D] hover:text-[#15171D] transition"
              >
                <Settings size={13} />
                Manage Brands
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const BrandModal = ({ onClose, onAdd, newBrand, setNewBrand }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (newBrand.trim()) {
      onAdd(newBrand.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-gray-100 bg-white shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-gradient-to-r from-gray-50/80 to-white">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Add Brand</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-gray-700">
              Brand Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              placeholder="Enter brand name"
              className="w-full h-10 rounded-xl border border-gray-200 bg-white px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/40 transition outline-none"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newBrand.trim()}
              className="rounded-xl bg-[#15171D] px-5 py-2 text-xs font-bold text-white transition hover:bg-black shadow-sm shadow-black/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Brand
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TaxRateSelect = ({ label, value, onChange, type }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  const taxRateOptions = type === "intra" 
    ? [
        "GST0 [0%]",
        "GST5 [5%]",
        "GST12 [12%]",
        "GST18 [18%]",
        "GST28 [28%]",
      ]
    : [
        "IGST0 [0%]",
        "IGST5 [5%]",
        "IGST12 [12%]",
        "IGST18 [18%]",
        "IGST28 [28%]",
      ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return taxRateOptions;
    }
    return taxRateOptions.filter((o) => o.toLowerCase().includes(term));
  }, [search, taxRateOptions]);

  const displayValue = value || "";

  return (
    <div className="relative flex w-full flex-col gap-1.5 text-sm" ref={containerRef}>
      <label className="text-xs font-semibold text-gray-700">
        {label}
      </label>
      <div
        className={`flex h-10 items-center justify-between rounded-xl border px-3.5 text-sm transition ${
          open ? "border-[#A8D11E] ring-2 ring-[#C6F135]/40" : "border-gray-200 hover:border-gray-300"
        } bg-white text-gray-900 cursor-pointer`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={value ? "text-gray-900 font-medium" : "text-gray-400"}>
          {displayValue || "Select tax rate"}
        </span>
        <ChevronDown
          size={16}
          className={`ml-3 text-gray-400 transition-transform duration-200 ${open ? "rotate-180 text-[#15171D]" : "rotate-0"}`}
        />
      </div>
      {open && (
        <div className="absolute top-full z-50 mt-1.5 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5 bg-gray-50/50">
            <Search size={14} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tax rate..."
              className="h-7 w-full border-none bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">No matching results</p>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = value === option;
                return (
                  <div
                    key={option}
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`flex items-center justify-between px-3.5 py-2 text-xs cursor-pointer transition ${
                      isSelected
                        ? "bg-[#F6FCE6] font-bold text-[#15171D]"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span>{option}</span>
                    {isSelected && <Check size={14} className="text-[#15171D]" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};