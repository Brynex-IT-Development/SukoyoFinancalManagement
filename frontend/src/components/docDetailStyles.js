// Shared Sukoyo (ink + lime) styling for purchase document detail pages:
// Bill, Purchase Order and Purchase Receive. Keeps the three pages visually identical.

export const page = (isSidebarOpen) =>
  `transition-all duration-300 min-h-screen bg-[#f4f5f3] flex ${isSidebarOpen ? "ml-64" : "ml-0"}`;

// Left list panel
export const listPanel = "hidden lg:flex w-80 shrink-0 bg-white border-r border-gray-200 flex-col";
export const listHeader = "px-5 pt-5 pb-4 border-b border-gray-100";
export const listTitle = "text-[15px] font-bold tracking-tight text-[#15171D] truncate";
export const listAmount = "mt-1 text-2xl font-extrabold tracking-tight text-[#15171D]";
export const listActions = "px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2";

export const listItem = (active) =>
  `group block px-5 py-4 border-b border-gray-100 transition-colors ${
    active ? "bg-[#F6FCE6] shadow-[inset_3px_0_0_#A8D11E]" : "hover:bg-gray-50"
  }`;
export const listItemTitle = "text-sm font-semibold text-[#15171D] truncate";
export const listItemMeta = "text-xs text-gray-500 mt-0.5";
export const listItemAmount = "text-sm font-bold text-[#15171D]";

// Buttons (pill style, same as the item forms)
const btnBase =
  "no-hover-anim inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap";
export const btnOutline = `${btnBase} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300`;
export const btnPrimary = `${btnBase} bg-[#15171D] text-white hover:bg-black`;
export const btnLime = `${btnBase} bg-[#C6F135] text-[#15171D] hover:bg-[#B8E62A]`;
export const btnDanger = `${btnBase} border border-red-200 bg-white text-red-600 hover:bg-red-50`;
export const btnLink = "no-hover-anim inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-[#15171D] transition cursor-pointer";

// Status chips
const chipBase = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider";
export const chip = {
  danger: `${chipBase} bg-red-50 text-red-600 border border-red-100`,
  warning: `${chipBase} bg-amber-50 text-amber-700 border border-amber-100`,
  success: `${chipBase} bg-emerald-50 text-emerald-700 border border-emerald-100`,
  neutral: `${chipBase} bg-gray-100 text-gray-600 border border-gray-200`,
  brand: `${chipBase} bg-[#F6FCE6] text-[#15171D] border border-[#DEF39A]`,
};

// Main area
export const mainArea = "flex-1 min-w-0 overflow-y-auto";
export const topBar = "sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-200 px-6 py-3.5 flex items-center justify-between gap-4";
export const topTitle = "text-lg font-bold tracking-tight text-[#15171D]";
export const closeBtn = "no-hover-anim grid place-items-center w-9 h-9 rounded-full hover:bg-gray-100 text-gray-500 hover:text-[#15171D] transition";

// Document card
export const docWrap = "p-6 md:p-8 max-w-5xl mx-auto";
export const docCard = "bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden";
export const docSection = "px-8 py-7 border-b border-gray-100";
export const docTitle = "text-3xl font-extrabold tracking-tight text-[#15171D]";
export const docLabel = "text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2";
export const docNumber = "text-sm font-medium text-gray-500";

// Items table
export const tableWrap = "rounded-xl border border-gray-200 overflow-hidden";
export const th = "py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-white bg-[#15171D]";
export const td = "py-3 px-4 text-sm text-[#15171D]";
export const tr = (i) => `border-t border-gray-100 ${i % 2 === 1 ? "bg-gray-50/60" : "bg-white"}`;

// Totals
export const totalsWrap = "px-8 py-7 bg-[#fafaf8] border-t border-gray-100";
export const totalsBox = "max-w-sm ml-auto space-y-2.5";
export const totalsRow = "flex justify-between text-sm";
export const totalsLabel = "text-gray-500";
export const totalsValue = "font-semibold text-[#15171D]";
export const grandRow = "mt-3 flex justify-between items-center rounded-xl bg-[#F6FCE6] border border-[#DEF39A] px-4 py-3";
export const grandLabel = "text-sm font-bold uppercase tracking-wider text-[#15171D]";
export const grandValue = "text-lg font-extrabold text-[#15171D]";
