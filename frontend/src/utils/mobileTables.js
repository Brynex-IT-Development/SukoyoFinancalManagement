// Phone-friendly tables, applied site-wide (see the "Mobile table cards" CSS in index.css).
//
// On phones (< 640px):
//  • LIST tables become stacked cards: each row is a card, the first real column is the
//    card title and every other cell shows its column heading as a label.
//  • ENTRY tables (rows with inputs/selects) and REPORTS with grouped headings keep
//    horizontal scrolling, but their first real column is frozen on the left.
// Tablet / desktop are untouched. A table can opt out of cards with class "no-card"
// (on the table or any ancestor).
//
// Only data-* attributes are written, which React leaves alone on re-render.

const PHONE = "(max-width: 639.98px)";

const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
const isCheckboxOnly = (cell) =>
  !!cell && !text(cell) && !!cell.querySelector('input[type="checkbox"], input[type="radio"]');

const headerCells = (table) => {
  const rows = table.tHead ? [...table.tHead.rows] : [];
  if (rows.length) return { rows, cells: [...rows[rows.length - 1].cells] };
  // Tables without <thead> but with a first row of <th>
  const first = table.rows[0];
  if (first && [...first.cells].every((c) => c.tagName === "TH")) return { rows: [first], cells: [...first.cells] };
  return { rows: [], cells: [] };
};

const bodyRows = (table) => {
  const rows = [];
  [...table.tBodies].forEach((tb) => rows.push(...tb.rows));
  return rows;
};

const effectiveBg = (el) => {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
  }
  return "#fff";
};

const setAttr = (el, name, value) => {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); return; }
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
};

function decide(table) {
  if (table.closest(".no-card, .no-print-cards")) return "skip";
  const { rows: headRows, cells: heads } = headerCells(table);
  if (!heads.length) return "skip";
  const grouped = headRows.length > 1 || heads.some((h) => (h.colSpan || 1) > 1);
  // An ENTRY table is one you type into: text/number/date boxes, or editable fields in
  // two or more columns of a row. A single dropdown per row (e.g. a status picker on a
  // list page) still counts as a list, so it becomes a card with the dropdown inside.
  const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, [contenteditable="true"]';
  const isEntry = bodyRows(table).slice(0, 5).some((tr) => {
    if (tr.querySelector(TYPING)) return true;
    const editableCells = [...tr.cells].filter((c) => c.querySelector("select, " + TYPING)).length;
    return editableCells >= 2;
  });
  if (grouped || isEntry) return "scroll";
  if (heads.length <= 2) return "skip"; // two columns already fit a phone
  return "cards";
}

function applyCards(table) {
  const { cells: heads } = headerCells(table);
  const labels = heads.map(text);
  // Title column, in order of preference:
  //   1. a document number  (Order #, Invoice Number, Reference No …)
  //   2. a name             (Name, Item, Store, Customer, Vendor, Group …)
  //   3. a code             (SKU, Code)
  //   4. the first real column that isn't a date
  // Serial-number columns ("No.", "#", "S.No") and checkbox columns are never the title.
  const SERIAL_RE = /^(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|no\.?|#|index|sn)$/i;
  const DATE_RE = /date|time|\bday\b/i;
  const usable = (i) => labels[i] && !isCheckboxOnly(heads[i]) && !SERIAL_RE.test(labels[i]) && !DATE_RE.test(labels[i]);
  const passes = [/#|number|\bno\b\.?/i, /name|item|store|customer|vendor|group|product|user|title/i, /sku|code/i];
  let titleIdx = -1;
  for (const re of passes) {
    titleIdx = labels.findIndex((l, i) => usable(i) && re.test(l));
    if (titleIdx >= 0) break;
  }
  if (titleIdx < 0) titleIdx = labels.findIndex((l, i) => usable(i));
  if (titleIdx < 0) titleIdx = labels.findIndex((l, i) => labels[i] && !isCheckboxOnly(heads[i]));
  if (titleIdx < 0) titleIdx = 0;

  setAttr(table, "data-sk-cards", "1");
  setAttr(table, "data-sk-scroll", null);

  bodyRows(table).forEach((tr) => {
    const cells = [...tr.cells];
    if (cells.length === 1 && (cells[0].colSpan || 1) > 1) {
      setAttr(cells[0], "data-sk-full", "1"); // "No records" / loading rows
      return;
    }
    let col = 0;
    cells.forEach((td) => {
      const label = labels[col] || "";
      setAttr(td, "data-label", label);
      setAttr(td, "data-sk-title", col === titleIdx ? "1" : null);
      setAttr(td, "data-sk-check", isCheckboxOnly(td) ? "1" : null);
      setAttr(td, "data-sk-empty", !text(td) && !td.querySelector("img,svg,button,a,input") ? "1" : null);
      col += td.colSpan || 1;
    });
  });
}

function applyScroll(table) {
  setAttr(table, "data-sk-cards", null);
  setAttr(table, "data-sk-scroll", "1");
  const { cells: heads } = headerCells(table);
  if (!heads.length) return;
  // Freeze the first real column (and a leading checkbox column, if any).
  const pinCount = isCheckboxOnly(heads[0]) && heads.length > 2 ? 2 : 1;
  const widths = [];
  for (let i = 0; i < pinCount; i++) widths.push(heads[i]?.getBoundingClientRect().width || 0);

  const pinRow = (tr) => {
    let col = 0;
    [...tr.cells].forEach((cell) => {
      const pinned = col < pinCount && (cell.colSpan || 1) === 1;
      if (pinned) {
        const left = widths.slice(0, col).reduce((a, b) => a + b, 0);
        setAttr(cell, "data-sk-pin", col === pinCount - 1 ? "last" : "1");
        cell.style.left = `${left}px`;
        if (!cell.dataset.skBg) {
          cell.dataset.skBg = "1";
          cell.style.backgroundColor = effectiveBg(cell);
        }
      }
      col += cell.colSpan || 1;
    });
  };
  [...(table.tHead?.rows || [])].forEach(pinRow);
  bodyRows(table).forEach(pinRow);
}

function clear(table) {
  setAttr(table, "data-sk-cards", null);
  setAttr(table, "data-sk-scroll", null);
  table.querySelectorAll("[data-sk-pin]").forEach((c) => {
    c.removeAttribute("data-sk-pin");
    c.style.left = "";
    if (c.dataset.skBg) { c.style.backgroundColor = ""; delete c.dataset.skBg; }
  });
}

function processAll() {
  const phone = window.matchMedia(PHONE).matches;
  document.querySelectorAll("table").forEach((table) => {
    if (!phone) { if (table.hasAttribute("data-sk-cards") || table.hasAttribute("data-sk-scroll")) clear(table); return; }
    const mode = decide(table);
    if (mode === "cards") applyCards(table);
    else if (mode === "scroll") applyScroll(table);
    else clear(table);
  });
}

export function installMobileTables() {
  if (typeof window === "undefined" || window.__skMobileTables) return;
  window.__skMobileTables = true;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; processAll(); });
  };
  const start = () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    schedule();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}
