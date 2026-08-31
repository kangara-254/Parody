import { MarklistRow, AnalysisRow } from "./marklist";
import { cbcLevel } from "../types";

// Opening line keyed by the learner's OVERALL CBC level (grand total as a
// percentage of grand max, graded with the same cbcLevel() used
// everywhere else in the app -- see README §4, "CBC grading thresholds").
// {name} and {pct} are substituted in below.
const OPENERS: Record<string, string> = {
  EE: "{name} has performed excellently this term, exceeding expectations overall with an average of {pct}%.",
  ME: "{name} has performed well this term, meeting expectations overall with an average of {pct}%.",
  AE: "{name} is approaching expectations overall this term, with an average of {pct}%, and can do better with consistent effort.",
  BE: "{name} is below expectations overall this term, with an average of {pct}%, and needs close support.",
};

/**
 * Generates a starting-point teacher comment purely from the marks
 * already in `row` (and, when supplied, the class size for a position
 * line) -- no AI call, no external data. This is deliberately
 * rule-based (deterministic, auditable, free) rather than AI-generated:
 * every sentence traces directly to a specific score, so two runs on the
 * same marks always produce the same comment, and a teacher checking it
 * against the marklist can see exactly why it says what it says.
 *
 * Names every subject by its full name (never the abbreviated column
 * code like "C/A"), cites the actual percentage behind each claim, and
 * covers every subject that's genuinely a strength or a concern -- not
 * just the single best and single worst -- so the comment reads like
 * someone who looked at all the marks, not just the top and bottom row.
 *
 * This is a PRE-FILL, not a final comment -- the textarea in
 * Results.tsx that consumes this stays fully editable, and the report
 * form export doesn't care whether the text it receives was generated
 * here or typed by hand. Don't wire this to auto-submit/auto-download
 * without the teacher seeing and being able to edit the text first.
 */
export function generateTeacherComment(row: MarklistRow, classSize?: number): string {
  const graded = row.groups.filter(
    (g): g is typeof g & { score: number; maxMarks: number; level: string } =>
      g.score !== null && g.maxMarks !== null && g.maxMarks > 0 && !!g.level
  );
  if (graded.length === 0) return "";

  const firstName = row.learner.name.trim().split(/\s+/)[0];
  const overallPct = row.grandMax > 0 ? Math.round((row.grandTotal / row.grandMax) * 100) : 0;
  const overallLevel = cbcLevel(overallPct);

  const withPct = graded.map((g) => ({ ...g, pct: Math.round((g.score / g.maxMarks) * 100) }));
  const byPct = [...withPct].sort((a, b) => b.pct - a.pct);

  // Every genuinely strong subject (E.E/M.E), not just the single best --
  // a learner who's strong in three subjects deserves all three named.
  const strengths = byPct.filter((g) => g.level === "EE" || g.level === "ME");
  // Every genuinely weak subject (A.E/B.E), worst first.
  const weaknesses = [...byPct].reverse().filter((g) => g.level === "AE" || g.level === "BE");

  const sentences: string[] = [];
  sentences.push(OPENERS[overallLevel].replace("{name}", firstName).replace("{pct}", String(overallPct)));

  // Only worth calling out subject-level strength when there's more than
  // one graded subject -- with just one, "strength" is a restatement of
  // the opener.
  if (graded.length > 1 && strengths.length > 0) {
    const named = strengths.map((g) => `${g.fullLabel} (${g.pct}%)`);
    if (named.length === 1) {
      sentences.push(`${firstName} shows particular strength in ${named[0]}.`);
    } else if (named.length === 2) {
      sentences.push(`${firstName} shows particular strength in ${named[0]} and ${named[1]}.`);
    } else {
      const last = named[named.length - 1];
      const rest = named.slice(0, -1).join(", ");
      sentences.push(`${firstName} shows particular strength in ${rest}, and ${last}.`);
    }
  }

  if (graded.length > 1 && weaknesses.length > 0) {
    const named = weaknesses.map((g) => `${g.fullLabel} (${g.pct}%)`);
    if (named.length === 1) {
      sentences.push(`More effort and support is needed in ${named[0]} going forward.`);
    } else {
      sentences.push(`More effort and support is needed in ${named.join(" and ")} going forward.`);
    }
  } else if (overallLevel === "EE" || overallLevel === "ME") {
    sentences.push("Keep up the good work.");
  }

  // Position in class -- concrete standing, not just a level label.
  if (classSize && classSize > 1 && row.rank > 0) {
    sentences.push(`This places ${firstName} at position ${row.rank} out of ${classSize} in the class this term.`);
  }

  return sentences.join(" ");
}

// Short, deterministic remark for a single learning area's row on the
// report form -- keyed only by that subject's CBC level, same
// rule-based philosophy as generateTeacherComment above (auditable,
// free, and consistent between runs). This is intentionally NOT a full
// sentence about the learner by name: with 9 rows per learner across a
// whole class, a one-line phrase per subject is what a teacher can
// actually review at a glance, and it's what a printed CBC report form
// expects in the "Remark" column.
const SUBJECT_REMARKS: Record<string, string> = {
  EE: "Excellent work, keep it up",
  ME: "Good effort, meets expectations",
  AE: "Fair, more effort needed",
  BE: "Below expectations, needs support",
};

export function generateSubjectRemark(level: string | null): string {
  if (!level) return "Not graded";
  return SUBJECT_REMARKS[level] ?? "Not graded";
}

// Short standard endorsement for the Head Teacher's line on the report
// form, keyed by the learner's OVERALL level. Deliberately shorter and
// more general than the class teacher's comment above -- the head
// teacher is endorsing the term's result, not restating what the class
// teacher already said subject-by-subject. Still cites the actual
// percentage and, when the class size is known, the learner's position,
// so it isn't just a stock phrase repeated for every learner at the
// same level.
const HEAD_TEACHER_REMARKS: Record<string, string> = {
  EE: "An excellent overall performance this term, with an average of {pct}%. Well done.",
  ME: "A good overall performance this term, with an average of {pct}%. Keep it up.",
  AE: "A fair performance this term, with an average of {pct}%. More effort is required.",
  BE: "A weak performance this term, with an average of {pct}%. Needs close monitoring and support.",
};

export function generateHeadTeacherComment(row: MarklistRow, classSize?: number): string {
  if (row.grandMax === 0) return "";
  const overallPct = Math.round((row.grandTotal / row.grandMax) * 100);
  const base = (HEAD_TEACHER_REMARKS[cbcLevel(overallPct)] ?? "").replace("{pct}", String(overallPct));
  if (classSize && classSize > 1 && row.rank > 0) {
    return `${base} Position ${row.rank} of ${classSize}.`;
  }
  return base;
}

// Rule-based performance overview for the class Analysis export -- same
// philosophy as the comments above (deterministic, auditable, derived
// purely from the E.E/M.E/A.E/B.E counts already on screen, no AI call).
// Digs past the single headline % into concrete counts, a runner-up
// when the top two areas are close, a secondary concern area, a spread
// comment (how many areas are solidly strong vs. genuinely at risk),
// and a concrete next step -- the things a head teacher can actually
// act on, not just a restatement of the table above it.
export function generateAnalysisInsights(rows: AnalysisRow[]): string[] {
  const graded = rows.filter((r) => r.total > 0);
  if (graded.length === 0) return [];

  const totalEntries = graded.reduce((sum, r) => sum + r.total, 0);
  const grand = graded.reduce(
    (acc, r) => ({ ee: acc.ee + r.ee, me: acc.me + r.me, ae: acc.ae + r.ae, be: acc.be + r.be }),
    { ee: 0, me: 0, ae: 0, be: 0 }
  );
  const meetingCount = grand.ee + grand.me;
  const meetingPct = totalEntries > 0 ? Math.round((meetingCount / totalEntries) * 100) : 0;
  const belowPct = totalEntries > 0 ? Math.round((grand.be / totalEntries) * 100) : 0;

  const withRates = graded.map((r) => ({
    ...r,
    meetingRate: r.total > 0 ? (r.ee + r.me) / r.total : 0,
    belowRate: r.total > 0 ? r.be / r.total : 0,
  }));

  const byMeeting = [...withRates].sort((a, b) => b.meetingRate - a.meetingRate);
  const byBelow = [...withRates].sort((a, b) => b.belowRate - a.belowRate);
  const strongest = byMeeting[0];
  const secondStrongest = byMeeting[1];
  const weakest = byBelow[0];
  const secondWeakest = byBelow[1];

  const strongCount = withRates.filter((r) => r.meetingRate >= 0.7).length;
  const atRiskCount = withRates.filter((r) => r.belowRate >= 0.2).length;

  const lines: string[] = [];

  // 1. Headline with real counts alongside the %, not just the %.
  lines.push(
    `${meetingCount} of ${totalEntries} learning-area assessments (${meetingPct}%) across ${graded.length} learning areas met or exceeded expectations (E.E / M.E) this term.`
  );

  // 2. Strongest area -- name a close runner-up instead of just one name if the gap is small.
  if (strongest && strongest.meetingRate > 0) {
    const strongPct = Math.round(strongest.meetingRate * 100);
    if (
      secondStrongest &&
      secondStrongest.meetingRate > 0 &&
      secondStrongest.key !== strongest.key &&
      strongPct - Math.round(secondStrongest.meetingRate * 100) <= 5
    ) {
      lines.push(
        `${strongest.fullLabel} and ${secondStrongest.fullLabel} lead the class, each with around ${strongPct}% of learners at E.E or M.E.`
      );
    } else {
      lines.push(
        `${strongest.fullLabel} is the standout learning area: ${strongest.ee + strongest.me} of ${strongest.total} learners (${strongPct}%) are at E.E or M.E.`
      );
    }
  }

  // 3. Weakest area with concrete counts, plus a secondary concern if a second area is also genuinely at risk.
  if (weakest && weakest.belowRate > 0 && weakest.key !== strongest?.key) {
    const weakPct = Math.round(weakest.belowRate * 100);
    lines.push(
      `${weakest.fullLabel} needs the closest attention: ${weakest.be} of ${weakest.total} learners (${weakPct}%) are below expectations.`
    );
    if (secondWeakest && secondWeakest.belowRate >= 0.2 && secondWeakest.key !== weakest.key) {
      lines.push(
        `${secondWeakest.fullLabel} is a secondary concern, with ${Math.round(secondWeakest.belowRate * 100)}% of learners below expectations.`
      );
    }
  } else if (belowPct === 0) {
    lines.push("No learning area currently has learners below expectations -- a strong term across the board.");
  }

  // 4. Spread across the whole class, not just the two extremes.
  if (graded.length >= 4) {
    lines.push(
      `${strongCount} of ${graded.length} learning areas have at least 70% of learners meeting or exceeding expectations, while ${atRiskCount} ${atRiskCount === 1 ? "has" : "have"} 20% or more below expectations.`
    );
  }

  // 5. A concrete next step tied to whatever is actually weak, not a generic sign-off.
  if (weakest && weakest.belowRate >= 0.2) {
    lines.push(`Worth prioritising targeted remedial support or peer tutoring in ${weakest.fullLabel} ahead of next term.`);
  }

  return lines;
}
