import {
  Teacher,
  TeacherAssignment,
  Subject,
  SUBJECT_GROUPS,
  ClassTeacher,
  SubjectTeacherHistory,
  ClassTeacherHistory,
  HeadTeacherHistory,
} from "../types";

/**
 * Resolves the names that print on a class's report forms:
 *  - one subject teacher name per learning-area GROUP (e.g. "English",
 *    which covers both English and Composition marks -- see
 *    SUBJECT_GROUPS in types.ts). Composition/Insha are never assigned
 *    or shown separately (same exclusion rule as
 *    src/pages/teacher/MyClassLearners.tsx's "Teachers & submissions"
 *    tab), so we always look up the assignment for the group's FIRST
 *    subject name (English, Kiswahili, etc.), which is the one that's
 *    actually assignable.
 *  - the class teacher(s) for the class (joined, e.g. "Jane Doe" or
 *    "Jane Doe & John Smith" if a class has co-class-teachers).
 *  - the head teacher (whichever teacher had is_head_teacher = true --
 *    see supabase/schema.sql and src/pages/admin/Teachers.tsx).
 *
 * HISTORICAL ACCURACY (schema.sql migration v7): if `academicYearId`
 * and the corresponding history arrays are supplied, each name is
 * resolved from subject_teacher_history / class_teacher_history /
 * head_teacher_history FOR THAT YEAR first -- these are permanent
 * snapshots (teacher_name is stored as text, not just a live FK), so
 * reprinting an old report form keeps showing who actually held the
 * role that year even after they've left, been reassigned, or been
 * permanently deleted. Falls back to the CURRENT teacher_assignments/
 * class_teachers/teachers tables only when no history row exists yet
 * for that year (i.e. exams that predate this migration) -- this keeps
 * old callers (and years without history data) working exactly as
 * before rather than showing blanks.
 *
 * All lookups return "" (never throw) when nothing is assigned yet, so
 * the report form can still be generated -- it just prints a blank
 * line instead of a name, same as a paper form would.
 */
export interface ReportRoster {
  subjectTeacherByGroupKey: Record<string, string>;
  classTeacherName: string;
  headTeacherName: string;
}

export function buildReportRoster(opts: {
  classId: string;
  subjects: Subject[];
  assignments: TeacherAssignment[];
  classTeachers: ClassTeacher[];
  teachers: Teacher[];
  academicYearId?: string;
  subjectTeacherHistory?: SubjectTeacherHistory[];
  classTeacherHistory?: ClassTeacherHistory[];
  headTeacherHistory?: HeadTeacherHistory[];
}): ReportRoster {
  const {
    classId,
    subjects,
    assignments,
    classTeachers,
    teachers,
    academicYearId,
    subjectTeacherHistory = [],
    classTeacherHistory = [],
    headTeacherHistory = [],
  } = opts;
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));

  const subjectTeacherByGroupKey: Record<string, string> = {};
  for (const g of SUBJECT_GROUPS) {
    const primarySubjectId = subjectIdByName.get(g.subjectNames[0]);

    const historyRow = academicYearId
      ? subjectTeacherHistory.find(
          (h) => h.class_id === classId && h.subject_id === primarySubjectId && h.academic_year_id === academicYearId
        )
      : undefined;
    if (historyRow) {
      subjectTeacherByGroupKey[g.key] = historyRow.teacher_name;
      continue;
    }

    // Fallback: no history row for this year (predates migration v7) --
    // resolve from the current assignment, same as before.
    const assignment = assignments.find(
      (a) => a.class_id === classId && a.subject_id === primarySubjectId
    );
    const teacher = assignment ? teacherById.get(assignment.teacher_id) : undefined;
    subjectTeacherByGroupKey[g.key] = teacher?.name ?? "";
  }

  // NOTE: a class with a genuinely empty class_teacher_history for a
  // year that DOES otherwise have history data (e.g. it had no
  // co-class-teacher recorded) is indistinguishable here from "this
  // year predates migration v7 entirely" -- both look like zero rows.
  // In that rare edge case this falls back to the CURRENT class
  // teacher(s), which could be wrong for that specific class in that
  // specific year. Same caveat applies to headTeacherName below. In
  // practice a class/school without a class or head teacher assigned
  // is itself an edge case worth fixing in the data, not the code.
  const historicalClassTeacherRows = academicYearId
    ? classTeacherHistory.filter((h) => h.class_id === classId && h.academic_year_id === academicYearId)
    : [];
  const classTeacherName =
    historicalClassTeacherRows.length > 0
      ? historicalClassTeacherRows.map((h) => h.teacher_name).join(" & ")
      : classTeachers
          .filter((ct) => ct.class_id === classId)
          .map((ct) => teacherById.get(ct.teacher_id)?.name)
          .filter((n): n is string => !!n)
          .join(" & ");

  const historicalHeadTeacher = academicYearId
    ? headTeacherHistory.find((h) => h.academic_year_id === academicYearId)
    : undefined;
  const headTeacherName = historicalHeadTeacher
    ? historicalHeadTeacher.teacher_name
    : teachers.find((t) => t.is_head_teacher)?.name ?? "";

  return { subjectTeacherByGroupKey, classTeacherName, headTeacherName };
}
