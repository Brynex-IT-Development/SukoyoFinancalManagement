import { forwardRef } from "react";
import JsBarcode from "jsbarcode";
import useCompanyProfile from "../../hooks/useCompanyProfile";

// CODE128 barcode as inline SVG markup (same approach as Bills.jsx tag printing)
const barcodeSvg = (text) => {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, String(text).trim(), { format: "CODE128", width: 1.6, height: 40, displayValue: false, margin: 0, background: "transparent", lineColor: "#000000" });
    return svg.outerHTML;
  } catch {
    return "";
  }
};

/**
 * Printable sheet of gift card / voucher codes with barcodes, 2 per row (A4).
 * cards: [{ code, title, value, lines: [string] }]. Rendered off-screen and printed with react-to-print.
 */
const CodeSheet = forwardRef(({ heading, cards = [] }, ref) => {
  const company = useCompanyProfile();
  return (
  <div ref={ref} style={{ fontFamily: "Arial, sans-serif", color: "#111", padding: "8mm" }}>
    <style>{`@page { size: A4; margin: 8mm; } .cs-card { break-inside: avoid; page-break-inside: avoid; }`}</style>
    {heading && <div style={{ fontSize: 12, marginBottom: "4mm", color: "#555" }}>{heading}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
      {cards.map((c) => (
        <div key={c.code} className="cs-card" style={{ border: "1px dashed #999", borderRadius: 6, padding: "4mm 5mm", minHeight: "44mm" }}>
          {company?.companyName && <div style={{ fontSize: 9, color: "#555", marginBottom: "1mm" }}>{company.companyName}{company.phone ? ` · ${company.phone}` : ""}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>{c.title}</div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{c.value}</div>
          </div>
          <div style={{ marginTop: "3mm", textAlign: "center" }} dangerouslySetInnerHTML={{ __html: barcodeSvg(c.code) }} />
          <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 15, fontWeight: 700, letterSpacing: 2, marginTop: "1mm" }}>{c.code}</div>
          {(c.lines || []).filter(Boolean).map((l, i) => (
            <div key={i} style={{ fontSize: 10, color: "#444", marginTop: i === 0 ? "2mm" : 0 }}>{l}</div>
          ))}
        </div>
      ))}
    </div>
  </div>
  );
});

CodeSheet.displayName = "CodeSheet";
export default CodeSheet;
