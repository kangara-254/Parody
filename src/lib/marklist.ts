import { Learner, Mark, Subject, SUBJECT_GROUPS, ExamSubjectConfig, cbcLevel } from "../types";

export interface MarklistGroupResult {
  key: string;
  label: string;
  fullLabel: string;
  score: number | null; // raw combined score, null if no marks entered for this group yet
  maxMarks: number | null; // combined max marks for the group (sum of each subject's configured max)
  level: string | null;
}

export interface MarklistRow {
  learner: Learner;
  className?: string; // used on the overall (grade-wide) marklist
  groups: MarklistGroupResult[];
  grandTotal: number;
  grandMax: number;
  rank: number;
}

export interface MarklistTotals {
  groupTotals: Record<string, number>;
  groupAverages: Record<string, number>;
  grandTotal: number;
  grandAverage: number;
}

function maxMarksFor(subjectId: string, config: Map<string, number>): number {
  return config.get(subjectId) ?? 100;
}

/**
 * Builds ranked marklist rows exactly matching the school's mark sheet:
 * some subjects stand alone, English+Composition and Kiswahili+Insha are
 * summed into one CBC-graded column each. Grading is always done as a
 * PERCENTAGE of the configured max marks for that exam+subject (which
 * may not be 100 -- a teacher can set Math to be out of 70, for example),
 * never off the raw score directly.
 */
export function buildMarklist(
  learners: (Learner & { className?: string })[],
  marks: Mark[],
  subjects: Subject[],
  examSubjectConfig: ExamSubjectConfig[]
): { rows: MarklistRow[]; totals: MarklistTotals } {
  const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));
  const maxBySubjectId = new Map(examSubjectConfig.map((c) => [c.subject_id, c.max_marks]));

  const rows: Omit<MarklistRow, "rank">[] = learners.map((learner) => {
    const learnerMarks = marks.filter((m) => m.learner_id === learner.id);
    let grandTotal = 0;
    let grandMax = 0;
    const groups: MarklistGroupResult[] = SUBJECT_GROUPS.map((g) => {
      const ids = g.subjectNames.map((n) => subjectIdByName.get(n)).filter(Boolean) as string[];
      const groupMarks = learnerMarks.filter((m) => ids.includes(m.subject_id));
      const groupMax = ids.reduce((sum, id) => sum + maxMarksFor(id, maxBySubjectId), 0);
      if (groupMarks.length === 0) return { key: g.key, label: g.label, fullLabel: g.fullLabel, score: null, maxMarks: groupMax, level: null };
      const score = groupMarks.reduce((sum, m) => sum + Number(m.score), 0);
      grandTotal += score;
      grandMax += groupMax;
      const percentage = groupMax > 0 ? (score / groupMax) * 100 : 0;
      return { key: g.key, label: g.label, fullLabel: g.fullLabel, score, maxMarks: groupMax, level: cbcLevel(percentage) };
    });
    return { learner, className: learner.className, groups, grandTotal, grandMax };
  });

  rows.sort((a, b) => b.grandTotal - a.grandTotal || a.learner.name.localeCompare(b.learner.name));
  const ranked: MarklistRow[] = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  const groupTotals: Record<string, number> = {};
  const groupAverages: Record<string, number> = {};
  SUBJECT_GROUPS.forEach((g) => {
    const values = ranked.map((r) => r.groups.find((x) => x.key === g.key)?.score).filter((v): v is number => v !== null);
    groupTotals[g.key] = values.reduce((a, b) => a + b, 0);
    groupAverages[g.key] = values.length ? Math.round((groupTotals[g.key] / values.length) * 100) / 100 : 0;
  });
  const grandTotal = ranked.reduce((sum, r) => sum + r.grandTotal, 0);
  const grandAverage = ranked.length ? Math.round((grandTotal / ranked.length) * 100) / 100 : 0;

  return { rows: ranked, totals: { groupTotals, groupAverages, grandTotal, grandAverage } };
}

export interface AnalysisRow {
  key: string;
  label: string;
  fullLabel: string;
  ee: number;
  me: number;
  ae: number;
  be: number;
  total: number; // always equals the number of learners graded for this learning area
}

/**
 * Grade-distribution analysis: one row per learning area (9 rows --
 * English and Kiswahili are each ONE row covering their combined pair,
 * Composition and Insha never get their own row), columns E.E/M.E/A.E/B.E,
 * and a TOTAL column that always sums to the number of learners who have
 * a grade for that learning area. Built from the same marklist rows so
 * it can never disagree with the marklist about anyone's grade.
 */
export function buildAnalysis(marklistRows: MarklistRow[]): AnalysisRow[] {
  return SUBJECT_GROUPS.map((g) => {
    const counts = { ee: 0, me: 0, ae: 0, be: 0 };
    marklistRows.forEach((row) => {
      const group = row.groups.find((x) => x.key === g.key);
      if (!group || !group.level) return;
      if (group.level === "EE") counts.ee++;
      else if (group.level === "ME") counts.me++;
      else if (group.level === "AE") counts.ae++;
      else if (group.level === "BE") counts.be++;
    });
    return {
      key: g.key,
      label: g.label,
      fullLabel: g.fullLabel,
      ee: counts.ee,
      me: counts.me,
      ae: counts.ae,
      be: counts.be,
      total: counts.ee + counts.me + counts.ae + counts.be,
    };
  });
}
