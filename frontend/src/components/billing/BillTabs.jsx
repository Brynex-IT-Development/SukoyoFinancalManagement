import { Plus, X } from "lucide-react";

/** Tab strip above the billing form (F6). `t` is the useBillTabs() result. */
export default function BillTabs({ t, disabled }) {
  if (!t.enabled) return null;
  return (
    <div className="px-3 sm:px-6 pb-2">
      <div className="flex flex-wrap items-end gap-1 border-b border-[#E5E7EB]">
        {t.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 border border-b-0 px-3 h-9 text-xs cursor-pointer select-none -mb-px ${
              tab.active ? "bg-white border-[#E5E7EB] font-bold text-[#111827]" : "bg-[#F3F4F6] border-transparent text-[#6B7280] hover:bg-[#E5E7EB]"
            }`}
            onClick={() => !disabled && t.switchTo(tab.id)}
            title={`Alt+${tab.index}`}
          >
            <span className="text-[10px] text-[#9CA3AF]">{tab.index}</span>
            <span className="max-w-[140px] truncate">{tab.label}</span>
            {tab.items > 0 && <span className="rounded-full bg-[#1C1F26] px-1.5 text-[10px] font-bold text-white">{tab.items}</span>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!disabled) t.closeTab(tab.id); }}
              className="ml-0.5 text-[#9CA3AF] hover:text-red-600 cursor-pointer"
              title="Close bill (Alt+W)"
              aria-label={`Close ${tab.label}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => !disabled && t.newTab()}
          disabled={disabled || t.tabs.length >= t.max}
          className="flex items-center gap-1 h-9 px-3 text-xs font-semibold text-[#1C1F26] hover:bg-[#F6FCE6] disabled:opacity-40 cursor-pointer -mb-px"
          title="New bill (Alt+N)"
        >
          <Plus size={13} /> New bill
        </button>
        <span className="ml-auto hidden md:inline text-[10px] text-[#9CA3AF] pb-2">Alt+N new · Alt+W close · Alt+1–9 switch</span>
      </div>
    </div>
  );
}
