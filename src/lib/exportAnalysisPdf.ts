import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { AnalysisRow } from "./marklist";
import { generateAnalysisInsights } from "./generateComment";
import schoolLogoUrl from "../assets/school-logo.png";
import { watermarkAllPages } from "./pdfWatermark";

const BRAND_MAROON: [number, number, number] = [163, 18, 63];
const GREEN_FILL: [number, number, number] = [198, 239, 206];
const BLUE_FILL: [number, number, number] = [189, 215, 238];
const AMBER_FILL: [number, number, number] = [255, 230, 153];
const RED_FILL: [number, number, number] = [255, 199, 206];

// jsPDF's addImage needs a base64 data URL (not a raw ArrayBuffer), and
// this is called every export, so fetch + convert once and cache it.
let logoDataUrlPromise: Promise<string> | null = null;
function loadLogoDataUrl(): Promise<string> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(schoolLogoUrl)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      );
  }
  return logoDataUrlPromise;
}
const LOGO_W = 44;
const LOGO_H = 52; // matches the source asset's ~0.85 aspect ratio

// Grade-distribution analysis tables are wide relative to how few rows
// they have (Learning Area + 4 CBC columns + Total), and on a portrait
// page that left a cramped, squeezed-looking printout. Landscape gives
// every column room to breathe, so this always renders landscape
// regardless of what the on-screen table looks like.
export async function exportAnalysisPdf(opts: {
  title: string;
  schoolName: string;
  rows: AnalysisRow[];
  filename: string;
}) {
  const { title, schoolName, rows, filename } = opts;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Header bar and table/overview text below were sized for a portrait
  // page and looked lost on the wide landscape canvas -- everything
  // here is scaled up to actually use the extra width, while staying
  // just tight enough (with the adaptive overview box below) that the
  // table and the overview both land on one page rather than spilling
  // the overview onto a second one.
  const HEADER_H = 56;
  doc.setFillColor(...BRAND_MAROON);
  doc.rect(0, 0, pageWidth, HEADER_H, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text(schoolName, pageWidth / 2, 27, { align: "center" });
  doc.setFontSize(13);
  doc.text(title, pageWidth / 2, 46, { align: "center" });

  try {
    const logoDataUrl = await loadLogoDataUrl();
    doc.addImage(logoDataUrl, "PNG", 16, 6, LOGO_W, LOGO_H);
  } catch {
    // Logo is decorative -- if it fails to load, the report still exports fine without it.
  }

  const grand = { ee: 0, me: 0, ae: 0, be: 0 };
  rows.forEach((r) => {
    grand.ee += r.ee;
    grand.me += r.me;
    grand.ae += r.ae;
    grand.be += r.be;
  });

  autoTable(doc, {
    startY: HEADER_H + 18,
    margin: { left: margin, right: margin },
    head: [["Learning Area", "E.E", "M.E", "A.E", "B.E", "Total"]],
    body: rows.map((r) => [r.fullLabel, r.ee, r.me, r.ae, r.be, r.total]),
    foot: [["TOTAL", grand.ee, grand.me, grand.ae, grand.be, ""]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 13, halign: "center", cellPadding: 8 },
    headStyles: { fillColor: [240, 233, 235], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 13 },
    footStyles: { fillColor: [240, 233, 235], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 13 },
    columnStyles: {
      0: { halign: "left", cellWidth: 320, fontStyle: "bold" },
      // Matches the footer TOTAL row's look (bold, same muted-maroon
      // fill) so the per-subject Total column reads with the same
      // weight instead of blending in as just another plain number.
      5: { fontStyle: "bold", fillColor: [240, 233, 235], textColor: [30, 30, 30] },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const fillByCol: Record<number, [number, number, number]> = {
        1: GREEN_FILL,
        2: BLUE_FILL,
        3: AMBER_FILL,
        4: RED_FILL,
      };
      const fill = fillByCol[data.column.index];
      if (fill) data.cell.styles.fillColor = fill;
    },
  });

  // Performance overview -- a rule-based read of the same
  // E.E/M.E/A.E/B.E counts already in the table (see
  // generateAnalysisInsights): deterministic and free, not an AI call,
  // so it always matches the numbers above it exactly.
  //
  // The table's row count varies with how many learning areas the class
  // has, so instead of a fixed font size that might not leave room, this
  // measures the space actually left below the table and shrinks the
  // overview's font/line-height to fit it -- keeping the whole thing on
  // one page rather than spilling the box onto a second one. addPage()
  // stays as a last-resort safety net for the rare case where even the
  // smallest readable size wouldn't fit.
  const insights = generateAnalysisInsights(rows);
  if (insights.length > 0) {
    const bottomMargin = 26;
    const gapAfterTable = 18;
    const boxW = pageWidth - margin * 2;
    const bulletIndent = 16;
    const headingFontSize = 14;

    let boxY = (doc as any).lastAutoTable.finalY + gapAfterTable;
    const availableHeight = pageHeight - bottomMargin - boxY;

    // Try progressively smaller body text until the wrapped insight
    // lines fit in the space available; 8.5pt is the floor for legibility.
    const candidateSizes = [13, 12, 11, 10.5, 10, 9.5, 9, 8.5];
    let chosen: { fontSize: number; lineHeight: number; wrapped: string[][]; boxH: number } | null = null;

    for (const fontSize of candidateSizes) {
      const lineHeight = fontSize * 1.35;
      const textIndent = fontSize + 4;
      const wrapWidth = boxW - bulletIndent * 2 - textIndent;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
      const wrapped = insights.map((line) => doc.splitTextToSize(line, wrapWidth) as string[]);
      const totalWrappedLines = wrapped.reduce((sum, ls) => sum + ls.length, 0);
      const padTop = 14;
      const padBottom = 14;
      const headingH = headingFontSize + 12;
      const boxH = headingH + totalWrappedLines * lineHeight + padTop + padBottom;
      if (boxH <= availableHeight || fontSize === candidateSizes[candidateSizes.length - 1]) {
        chosen = { fontSize, lineHeight, wrapped, boxH };
        break;
      }
    }

    // Safety net: even the smallest size didn't fit (a class with an
    // unusually long run of insight text) -- start a fresh page instead
    // of letting the box run past the page edge.
    if (chosen && boxY + chosen.boxH > pageHeight - bottomMargin) {
      doc.addPage();
      boxY = 40;
    }

    if (chosen) {
      const { fontSize, lineHeight, wrapped, boxH } = chosen;
      const textIndent = fontSize + 4;
      const padTop = 14;

      doc.setFillColor(250, 245, 246);
      doc.setDrawColor(...BRAND_MAROON);
      doc.setLineWidth(1.2);
      doc.roundedRect(margin, boxY, boxW, boxH, 5, 5, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(headingFontSize);
      doc.setTextColor(...BRAND_MAROON);
      doc.text("Performance Overview", margin + bulletIndent, boxY + padTop + 8);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
      doc.setTextColor(40, 30, 32);
      let ty = boxY + padTop + headingFontSize + 12;
      wrapped.forEach((wrappedLines) => {
        wrappedLines.forEach((wl, i) => {
          const prefix = i === 0 ? "\u2022 " : "";
          const x = margin + bulletIndent + (i === 0 ? 0 : textIndent);
          doc.text(`${prefix}${wl}`, x, ty);
          ty += lineHeight;
        });
      });
    }
  }

  const logoDataUrl = await loadLogoDataUrl().catch(() => null);
  watermarkAllPages(doc, logoDataUrl);

  doc.save(`${filename}.pdf`);
}
