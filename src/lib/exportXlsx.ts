import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { MarklistRow, MarklistTotals, AnalysisRow } from "./marklist";

const BRAND_MAROON = "FFA3123F";
const BRAND_NAVY = "FF243447";
const GRAY = "FFF0E9EB";
const WHITE = "FFFFFFFF";
const GREEN_FILL = "FFC6EFCE";
const BLUE_FILL = "FFBDD7EE";
const AMBER_FILL = "FFFFE699";
const RED_FILL = "FFFFC7CE";

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

const LEVEL_TEXT: Record<string, string> = { EE: "E.E", ME: "M.E", AE: "A.E", BE: "B.E" };
const LEVEL_FILL: Record<string, string> = { EE: GREEN_FILL, ME: BLUE_FILL, AE: AMBER_FILL, BE: RED_FILL };

// The marklist now shows each group's PERCENTAGE directly (not a raw
// combined score), so grading no longer needs to divide by a max --
// the cell being checked already IS the percentage.
function gradeFormula(percentageCellRef: string): string {
  return `IF(${percentageCellRef}>=75,"E.E",IF(${percentageCellRef}>=50,"M.E",IF(${percentageCellRef}>=25,"A.E","B.E")))`;
}

function headerBand(ws: ExcelJS.Worksheet, row: number, lastCol: number, text: string, plain?: boolean) {
  ws.mergeCells(row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: "Arial", bold: true, size: 12, color: { argb: plain ? "FF000000" : WHITE } };
  if (!plain) cell.fill = fill(BRAND_MAROON);
  cell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(row).height = 22;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: "thin", color: { argb: "FFBFBFBF" } };
  return { top: side, bottom: side, left: side, right: side };
}

export function exportMarklistXlsx(opts: {
  title: string;
  schoolName: string;
  rows: MarklistRow[];
  totals: MarklistTotals;
  includeClassColumn?: boolean;
  filename: string;
  // Plain mode: same layout and formulas, but no maroon title bands,
  // no gray header fill, and no green/blue/gold/red grade-cell shading --
  // just normal white cells with black text, for teachers who want a
  // plain sheet (e.g. to print on a black-and-white printer).
  plain?: boolean;
}) {
  const { title, schoolName, rows, totals, includeClassColumn, filename, plain } = opts;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Marklist");

  const groupKeys = rows[0]?.groups.map((g) => g.key) ?? [];
  const groupLabels = rows[0]?.groups.map((g) => g.label) ?? [];

  // Header layout: #, NAME, [CLASS], then per group [SCORE, GRADE], then G.TOT
  const headers: (string | null)[] = ["#", "NAME"];
  if (includeClassColumn) headers.push("CLASS");
  groupLabels.forEach((label) => headers.push(label, null));
  headers.push("G.TOT");
  const lastCol = headers.length;

  headerBand(ws, 1, lastCol, schoolName, plain);
  headerBand(ws, 2, lastCol, title, plain);

  const headerRow = ws.getRow(3);
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 10 };
    if (!plain) cell.fill = fill(GRAY);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  });

  const off = includeClassColumn ? 1 : 0;
  const scoreColOf = (groupIdx: number) => 3 + off + groupIdx * 2;
  const gradeColOf = (groupIdx: number) => scoreColOf(groupIdx) + 1;
  const gtotCol = lastCol;

  const firstDataRow = 4;
  rows.forEach((r, i) => {
    const rowNum = firstDataRow + i;
    const row = ws.getRow(rowNum);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = r.learner.name;
    if (includeClassColumn) row.getCell(3).value = r.className ?? "";

    let rowPercentageTotal = 0;
    r.groups.forEach((g, gi) => {
      const sc = scoreColOf(gi);
      const gc = gradeColOf(gi);
      const scoreCell = row.getCell(sc);
      const gradeCell = row.getCell(gc);
      if (g.percentage === null) {
        scoreCell.value = null;
        gradeCell.value = null;
      } else {
        const pct = Math.round(g.percentage * 10) / 10;
        scoreCell.value = pct;
        rowPercentageTotal += pct;
        const scoreRef = `${ws.getColumn(sc).letter}${rowNum}`;
        gradeCell.value = { formula: gradeFormula(scoreRef), result: LEVEL_TEXT[g.level ?? ""] ?? "" };
        if (!plain) gradeCell.fill = fill(LEVEL_FILL[g.level ?? ""] ?? "FFFFFFFF");
      }
    });
    // G.TOT is now the sum of the 9 group percentages (out of a
    // maximum possible 900), not a sum of raw scores -- this makes it
    // meaningful regardless of what any individual subject's max marks
    // is configured as.
    row.getCell(gtotCol).value = Math.round(rowPercentageTotal * 10) / 10;

    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder();
    }
  });

  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRow = lastDataRow + 1;
  const avgRow = totalRow + 1;
  ws.getRow(totalRow).getCell(2).value = "TOTAL";
  ws.getRow(avgRow).getCell(2).value = "AVERAGE";

  // Fallback "result" values shown before Excel recalculates the
  // formula: computed here from each group's PERCENTAGE (matching what
  // the cells actually hold now), not from `totals`, which is still
  // raw-score-based for the on-screen marklist elsewhere in the app.
  const percentagesByGroup: Record<string, number[]> = {};
  groupKeys.forEach((key) => (percentagesByGroup[key] = []));
  const rowPercentageTotals: number[] = [];
  rows.forEach((r) => {
    let total = 0;
    r.groups.forEach((g, gi) => {
      const key = groupKeys[gi];
      if (g.percentage !== null) {
        const pct = Math.round(g.percentage * 10) / 10;
        percentagesByGroup[key].push(pct);
        total += pct;
      }
    });
    rowPercentageTotals.push(Math.round(total * 10) / 10);
  });
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? Math.round((sum(arr) / arr.length) * 10) / 10 : 0);

  groupKeys.forEach((key, gi) => {
    const sc = scoreColOf(gi);
    const letter = ws.getColumn(sc).letter;
    ws.getRow(totalRow).getCell(sc).value = {
      formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
      result: Math.round(sum(percentagesByGroup[key]) * 10) / 10,
    };
    ws.getRow(avgRow).getCell(sc).value = {
      formula: `ROUND(AVERAGE(${letter}${firstDataRow}:${letter}${lastDataRow}),1)`,
      result: avg(percentagesByGroup[key]),
    };
  });
  const gtotLetter = ws.getColumn(gtotCol).letter;
  ws.getRow(totalRow).getCell(gtotCol).value = {
    formula: `SUM(${gtotLetter}${firstDataRow}:${gtotLetter}${lastDataRow})`,
    result: Math.round(sum(rowPercentageTotals) * 10) / 10,
  };
  ws.getRow(avgRow).getCell(gtotCol).value = {
    formula: `ROUND(AVERAGE(${gtotLetter}${firstDataRow}:${gtotLetter}${lastDataRow}),1)`,
    result: avg(rowPercentageTotals),
  };
  [totalRow, avgRow].forEach((rn) => {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getRow(rn).getCell(c);
      cell.font = { name: "Arial", bold: true, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder();
    }
  });

  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 20;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 8;

  wb.xlsx.writeBuffer().then((buf) => {
    saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
  });
}

export function exportAnalysisXlsx(opts: {
  title: string;
  schoolName: string;
  rows: AnalysisRow[];
  filename: string;
}) {
  const { title, schoolName, rows, filename } = opts;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Analysis");
  const lastCol = 6;

  headerBand(ws, 1, lastCol, schoolName);
  headerBand(ws, 2, lastCol, title);

  const headers = ["LEARNING AREA", "E.E", "M.E", "A.E", "B.E", "TOTAL"];
  headers.forEach((label, i) => {
    const cell = ws.getRow(3).getCell(i + 1);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 10 };
    cell.fill = fill(GRAY);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  });

  const grand = { ee: 0, me: 0, ae: 0, be: 0 };
  rows.forEach((r, i) => {
    const rowNum = 4 + i;
    const row = ws.getRow(rowNum);
    row.getCell(1).value = r.fullLabel;
    const values: [number, string][] = [
      [r.ee, GREEN_FILL],
      [r.me, BLUE_FILL],
      [r.ae, AMBER_FILL],
      [r.be, RED_FILL],
    ];
    values.forEach(([val, f], ci) => {
      const cell = row.getCell(2 + ci);
      cell.value = val;
      cell.fill = fill(f); // color the CELL, not the whole column/header
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder();
      cell.font = { name: "Arial", size: 10 };
    });
    const totalCell = row.getCell(6);
    totalCell.value = r.total; // always equals the class/grade learner count
    totalCell.alignment = { horizontal: "center", vertical: "middle" };
    totalCell.border = thinBorder();
    totalCell.font = { name: "Arial", size: 10 };
    row.getCell(1).font = { name: "Arial", bold: true, size: 10 };
    row.getCell(1).border = thinBorder();
    grand.ee += r.ee;
    grand.me += r.me;
    grand.ae += r.ae;
    grand.be += r.be;
  });

  const totalRow = 4 + rows.length;
  const tr = ws.getRow(totalRow);
  tr.getCell(1).value = "TOTAL";
  tr.getCell(2).value = grand.ee;
  tr.getCell(3).value = grand.me;
  tr.getCell(4).value = grand.ae;
  tr.getCell(5).value = grand.be;
  // This is the corner cell where the TOTAL row meets the TOTAL column --
  // "total of totals" is not a meaningful number here (it would just be
  // the grade-9/8/7 headcount multiplied up across every learning area),
  // so it stays blank rather than showing a confusing figure.
  tr.getCell(6).value = null;
  for (let c = 1; c <= 6; c++) {
    const cell = tr.getCell(c);
    cell.font = { name: "Arial", bold: true, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  }

  ws.getColumn(1).width = 30;
  for (let c = 2; c <= 6; c++) ws.getColumn(c).width = 10;

  wb.xlsx.writeBuffer().then((buf) => {
    saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
  });
}
