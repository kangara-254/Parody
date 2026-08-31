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

function gradeFormula(scoreCellRef: string, maxCellRef: string): string {
  const pct = `((${scoreCellRef}/${maxCellRef})*100)`;
  return `IF(${pct}>=75,"E.E",IF(${pct}>=50,"M.E",IF(${pct}>=25,"A.E","B.E")))`;
}

function headerBand(ws: ExcelJS.Worksheet, row: number, lastCol: number, text: string) {
  ws.mergeCells(row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: "Arial", bold: true, size: 12, color: { argb: WHITE } };
  cell.fill = fill(BRAND_MAROON);
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
}) {
  const { title, schoolName, rows, totals, includeClassColumn, filename } = opts;
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

  headerBand(ws, 1, lastCol, schoolName);
  headerBand(ws, 2, lastCol, title);

  const headerRow = ws.getRow(3);
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 10 };
    cell.fill = fill(GRAY);
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

    r.groups.forEach((g, gi) => {
      const sc = scoreColOf(gi);
      const gc = gradeColOf(gi);
      const scoreCell = row.getCell(sc);
      const gradeCell = row.getCell(gc);
      if (g.score === null || g.maxMarks === null) {
        scoreCell.value = null;
        gradeCell.value = null;
      } else {
        scoreCell.value = g.score;
        // A helper column holding the group's max marks isn't shown on
        // screen elsewhere, so we bake the max directly into the
        // formula as a literal -- it's fixed per exam+subject anyway.
        const scoreRef = `${ws.getColumn(sc).letter}${rowNum}`;
        gradeCell.value = { formula: gradeFormula(scoreRef, String(g.maxMarks)), result: LEVEL_TEXT[g.level ?? ""] ?? "" };
        gradeCell.fill = fill(LEVEL_FILL[g.level ?? ""] ?? "FFFFFFFF");
      }
    });
    row.getCell(gtotCol).value = r.grandTotal;

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
  groupKeys.forEach((key, gi) => {
    const sc = scoreColOf(gi);
    const letter = ws.getColumn(sc).letter;
    ws.getRow(totalRow).getCell(sc).value = {
      formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
      result: totals.groupTotals[key] ?? 0,
    };
    ws.getRow(avgRow).getCell(sc).value = {
      formula: `ROUND(AVERAGE(${letter}${firstDataRow}:${letter}${lastDataRow}),1)`,
      result: totals.groupAverages[key] ?? 0,
    };
  });
  const gtotLetter = ws.getColumn(gtotCol).letter;
  ws.getRow(totalRow).getCell(gtotCol).value = {
    formula: `SUM(${gtotLetter}${firstDataRow}:${gtotLetter}${lastDataRow})`,
    result: totals.grandTotal ?? 0,
  };
  ws.getRow(avgRow).getCell(gtotCol).value = {
    formula: `ROUND(AVERAGE(${gtotLetter}${firstDataRow}:${gtotLetter}${lastDataRow}),1)`,
    result: totals.grandAverage ?? 0,
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
