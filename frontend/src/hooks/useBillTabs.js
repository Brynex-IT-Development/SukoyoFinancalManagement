import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_TABS = 9;

// localStorage can be missing, full or blocked: every access is wrapped and the page works without it
const safeRead = (key) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const safeWrite = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded / storage blocked — drafts just are not kept across refresh
  }
};

// Item images are big base64 strings and not needed to restore a bill
const slimBill = (bill) => (!bill || !Array.isArray(bill.lineItems) ? bill : {
  ...bill,
  lineItems: bill.lineItems.map((l) => {
    if (!l?.itemData) return l;
    const { images, image, ...itemData } = l.itemData; // eslint-disable-line no-unused-vars
    return { ...l, itemData };
  }),
});

const validSaved = (s) =>
  s && s.v === 1 && Array.isArray(s.tabs) && s.tabs.length >= 1 && s.tabs.length <= MAX_TABS &&
  s.tabs.every((t) => t && typeof t.id === "string") && s.drafts && typeof s.drafts === "object" &&
  s.tabs.some((t) => t.id === s.activeId);

/**
 * Several bills open at once on the billing screen (F6).
 *
 * All bills live in ONE object keyed by tab id (`drafts`); the page's existing form state is the
 * live copy of the active tab. Switching tabs saves the active bill into `drafts` (via `current`)
 * and restores the other one into the form (via `restore`), so the page itself is not duplicated.
 * Drafts are saved to localStorage under `storageKey` (user + store) so a refresh keeps them.
 *
 * @param enabled    false in edit mode (one invoice only)
 * @param storageKey localStorage key, e.g. "sukoyo.billTabs.v1.<email>.<locCode>"
 * @param current    the active bill's full form state (memoised object)
 * @param restore    (bill) => void — put a bill into the form
 * @param makeEmpty  () => empty bill
 * @param hasItems   (bill) => boolean — closing such a tab asks first
 * @param notify     (message) => void
 */
export default function useBillTabs({ enabled, storageKey, current, restore, makeEmpty, hasItems, notify }) {
  const [tabs, setTabs] = useState([{ id: "t1", n: 1 }]);
  const [activeId, setActiveId] = useState("t1");
  const [, force] = useState(0); // re-render when inactive drafts change (labels)
  const draftsRef = useRef({});
  const currentRef = useRef(current);
  currentRef.current = current;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const loadedRef = useRef(false);

  // Load saved drafts once
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    const saved = safeRead(storageKey);
    if (!validSaved(saved)) return;
    draftsRef.current = saved.drafts;
    setTabs(saved.tabs);
    setActiveId(saved.activeId);
    if (saved.drafts[saved.activeId]) restoreRef.current(saved.drafts[saved.activeId]);
  }, [enabled, storageKey]);

  // Save (debounced) whenever the active bill or the tab list changes
  useEffect(() => {
    if (!enabled || !loadedRef.current) return;
    const t = setTimeout(() => {
      draftsRef.current[activeId] = currentRef.current;
      const drafts = {};
      for (const tab of tabs) if (draftsRef.current[tab.id]) drafts[tab.id] = slimBill(draftsRef.current[tab.id]);
      safeWrite(storageKey, { v: 1, tabs, activeId, drafts, savedAt: Date.now() });
    }, 400);
    return () => clearTimeout(t);
  }, [enabled, storageKey, current, tabs, activeId]);

  const switchTo = useCallback((id) => {
    if (id === activeId || !tabs.some((t) => t.id === id)) return;
    draftsRef.current[activeId] = currentRef.current;
    restoreRef.current(draftsRef.current[id] || makeEmpty());
    setActiveId(id);
  }, [activeId, tabs, makeEmpty]);

  const newTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) { notify?.(`At most ${MAX_TABS} bills can be open at once.`); return; }
    draftsRef.current[activeId] = currentRef.current;
    const used = new Set(tabs.map((t) => t.n));
    const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((x) => !used.has(x)) || tabs.length + 1;
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const empty = makeEmpty();
    draftsRef.current[id] = empty;
    setTabs([...tabs, { id, n }]);
    restoreRef.current(empty);
    setActiveId(id);
  }, [tabs, activeId, makeEmpty, notify]);

  const closeTab = useCallback((id) => {
    const bill = id === activeId ? currentRef.current : draftsRef.current[id];
    if (bill && hasItems(bill) && !window.confirm("This bill has items. Close it and discard them?")) return;
    if (tabs.length === 1) { // last tab: just clear it
      const empty = makeEmpty();
      draftsRef.current = { [id]: empty };
      restoreRef.current(empty);
      return;
    }
    const idx = tabs.findIndex((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);
    delete draftsRef.current[id];
    setTabs(remaining);
    if (id === activeId) {
      const next = remaining[Math.max(0, idx - 1)];
      restoreRef.current(draftsRef.current[next.id] || makeEmpty());
      setActiveId(next.id);
    } else {
      force((x) => x + 1);
    }
  }, [tabs, activeId, hasItems, makeEmpty]);

  /** After a successful save: this tab becomes an empty bill. */
  const resetActive = useCallback(() => {
    const empty = makeEmpty();
    draftsRef.current[activeId] = empty;
    restoreRef.current(empty);
  }, [activeId, makeEmpty]);

  // Shortcuts: Alt+N new, Alt+W close, Alt+1…9 switch (Ctrl+T / Ctrl+W belong to the browser)
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); newTab(); }
      else if (e.code === "KeyW") { e.preventDefault(); closeTab(activeId); }
      else if (/^Digit[1-9]$/.test(e.code)) {
        const tab = tabs[Number(e.code.slice(5)) - 1];
        if (tab) { e.preventDefault(); switchTo(tab.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, tabs, activeId, newTab, closeTab, switchTo]);

  // What each tab shows: customer name (or "Bill n") and how many items it has
  const tabInfo = useMemo(() => tabs.map((t, i) => {
    const bill = t.id === activeId ? current : draftsRef.current[t.id];
    const items = (bill?.lineItems || []).filter((l) => l && (l.item || l.itemData)).length;
    return { id: t.id, index: i + 1, label: String(bill?.customer || "").trim() || `Bill ${t.n}`, items, active: t.id === activeId };
  }), [tabs, activeId, current]);

  return { enabled, tabs: tabInfo, activeId, switchTo, newTab, closeTab, resetActive, max: MAX_TABS };
}
