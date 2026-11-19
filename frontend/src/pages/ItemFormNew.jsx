import React, { useState, useRef, useEffect } from 'react';
import Header from '../components/Header';
import { useNavigate, useParams } from 'react-router-dom';
import { useSidebar } from '../hooks/useSidebar.js';
import baseUrl from '../api/api.js';

const API_ROOT = baseUrl?.baseUrl?.replace(/\/$/, '') || '';
import {
  Settings, ChevronDown, Bold, Italic, Underline, List, ListOrdered, Code, Table as TableIcon, ArrowLeft,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 *  New Item form — clean dense ERP layout (UI shell).
 *  Local state only; wire to your backend in handleSave later.
 * ------------------------------------------------------------------ */

const SectionCard = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-visible">
    <div className="flex items-center gap-2 px-6 py-3.5 border-b border-gray-100 rounded-t-2xl bg-gradient-to-r from-gray-50/70 to-white">
      <Settings size={16} className="text-[#A8D11E]" />
      <h2 className="text-[15px] font-bold tracking-tight text-[#15171D]">{title}</h2>
    </div>
    <div className="p-6">{children}</div>
  </div>
);

const Label = ({ children, required, right }) => (
  <div className="flex items-center justify-between mb-1.5">
    <label className="text-[13px] font-semibold text-gray-800">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {right}
  </div>
);

const inputCls =
  'w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30';

const Field = ({ label, required, placeholder, value, onChange, right, error, type = 'text' }) => (
  <div>
    <Label required={required} right={right}>{label}</Label>
    <input type={type} className={inputCls} placeholder={placeholder} value={value} onChange={onChange} />
    {error && <p className="text-[11px] font-medium text-red-500 mt-1">{error}</p>}
  </div>
);

const Select = ({ label, required, placeholder, value, onChange, options = [], error }) => (
  <div>
    <Label required={required}>{label}</Label>
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        className={`${inputCls} appearance-none pr-9 cursor-pointer ${value ? 'text-gray-900' : 'text-gray-400'}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} className="text-gray-900">{o}</option>
        ))}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
    {error && <p className="text-[11px] font-medium text-red-500 mt-1">{error}</p>}
  </div>
);

const Money = ({ label, required, value, onChange, placeholder = '0.00' }) => (
  <div>
    <Label required={required}>{label}</Label>
    <div className="flex items-stretch rounded-lg border border-gray-200 bg-white overflow-hidden transition focus-within:border-[#A8D11E] focus-within:ring-2 focus-within:ring-[#C6F135]/30">
      <span className="grid place-items-center w-9 bg-gray-50 border-r border-gray-200 text-gray-500 text-sm shrink-0">₹</span>
      <input type="number" className="w-full h-10 px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none bg-transparent" placeholder={placeholder} value={value} onChange={onChange} />
    </div>
  </div>
);

const Check = ({ label, checked, onChange }) => (
  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
    <span
      onClick={() => onChange(!checked)}
      className={`grid place-items-center w-5 h-5 rounded-[6px] border transition ${checked ? 'bg-[#15171D] border-[#15171D]' : 'bg-white border-gray-300 hover:border-gray-400'}`}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#C6F135" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </span>
    <span className="text-[13px] font-medium text-gray-700">{label}</span>
  </label>
);

const ItemFormNew = () => {
  const navigate = useNavigate();
  const isSidebarOpen = useSidebar();
  const descRef = useRef(null);
  const { itemId } = useParams();
  const isEdit = Boolean(itemId);

  const [original, setOriginal] = useState(null);
  const [saving, setSaving] = useState(false);

  const [f, setF] = useState({
    itemCode: '', autoGenerate: true, productName: '', printName: '',
    category: '', subCategory: '', brand: '', subBrand: '', unit: 'pcs',
    hsnCode: '', purchaseTax: '', purchaseInclusive: false, salesTax: '', salesInclusive: true,
    cess: false, manageBatch: false, shortDesc: '',
    purchasePrice: '', landingCost: '', mrp: '', sellingDiscount: '', sellingPrice: '', sellingMargin: '',
    minQty: '', openingQty: '', membershipMargin: '', netWeight: '',
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  const taxOptions = ['GST0 [0%]', 'GST5 [5%]', 'GST12 [12%]', 'GST18 [18%]', 'GST28 [28%]'];

  const exec = (cmd) => { document.execCommand(cmd, false, null); descRef.current?.focus(); };

  // Prefill from the real item when editing a standalone item.
  useEffect(() => {
    if (!isEdit) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_ROOT}/api/shoe-sales/items/${itemId}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        if (!active) return;
        setOriginal(data);
        setF((p) => ({
          ...p,
          itemCode: data.sku || '',
          autoGenerate: false,
          productName: data.itemName || '',
          printName: data.printName || data.itemName || '',
          brand: data.brand || '',
          unit: (data.unit || 'pcs'),
          hsnCode: data.hsnCode || '',
          shortDesc: data.salesDescription || data.shortDescription || '',
          purchasePrice: data.costPrice != null ? String(data.costPrice) : '',
          sellingPrice: data.sellingPrice != null ? String(data.sellingPrice) : '',
          mrp: data.mrp != null ? String(data.mrp) : '',
          minQty: data.reorderPoint != null ? String(data.reorderPoint) : '',
          netWeight: data.weight != null ? String(data.weight) : '',
        }));
        if (descRef.current && (data.description || data.salesDescription)) {
          descRef.current.innerHTML = data.description || '';
        }
      } catch (e) {
        console.error('Failed to load item', e);
        alert('Failed to load item data.');
      }
    })();
    return () => { active = false; };
  }, [isEdit, itemId]);

  const handleSave = async () => {
    const req = isEdit
      ? { productName: 'Enter product name' }
      : {
          ...(f.autoGenerate ? {} : { itemCode: 'Enter item code' }),
          productName: 'Enter product name',
        };
    const errs = {};
    Object.entries(req).forEach(([k, msg]) => { if (!String(f[k]).trim()) errs[k] = msg; });
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const description = descRef.current?.innerHTML || '';

    if (isEdit) {
      // Merge changes onto the original item so untouched fields are preserved.
      const payload = {
        ...(original || {}),
        itemName: f.productName,
        printName: f.printName,
        sku: f.itemCode,
        unit: f.unit,
        brand: f.brand,
        hsnCode: f.hsnCode,
        salesDescription: f.shortDesc,
        description,
        costPrice: f.purchasePrice ? Number(f.purchasePrice) : 0,
        sellingPrice: f.sellingPrice ? Number(f.sellingPrice) : 0,
        mrp: f.mrp ? Number(f.mrp) : (original?.mrp ?? 0),
        reorderPoint: f.minQty !== '' ? Number(f.minQty) : (original?.reorderPoint ?? ''),
        weight: f.netWeight !== '' ? Number(f.netWeight) : (original?.weight ?? ''),
      };
      try {
        setSaving(true);
        const res = await fetch(`${API_ROOT}/api/shoe-sales/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const p = await res.json().catch(() => null);
          throw new Error(p?.message || 'Update failed');
        }
        navigate(`/shoe-sales/items/${itemId}`);
      } catch (e) {
        alert('Failed to update item: ' + e.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // New item → POST to the standalone item create API.
    let currentUser = {};
    try { currentUser = JSON.parse(localStorage.getItem('rootfinuser')) || {}; } catch { /* ignore */ }
    const createdBy = currentUser.username || currentUser.locName || 'System';
    const num = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : 0);
    const openingQty = num(f.openingQty);

    const payload = {
      type: 'goods',
      itemName: f.productName.trim(),
      printName: (f.printName || f.productName).trim(),
      // Empty SKU lets the backend auto-generate a unique one.
      sku: f.autoGenerate ? '' : f.itemCode.trim(),
      itemCode: f.autoGenerate ? '' : f.itemCode.trim(),
      unit: f.unit,
      brand: f.brand,
      hsnCode: f.hsnCode,
      // Schema only allows shirt/shoe/other for `category`; keep the picked label separately.
      category: 'other',
      itemCategory: f.category,
      subCategory: f.subCategory,
      taxRateIntra: f.salesTax,
      taxRateInter: f.salesTax,
      salesDescription: f.shortDesc,
      description,
      costPrice: num(f.purchasePrice),
      sellingPrice: num(f.sellingPrice),
      mrp: num(f.mrp),
      reorderPoint: f.minQty !== '' ? String(f.minQty) : '',
      weight: f.netWeight !== '' ? String(f.netWeight) : '',
      stock: openingQty,
      openingStock: openingQty,
      trackInventory: true,
      trackingMethod: f.manageBatch ? 'batch' : 'none',
      createdBy,
      changedBy: createdBy,
      userLocName: currentUser.locName || '',
    };

    try {
      setSaving(true);
      const res = await fetch(`${API_ROOT}/api/shoe-sales/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || `Create failed (${res.status})`);
      if (res.status === 200) {
        alert(`An item named "${data?.itemName}" already exists (SKU ${data?.sku}). Opening it.`);
      }
      navigate(data?._id ? `/shoe-sales/items/${data._id}` : '/shoe-sales/items');
    } catch (e) {
      alert('Failed to create item: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title={isEdit ? 'Edit Item' : 'New Product'} />
      <div className={`transition-all duration-300 bg-[#f4f5f3] min-h-screen pb-28 ${isSidebarOpen ? 'lg:ml-64 ml-0' : 'ml-0'}`}>
        <div className="p-4 sm:p-6 space-y-5">

          {/* Page title */}
          <div>
            <button
              onClick={() => navigate(isEdit ? `/shoe-sales/items/${itemId}` : '/shoe-sales/items')}
              className="no-hover-anim inline-flex items-center gap-1.5 text-[13px] font-semibold text-gray-500 hover:text-gray-900 transition mb-3"
            >
              <ArrowLeft size={16} /> {isEdit ? 'Back to Item' : 'Back to Items'}
            </button>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 leading-none">{isEdit ? 'Edit Item' : 'New Product'}</h1>
            <p className="text-[13px] text-gray-500 mt-1.5">{isEdit ? 'Edit item details for sales, purchasing and inventory.' : 'Capture product details for sales, purchasing and inventory.'}</p>
          </div>

          {/* General Details */}
          <SectionCard title="General Details">
            <div className="space-y-5">
              {/* Row 1 */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5">
                <div className="xl:col-span-2">
                  <Field
                    label="Item Code/Barcode" required placeholder="Item Code/Barcode"
                    value={f.itemCode} onChange={set('itemCode')} error={errors.itemCode}
                    right={<Check label="Auto Generate" checked={f.autoGenerate} onChange={set('autoGenerate')} />}
                  />
                </div>
                <Field label="Product Name" required placeholder="Product Name" value={f.productName} onChange={set('productName')} error={errors.productName} />
                <Field label="Print Name" required placeholder="Print Name" value={f.printName} onChange={set('printName')} error={errors.printName} />
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-x-6 gap-y-5">
                <Select label="Category" required placeholder="Select Category" value={f.category} onChange={set('category')} options={['Stationery', 'Office Supplies', 'School Supplies', 'Art & Craft', 'Paper Products']} error={errors.category} />
                <Select label="Sub Category" placeholder="Select Sub Category" value={f.subCategory} onChange={set('subCategory')} options={['Pens & Pencils', 'Notebooks', 'Sticky Notes', 'Files & Folders', 'Paper', 'Desk Accessories']} />
                <Select label="Brand" required placeholder="Select Brand" value={f.brand} onChange={set('brand')} options={['Camel', 'Classmate', 'Cello', 'Reynolds', 'Faber-Castell', 'Natraj']} error={errors.brand} />
                <Select label="Sub Brand" placeholder="Select Sub Brand" value={f.subBrand} onChange={set('subBrand')} options={['Premium', 'Standard', 'Economy']} />
                <Select label="Unit" required placeholder="Select Unit" value={f.unit} onChange={set('unit')} options={['pcs', 'pack', 'box', 'dozen', 'ream', 'set']} />
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-x-6 gap-y-5 items-end">
                <Field label="HSN Code" placeholder="HSN Code" value={f.hsnCode} onChange={set('hsnCode')} />
                <Select label="Purchase Tax" required placeholder="Select Purchase Tax" value={f.purchaseTax} onChange={set('purchaseTax')} options={taxOptions} />
                <Select label="Sales Tax" required placeholder="Select Sales Tax" value={f.salesTax} onChange={set('salesTax')} options={taxOptions} />
                <div className="flex items-center h-10"><Check label="Cess %" checked={f.cess} onChange={set('cess')} /></div>
                <div className="flex items-center h-10"><Check label="Manage Multiple Batch" checked={f.manageBatch} onChange={set('manageBatch')} /></div>
              </div>

              {/* Inclusive toggles for taxes */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-x-6 gap-y-3">
                <div />
                <Check label="Purchase Tax Inclusive" checked={f.purchaseInclusive} onChange={set('purchaseInclusive')} />
                <Check label="Sales Tax Inclusive" checked={f.salesInclusive} onChange={set('salesInclusive')} />
              </div>

              {/* Short description */}
              <div>
                <Label>Short Description</Label>
                <textarea rows={2} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none resize-y transition focus:border-[#A8D11E] focus:ring-2 focus:ring-[#C6F135]/30" placeholder="Enter Short Description" value={f.shortDesc} onChange={set('shortDesc')} />
              </div>

              {/* Rich description */}
              <div>
                <Label>Description</Label>
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
                    {[{ i: Bold, c: 'bold' }, { i: Italic, c: 'italic' }, { i: Underline, c: 'underline' }].map(({ i: Icon, c }) => (
                      <button key={c} type="button" onClick={() => exec(c)} className="no-hover-anim grid place-items-center w-8 h-8 rounded-md text-gray-600 hover:bg-white hover:text-gray-900 transition"><Icon size={15} /></button>
                    ))}
                    <span className="w-px h-5 bg-gray-200 mx-1" />
                    {[{ i: List, c: 'insertUnorderedList' }, { i: ListOrdered, c: 'insertOrderedList' }].map(({ i: Icon, c }) => (
                      <button key={c} type="button" onClick={() => exec(c)} className="no-hover-anim grid place-items-center w-8 h-8 rounded-md text-gray-600 hover:bg-white hover:text-gray-900 transition"><Icon size={15} /></button>
                    ))}
                    <span className="w-px h-5 bg-gray-200 mx-1" />
                    <button type="button" className="no-hover-anim grid place-items-center w-8 h-8 rounded-md text-gray-600 hover:bg-white transition"><Code size={15} /></button>
                    <button type="button" className="no-hover-anim grid place-items-center w-8 h-8 rounded-md text-gray-600 hover:bg-white transition"><TableIcon size={15} /></button>
                  </div>
                  <div ref={descRef} contentEditable suppressContentEditableWarning className="min-h-[180px] px-4 py-3 text-sm text-gray-900 outline-none focus:bg-white" />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Pricing Details */}
          <SectionCard title="Pricing Details">
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-5">
                <Field label="Purchase Price" required type="number" placeholder="0.00" value={f.purchasePrice} onChange={set('purchasePrice')} />
                <Field label="Landing Cost" required type="number" placeholder="0" value={f.landingCost} onChange={set('landingCost')} />
                <Field label="MRP" required type="number" placeholder="0.00" value={f.mrp} onChange={set('mrp')} />
                <Money label="Selling Discount" required value={f.sellingDiscount} onChange={set('sellingDiscount')} />
                <Field label="Selling Price" required type="number" placeholder="0.00" value={f.sellingPrice} onChange={set('sellingPrice')} />
                <Money label="Selling Margin" required value={f.sellingMargin} placeholder="0" onChange={set('sellingMargin')} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5">
                <Field label="Minimum Quantity" required type="number" placeholder="0" value={f.minQty} onChange={set('minQty')} />
                <Field label="Opening Qty" type="number" placeholder="0" value={f.openingQty} onChange={set('openingQty')} />
                <Money label="Membership Margin" required value={f.membershipMargin} onChange={set('membershipMargin')} />
                <Field label="Net Weight" type="number" placeholder="0" value={f.netWeight} onChange={set('netWeight')} />
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Sticky footer */}
        <div className={`fixed bottom-0 right-0 z-40 bg-white/90 backdrop-blur border-t border-gray-200 transition-all duration-300 ${isSidebarOpen ? 'lg:left-64 left-0' : 'left-[76px]'}`}>
          <div className="flex items-center justify-between px-6 py-3.5">
            <p className="text-[13px] text-gray-500">A standalone item will be saved.</p>
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(isEdit ? `/shoe-sales/items/${itemId}` : '/shoe-sales/items')} className="no-hover-anim h-11 px-6 rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="no-hover-anim h-11 px-7 rounded-full bg-[#15171D] text-white text-sm font-bold hover:bg-black transition active:scale-[0.98] shadow-sm disabled:opacity-60">
                {saving ? 'Saving…' : (isEdit ? 'UPDATE ITEM' : 'SAVE ITEM')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ItemFormNew;
