import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { cbcLevel } from "../types";
import { generateSubjectRemark } from "./generateComment";
import { ReportFormData } from "./exportReportDocx";
import crestUrl from "../assets/school-crest-maroon.png";
import { watermarkAllPages } from "./pdfWatermark";

const MAROON: [number, number, number] = [163, 18, 63];
const INK: [number, number, number] = [36, 20, 23];
const MUTED: [number, number, number] = [107, 91, 93];
const LEVEL_COLOR: Record<string, [number, number, number]> = {
  EE: [30, 123, 52],
  ME: [31, 78, 120],
  AE: [138, 90, 0],
  BE: [156, 0, 6],
};
const LEVEL_FILL: Record<string, [number, number, number]> = {
  EE: [226, 243, 229],
  ME: [220, 232, 245],
  AE: [251, 239, 217],
  BE: [251, 225, 226],
};
const LEVEL_TEXT: Record<string, string> = { EE: "E.E", ME: "M.E", AE: "A.E", BE: "B.E" };
const LEVEL_MEANING: Record<string, string> = {
  EE: "Exceeds Expectations",
  ME: "Meets Expectations",
  AE: "Approaches Expectations",
  BE: "Below Expectations",
};

// Same transparent crest used in the .docx export -- fetched once and
// cached as a data URL, since jsPDF's addImage needs a data URL rather
// than a raw ArrayBuffer.
let crestDataUrlPromise: Promise<string> | null = null;
function loadCrestDataUrl(): Promise<string> {
  if (!crestDataUrlPromise) {
    crestDataUrlPromise = fetch(crestUrl)
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
  return crestDataUrlPromise;
}

// Renders ONE learner's report onto the current page of `doc`, starting
// at the top. Used by both the single-learner export and the batch
// export below (which calls this once per learner, adding a page
// between each).
function drawReport(doc: jsPDF, data: ReportFormData, crestDataUrl: string | null) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 34;
  const usableW = pageW - margin * 2;
  let y = 28;

  if (crestDataUrl) {
    const w = 40, h = 47.4; // ~0.844 aspect ratio, matches the source asset
    doc.addImage(crestDataUrl, "PNG", pageW / 2 - w / 2, y, w, h);
    // doc.text()'s y is the text BASELINE, not its visual top -- a 15pt
    // bold header's cap-height reaches ~11pt above that baseline. A
    // "+10" gap here left the letters overlapping the crest by ~1pt.
    // Add the header's approximate ascent on top of the intended visual
    // gap so the crest and school name never touch.
    y += h + 24;
  }

  doc.setTextColor(...MAROON);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(data.schoolName, pageW / 2, y, { align: "center" });
  y += 16;

  doc.setTextColor(...INK);
  doc.setFontSize(12);
  doc.text("LEARNER'S REPORT FORM", pageW / 2, y, { align: "center" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.setFontSize(10);
  doc.text(data.examTitle, pageW / 2, y, { align: "center" });
  y += 16;

  // Identity strip
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: INK, lineColor: [200, 195, 196] },
    body: [
      ["Name", data.row.learner.name, "Admission No.", data.row.learner.admission_number],
      ["Class", data.row.className ?? "", "Assessment", data.examTitle],
    ],
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [245, 240, 241], cellWidth: usableW * 0.15 },
      1: { cellWidth: usableW * 0.35 },
      2: { fontStyle: "bold", fillColor: [245, 240, 241], cellWidth: usableW * 0.15 },
      3: { cellWidth: usableW * 0.35 },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 12;

  // Subject grid
  const pct = (score: number | null, max: number | null) => (score !== null && max ? Math.round((score / max) * 1000) / 10 : null);
  const rowsBody = data.row.groups.map((g) => {
    const p = pct(g.score, g.maxMarks);
    return [
      g.fullLabel,
      g.score !== null ? `${g.score} / ${g.maxMarks}` : "—",
      p !== null ? `${p}%` : "—",
      g.level ? LEVEL_TEXT[g.level] : "—",
      generateSubjectRemark(g.level),
      data.subjectTeacherByGroupKey[g.key] || "—",
    ];
  });
  const gPct = data.row.grandMax ? Math.round((data.row.grandTotal / data.row.grandMax) * 1000) / 10 : null;
  const gLevel = data.row.grandMax ? cbcLevel((data.row.grandTotal / data.row.grandMax) * 100) : null;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Learning Area", "Score", "%", "Level", "Remark", "Teacher"]],
    body: rowsBody,
    foot: [[
      "GRAND TOTAL",
      `${data.row.grandTotal} / ${data.row.grandMax}`,
      gPct !== null ? `${gPct}%` : "—",
      gLevel ? LEVEL_TEXT[gLevel] : "—",
      `Position: ${data.row.rank} out of ${data.classSize}`,
      "",
    ]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: [200, 195, 196] },
    headStyles: { fillColor: MAROON, textColor: [255, 255, 255], fontStyle: "bold" },
    footStyles: { fillColor: [245, 240, 241], textColor: INK, fontStyle: "bold" },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: usableW * 0.19 },
      1: { cellWidth: usableW * 0.1, halign: "center" },
      2: { cellWidth: usableW * 0.08, halign: "center" },
      3: { cellWidth: usableW * 0.09, halign: "center" },
      4: { cellWidth: usableW * 0.32 },
      5: { cellWidth: usableW * 0.22 },
    },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 3) {
        const raw = rowsBody[d.row.index]?.[3];
        const lvl = (Object.keys(LEVEL_TEXT) as (keyof typeof LEVEL_TEXT)[]).find((k) => LEVEL_TEXT[k] === raw);
        if (lvl) {
          d.cell.styles.fillColor = LEVEL_FILL[lvl];
          d.cell.styles.textColor = LEVEL_COLOR[lvl];
          d.cell.styles.fontStyle = "bold";
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // Grading key
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED);
  doc.text("Key to Performance Levels", margin, y);
  y += 6;
  const keyColW = usableW / 4;
  (["EE", "ME", "AE", "BE"] as const).forEach((lvl, i) => {
    doc.setFillColor(...LEVEL_FILL[lvl]);
    doc.rect(margin + i * keyColW, y, keyColW - 4, 16, "F");
    doc.setTextColor(...LEVEL_COLOR[lvl]);
    doc.setFontSize(7.5);
    doc.text(`${LEVEL_TEXT[lvl]} — ${LEVEL_MEANING[lvl]}`, margin + i * keyColW + 4, y + 10);
  });
  y += 26;

  // Learner progress (simple horizontal bars, mirrors the .docx graph)
  const points = data.progress.slice(-6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MAROON);
  doc.text("Learner Progress", margin, y);
  y += 8;
  if (points.length < 2) {
    doc.setFillColor(248, 243, 244);
    doc.rect(margin, y, usableW, 30, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...MAROON);
    doc.text("Building today for a brighter tomorrow.", pageW / 2, y + 18, { align: "center" });
    y += 40;
  } else {
    const labelW = usableW * 0.28;
    const pctW = 40;
    const barW = usableW - labelW - pctW;
    const rowH = 15;
    points.forEach((point) => {
      const filled = Math.max(0, Math.min(10, Math.round(point.percentage / 10)));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...INK);
      doc.text(point.label, margin, y + 10);
      for (let i = 0; i < 10; i++) {
        doc.setFillColor(...(i < filled ? MAROON : ([241, 234, 236] as [number, number, number])));
        doc.rect(margin + labelW + i * (barW / 10), y, barW / 10 - 1.5, rowH - 4, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MAROON);
      doc.text(`${point.percentage}%`, margin + labelW + barW + 4, y + 10);
      y += rowH;
    });
    y += 10;
  }

  // Comment boxes
  //
  // Box height used to be a flat "40 + lines.length * 10" guess, but
  // jsPDF actually spaces stacked text lines using fontSize * ~1.15 (its
  // default line-height factor) -- for 9pt text that's ~10.35pt per
  // line, not 10. Over a long comment that shortfall compounds until the
  // last line (and sometimes the signature row) spills past the box
  // border. Fixed here by drawing each line manually at an explicit,
  // measured pitch and sizing the box from those same numbers, so the
  // box is always exactly as tall as what's drawn inside it.
  function commentBox(label: string, text: string, signerLabel: string, signerName: string, boxY: number): number {
    const fontSize = 9;
    const lineHeight = fontSize * 1.2; // slightly generous vs. jsPDF's ~1.15 default, for safety margin
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text || " ", usableW - 16);

    const topPad = 16;       // box top edge -> label baseline
    const labelToText = 16;  // label baseline -> first comment line baseline
    const textToSig = 16;    // last comment line baseline -> signature row baseline
    const bottomPad = 10;    // signature row baseline -> box bottom edge

    const textBlockH = (lines.length - 1) * lineHeight;
    const boxH = topPad + labelToText + textBlockH + textToSig + bottomPad;

    doc.setDrawColor(...MAROON);
    doc.setLineWidth(1.2);
    doc.rect(margin, boxY, usableW, boxH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...MAROON);
    doc.text(label, margin + 8, boxY + topPad);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...INK);
    let ty = boxY + topPad + labelToText;
    lines.forEach((line: string) => {
      doc.text(line, margin + 8, ty);
      ty += lineHeight;
    });

    const signY = boxY + boxH - bottomPad;
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${signerLabel}:`, margin + 8, signY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(signerName || "____________________________", margin + 8 + doc.getTextWidth(`${signerLabel}: `), signY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text("Signature: ______________________     Date: ____________", pageW - margin - 8, signY, { align: "right" });
    return boxY + boxH + 10;
  }

  y = commentBox("Class Teacher's Comment", data.teacherComment, "Class Teacher", data.classTeacherName, y);
  y = commentBox("Head Teacher's Comment", data.headTeacherComment, "Head Teacher", data.headTeacherName, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Term ends: `, pageW / 2 - 90, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  doc.text(data.termEndsOn || "Not set", pageW / 2 - 90 + doc.getTextWidth("Term ends: "), y + 4);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED);
  doc.text(`   ·   Next term begins: `, pageW / 2 - 5, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  doc.text(data.nextTermBeginsOn || "Not set", pageW / 2 - 5 + doc.getTextWidth("   ·   Next term begins: "), y + 4);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...MAROON);
  doc.text("School Motto: Strive for Excellence.", pageW / 2, doc.internal.pageSize.getHeight() - 18, { align: "center" });
}

export async function exportReportFormPdf(data: ReportFormData & { filename: string }) {
  const { filename, ...reportData } = data;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const crestDataUrl = await loadCrestDataUrl().catch(() => null);
  drawReport(doc, reportData, crestDataUrl);
  watermarkAllPages(doc, crestDataUrl);
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// Whole-class batch export -- one PDF, one report form per learner, each
// starting on its own page. Mirrors exportReportFormsBatchDocx in
// exportReportDocx.ts.
export async function exportReportFormsBatchPdf(opts: { reports: ReportFormData[]; filename: string }) {
  const { reports, filename } = opts;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const crestDataUrl = await loadCrestDataUrl().catch(() => null);
  reports.forEach((data, i) => {
    if (i > 0) doc.addPage();
    drawReport(doc, data, crestDataUrl);
  });
  watermarkAllPages(doc, crestDataUrl);
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
