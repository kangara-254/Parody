import {
  Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeightRule, Footer,
  AlignmentType, ShadingType, BorderStyle, VerticalAlign, TableLayoutType, ImageRun,
} from "docx";
import { saveAs } from "file-saver";
import { MarklistRow } from "./marklist";
import { generateSubjectRemark } from "./generateComment";
import { cbcLevel } from "../types";
// Transparent-background crest (maroon linework on a see-through PNG) --
// unlike school-logo.png, this has no solid maroon square behind it, so it
// sits cleanly on the white report page instead of printing as a big
// maroon block crowding the school name underneath it.
import schoolLogoUrl from "../assets/school-crest-maroon.png";

// The logo asset is ~890x1054px; fetched once and cached so a
// whole-class batch export doesn't re-fetch it per learner.
let logoBufferPromise: Promise<ArrayBuffer> | null = null;
function loadLogo(): Promise<ArrayBuffer> {
  if (!logoBufferPromise) {
    logoBufferPromise = fetch(schoolLogoUrl).then((r) => r.arrayBuffer());
  }
  return logoBufferPromise;
}
const LOGO_W = 72;
const LOGO_H = 85; // matches the source asset's ~0.844 aspect ratio

const MAROON = "A3123F";
const LEVEL_COLOR: Record<string, string> = { EE: "1E7B34", ME: "1F4E78", AE: "8A5A00", BE: "9C0006" };
const LEVEL_FILL: Record<string, string> = { EE: "E2F3E5", ME: "DCE8F5", AE: "FBEFD9", BE: "FBE1E2" };
const LEVEL_TEXT: Record<string, string> = { EE: "E.E", ME: "M.E", AE: "A.E", BE: "B.E" };
const LEVEL_MEANING: Record<string, string> = {
  EE: "Exceeds Expectations",
  ME: "Meets Expectations",
  AE: "Approaches Expectations",
  BE: "Below Expectations",
};

const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: "BFBFBF" };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const thickBorder = { style: BorderStyle.SINGLE, size: 10, color: "A3123F" };

// A4 portrait, in DXA (1440 = 1in). A report form is one learner at a
// time -- unlike the marklist export, it's not column-width-constrained,
// so portrait is the right shape here, not landscape.
const PAGE_W = 11907;
const PAGE_H = 16840;
const MARGIN = 700;
// Usable width inside the page margins -- every table below is sized to
// exactly this, so nothing overflows the printable area.
const USABLE_W = PAGE_W - MARGIN * 2;

function headerCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: MAROON },
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorders,
    margins: { top: 80, bottom: 80, left: 90, right: 90 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Calibri", size: 16 })],
      }),
    ],
  });
}

function dataCell(
  text: string,
  width: number,
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; bold?: boolean; color?: string; fill?: string; size?: number } = {}
) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorders,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.CENTER,
        children: [
          new TextRun({ text, bold: !!opts.bold, color: opts.color ?? "241417", font: "Calibri", size: opts.size ?? 18 }),
        ],
      }),
    ],
  });
}

// A bordered box holding an auto-generated comment, the signer's
// printed name, and a signature/date line -- the standard report-form
// pattern (a ruled box the remark sits inside, with the name already
// printed so nobody has to guess whose handwriting is required).
function commentBox(label: string, text: string, signerName: string, signerLabel: string) {
  return new Table({
    width: { size: USABLE_W, type: WidthType.DXA },
    columnWidths: [USABLE_W],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: USABLE_W, type: WidthType.DXA },
            borders: {
              top: thickBorder, bottom: thickBorder, left: thickBorder, right: thickBorder,
            },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: label, bold: true, size: 18, color: MAROON, font: "Calibri" })],
              }),
              new Paragraph({
                spacing: { after: 160 },
                children: [new TextRun({ text: text || " ", size: 20, font: "Calibri" })],
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: `${signerLabel}: `, size: 18, font: "Calibri", color: "6b5b5d" }),
                  new TextRun({ text: signerName || "____________________________", bold: !!signerName, size: 18, font: "Calibri" }),
                  new TextRun({ text: "          Signature: ______________________          Date: ____________", size: 18, font: "Calibri" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// Compact legend explaining the CBC performance levels used in the
// "Level" column -- standard on printed CBC report forms so a parent
// can read the table without a key elsewhere.
function gradingKeyRow(tableWidth: number) {
  const w = tableWidth / 4;
  const cells = (["EE", "ME", "AE", "BE"] as const).map((lvl) =>
    dataCell(`${LEVEL_TEXT[lvl]} — ${LEVEL_MEANING[lvl]}`, w, {
      align: AlignmentType.LEFT,
      fill: LEVEL_FILL[lvl],
      color: LEVEL_COLOR[lvl],
      bold: true,
      size: 16,
    })
  );
  return new TableRow({ children: cells });
}

export interface ReportFormData {
  schoolName: string;
  examTitle: string; // e.g. "GRADE 9A5 MID TERM EXAM TERM 2 2026"
  row: MarklistRow;
  classSize: number;
  teacherComment: string; // class teacher's comment -- auto-filled, teacher-editable
  headTeacherComment: string; // head teacher's comment -- auto-filled from overall level
  classTeacherName: string;
  headTeacherName: string;
  subjectTeacherByGroupKey: Record<string, string>;
  progress: { label: string; percentage: number }[];
  termEndsOn: string;
  nextTermBeginsOn: string;
}

// Compact progress graph. It deliberately uses a table rather than an
// embedded chart image so the report stays portable, prints cleanly, and
// does not require a charting runtime inside Word. Each row is one exam;
// ten filled cells represent the learner's percentage.
function progressGraph(progress: { label: string; percentage: number }[]) {
  const points = progress.slice(-6);
  const LABEL_W = 2600;
  const PCT_W = 900;
  const BAR_W = USABLE_W - LABEL_W - PCT_W;
  const SEG_W = BAR_W / 10;
  const ROW_H = 270;

  const rows: TableRow[] = [];
  if (points.length < 2) {
    rows.push(new TableRow({
      height: { value: ROW_H * 6, rule: HeightRule.EXACT },
      children: [
        new TableCell({
          width: { size: USABLE_W, type: WidthType.DXA },
          columnSpan: 12,
          verticalAlign: VerticalAlign.CENTER,
          borders: cellBorders,
          shading: { type: ShadingType.CLEAR, fill: "F8F3F4" },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "Building today for a brighter tomorrow.", bold: true, size: 17, color: MAROON, font: "Calibri" })],
            }),
          ],
        }),
      ],
    }));
  } else {
    for (let r = 0; r < 6; r++) {
      const point = points[r];
      if (!point) {
        rows.push(new TableRow({
          height: { value: ROW_H, rule: HeightRule.EXACT },
          children: [new TableCell({
            width: { size: USABLE_W, type: WidthType.DXA },
            columnSpan: 12,
            borders: cellBorders,
            shading: { type: ShadingType.CLEAR, fill: "FFFFFF" },
            children: [new Paragraph({ text: "" })],
          })],
        }));
        continue;
      }
      const filled = Math.max(0, Math.min(10, Math.round(point.percentage / 10)));
      const barCells = Array.from({ length: 10 }, (_, i) =>
        new TableCell({
          width: { size: SEG_W, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: i < filled ? MAROON : "F1EAEC" },
          borders: cellBorders,
          margins: { top: 35, bottom: 35, left: 20, right: 20 },
          children: [new Paragraph({ text: "" })],
        })
      );
      rows.push(new TableRow({
        height: { value: ROW_H, rule: HeightRule.EXACT },
        children: [
          dataCell(point.label, LABEL_W, { align: AlignmentType.LEFT, size: 14 }),
          ...barCells,
          dataCell(`${point.percentage}%`, PCT_W, { bold: true, color: MAROON, size: 14 }),
        ],
      }));
    }
  }

  return new Table({
    width: { size: USABLE_W, type: WidthType.DXA },
    columnWidths: [LABEL_W, ...Array.from({ length: 10 }, () => SEG_W), PCT_W],
    layout: TableLayoutType.FIXED,
    rows,
  });
}

// Builds every element of ONE learner's report -- everything except the
// page setup -- so both the single-learner export and the whole-class
// batch export (below) render an identical layout from one place.
function buildReportBody(data: ReportFormData, logoBuffer: ArrayBuffer | null): (Paragraph | Table)[] {
  const { schoolName, examTitle, row, classSize, teacherComment, headTeacherComment, classTeacherName, headTeacherName, subjectTeacherByGroupKey, progress, termEndsOn, nextTermBeginsOn } = data;

  const SUBJ_W = 2500;
  const SCORE_W = 1300;
  const PCT_W = 1000;
  const LEVEL_W = 1300;
  const REMARK_W = 2500;
  const TEACHER_W = USABLE_W - SUBJ_W - SCORE_W - PCT_W - LEVEL_W - REMARK_W;
  const tableWidth = USABLE_W;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("Learning Area", SUBJ_W),
      headerCell("Score", SCORE_W),
      headerCell("%", PCT_W),
      headerCell("Level", LEVEL_W),
      headerCell("Remark", REMARK_W),
      headerCell("Teacher", TEACHER_W),
    ],
  });

  const dataRows = row.groups.map((g) => {
    const pct = g.score !== null && g.maxMarks ? Math.round((g.score / g.maxMarks) * 1000) / 10 : null;
    const level = g.level;
    return new TableRow({
      children: [
        dataCell(g.fullLabel, SUBJ_W, { align: AlignmentType.LEFT, bold: true }),
        dataCell(g.score !== null ? `${g.score} / ${g.maxMarks}` : "—", SCORE_W),
        dataCell(pct !== null ? `${pct}%` : "—", PCT_W),
        dataCell(level ? LEVEL_TEXT[level] : "—", LEVEL_W, {
          fill: level ? LEVEL_FILL[level] : undefined,
          color: level ? LEVEL_COLOR[level] : undefined,
          bold: !!level,
        }),
        dataCell(generateSubjectRemark(level), REMARK_W, { align: AlignmentType.LEFT, size: 16 }),
        dataCell(subjectTeacherByGroupKey[g.key] || "—", TEACHER_W, { align: AlignmentType.LEFT, size: 16 }),
      ],
    });
  });

  const totalRow = new TableRow({
    children: [
      dataCell("GRAND TOTAL", SUBJ_W, { align: AlignmentType.LEFT, bold: true }),
      dataCell(`${row.grandTotal} / ${row.grandMax}`, SCORE_W, { bold: true }),
      dataCell(row.grandMax ? `${Math.round((row.grandTotal / row.grandMax) * 1000) / 10}%` : "—", PCT_W, { bold: true }),
      dataCell(row.grandMax ? LEVEL_TEXT[cbcLevel((row.grandTotal / row.grandMax) * 100)] : "—", LEVEL_W, {
        fill: row.grandMax ? LEVEL_FILL[cbcLevel((row.grandTotal / row.grandMax) * 100)] : undefined,
        color: row.grandMax ? LEVEL_COLOR[cbcLevel((row.grandTotal / row.grandMax) * 100)] : undefined,
        bold: row.grandMax > 0,
      }),
      dataCell(`Position: ${row.rank} out of ${classSize}`, REMARK_W, { align: AlignmentType.LEFT, bold: true, size: 16 }),
      dataCell("", TEACHER_W),
    ],
  });

  // Learner/exam identity strip -- full width, no photo box.
  const infoColW = tableWidth / 4;
  const infoTable = new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: [infoColW, infoColW, infoColW, infoColW],
    layout: TableLayoutType.FIXED,
    rows: [
      infoRow("Name", row.learner.name, "Admission No.", row.learner.admission_number, tableWidth),
      infoRow("Class", row.className ?? "", "Assessment", examTitle, tableWidth),
    ],
  });

  function infoRow(label1: string, value1: string, label2: string, value2: string, totalW: number) {
    const w = totalW / 4;
    return new TableRow({
      children: [
        dataCell(label1, w, { align: AlignmentType.LEFT, bold: true, fill: "F5F0F1" }),
        dataCell(value1, w, { align: AlignmentType.LEFT }),
        dataCell(label2, w, { align: AlignmentType.LEFT, bold: true, fill: "F5F0F1" }),
        dataCell(value2, w, { align: AlignmentType.LEFT }),
      ],
    });
  }

  return [
    ...(logoBuffer
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [
              new ImageRun({
                data: logoBuffer,
                type: "png",
                transformation: { width: LOGO_W, height: LOGO_H },
              }),
            ],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text: schoolName, bold: true, size: 30, color: MAROON, font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: "LEARNER'S REPORT FORM", bold: true, size: 24, color: "241417", font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: examTitle, size: 20, color: "6b5b5d", font: "Calibri" })],
    }),

    infoTable,
    new Paragraph({ text: "", spacing: { after: 140 } }),

    // layout: FIXED matters most on THIS table. Without it, Word doesn't
    // reliably honour the per-cell DXA widths above -- it's free to
    // recompute column widths from cell content instead, and on a
    // six-column table where several rows wrap onto two lines (a long
    // teacher name, a longer remark) that recompute is where the
    // Teacher header and several data cells were showing up detached
    // from the table, overlapping other content instead of sitting in
    // their column. AUTOFIT is docx's default when layout isn't set.
    new Table({
      width: { size: tableWidth, type: WidthType.DXA },
      columnWidths: [SUBJ_W, SCORE_W, PCT_W, LEVEL_W, REMARK_W, TEACHER_W],
      layout: TableLayoutType.FIXED,
      rows: [headerRow, ...dataRows, totalRow],
    }),

    new Paragraph({ text: "", spacing: { after: 140 } }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: "Key to Performance Levels", bold: true, size: 16, color: "6b5b5d", font: "Calibri" })],
    }),
    new Table({
      width: { size: tableWidth, type: WidthType.DXA },
      columnWidths: [tableWidth / 4, tableWidth / 4, tableWidth / 4, tableWidth / 4],
      layout: TableLayoutType.FIXED,
      rows: [gradingKeyRow(tableWidth)],
    }),

    ...(progressGraph(progress) ? [
      new Paragraph({
        spacing: { before: 160, after: 70 },
        children: [new TextRun({ text: "Learner Progress", bold: true, size: 16, color: MAROON, font: "Calibri" })],
      }),
      progressGraph(progress)!,
    ] : []),

    new Paragraph({ text: "", spacing: { after: 180 } }),
    commentBox("Class Teacher's Comment", teacherComment, classTeacherName, "Class Teacher"),
    new Paragraph({ text: "", spacing: { after: 180 } }),
    commentBox("Head Teacher's Comment", headTeacherComment, headTeacherName, "Head Teacher"),

    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [
        new TextRun({ text: "Term ends: ", bold: true, size: 16, color: "6b5b5d", font: "Calibri" }),
        new TextRun({ text: termEndsOn || "Not set", size: 16, color: "241417", font: "Calibri" }),
        new TextRun({ text: "   ·   Next term begins: ", bold: true, size: 16, color: "6b5b5d", font: "Calibri" }),
        new TextRun({ text: nextTermBeginsOn || "Not set", size: 16, color: "241417", font: "Calibri" }),
      ],
    }),
  ];
}

export async function exportReportFormDocx(data: ReportFormData & { filename: string }) {
  const { filename, ...reportData } = data;
  const logoBuffer = await loadLogo().catch(() => null);
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "School Motto: Strive for Excellence.", size: 14, color: MAROON, font: "Calibri", italics: true })],
            })],
          }),
        },
        children: buildReportBody(reportData, logoBuffer),
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename.endsWith(".docx") ? filename : `${filename}.docx`);
}

// Whole-class batch export -- one Word file, one report form per
// learner, each starting on its own page (a page-break paragraph is
// inserted before every learner after the first). This is what a
// school office prints in one go, rather than opening 40 separate
// downloads. Comments for every learner here are the auto-generated
// ones (see src/pages/ReportForms.tsx) -- there's no per-learner
// editing step in a batch this size, by design; a teacher who wants to
// hand-edit one learner's comment first uses the single-learner export
// instead, then re-runs the batch once everyone's marks are final.
export async function exportReportFormsBatchDocx(opts: {
  reports: ReportFormData[];
  filename: string;
}) {
  const { reports, filename } = opts;
  const logoBuffer = await loadLogo().catch(() => null);

  const children: (Paragraph | Table)[] = [];
  reports.forEach((data, i) => {
    if (i > 0) children.push(new Paragraph({ children: [], pageBreakBefore: true }));
    children.push(...buildReportBody(data, logoBuffer));
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "School Motto: Strive for Excellence.", size: 14, color: MAROON, font: "Calibri", italics: true })],
            })],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename.endsWith(".docx") ? filename : `${filename}.docx`);
}
