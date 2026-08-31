// A teacher's lifecycle state. "left" means deactivated: their Auth
// login is banned (see supabase/functions/deactivate-teacher), but
// their row, assignments, and every mark they've entered are kept
// intact so historical reports and audit trails stay accurate. This is
// distinct from actually being deleted -- see schema.sql migration v6.
export type TeacherStatus = "active" | "left";

export interface Teacher {
  id: string;
  name: string;
  tsc_number: string | null;
  phone_number: string;
  role: "admin" | "teacher";
  is_head_teacher: boolean;
  is_bootstrap_admin: boolean;
  status: TeacherStatus;
  created_at: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  created_at: string;
}

// A class can have more than one class teacher (see supabase/schema.sql,
// public.class_teachers). This is the single source of truth for "who
// is a class teacher of what" -- nothing on SchoolClass itself anymore.
export interface ClassTeacher {
  class_id: string;
  teacher_id: string;
  created_at: string;
}

export interface Subject {
  id: string;
  name: string;
  created_at: string;
}

// A learner's lifecycle state. "active" learners appear in current
// rosters, mark entry, results, and report forms. The other three are
// soft-deleted states -- the row (and all of their marks history) is
// kept forever; they're just filtered out of current-roster views. See
// supabase/schema.sql migration v5 for why hard delete was replaced
// with this.
export type LearnerStatus = "active" | "graduated" | "transferred" | "withdrawn";

export interface Learner {
  id: string;
  name: string;
  admission_number: string;
  class_id: string;
  status: LearnerStatus;
  created_at: string;
}

export const LEARNER_STATUS_LABELS: Record<LearnerStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  transferred: "Transferred",
  withdrawn: "Withdrawn",
};

// One row per learner per academic year: which class they were in.
// Kept in sync automatically by a DB trigger -- the app never writes to
// this table directly except via promote_class()/graduate_class().
export interface Enrollment {
  id: string;
  learner_id: string;
  class_id: string;
  academic_year_id: string;
  created_at: string;
}

// One row per (class, subject, academic year): who taught that
// class+subject that year. teacher_name is a snapshot taken at the
// time, independent of whether the teacher row still exists or has
// since been edited -- see supabase/schema.sql migration v7 for why.
export interface SubjectTeacherHistory {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
  teacher_name: string;
  academic_year_id: string;
  created_at: string;
}

// One row per (class, teacher, academic year) a class can have more
// than one class teacher in a given year (co-class-teachers).
export interface ClassTeacherHistory {
  id: string;
  class_id: string;
  teacher_id: string | null;
  teacher_name: string;
  academic_year_id: string;
  created_at: string;
}

// One row per academic year: who was THE head teacher that year.
export interface HeadTeacherHistory {
  id: string;
  teacher_id: string | null;
  teacher_name: string;
  academic_year_id: string;
  created_at: string;
}

export interface TeacherAssignment {
  id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string;
  created_at: string;
}

export interface AcademicYear {
  id: string;
  year: number;
  // Exactly one academic year is current at a time (enforced by a
  // partial unique index in the DB). Promotions and new enrollments are
  // always recorded against whichever year is current -- mark the new
  // year current BEFORE running promotions at year rollover.
  is_current: boolean;
  created_at: string;
}

export interface TermCalendar {
  id: string;
  academic_year_id: string;
  term: 1 | 2 | 3;
  term_ends_on: string;
  next_term_begins_on: string;
  created_at: string;
  updated_at: string;
}

export interface Exam {
  id: string;
  name: string;
  term: 1 | 2 | 3;
  academic_year_id: string;
  locked: boolean;
  created_at: string;
}

export interface ExamSubjectConfig {
  exam_id: string;
  subject_id: string;
  max_marks: number;
  set_by: string | null;
  updated_at: string;
}

export interface Mark {
  id: string;
  exam_id: string;
  learner_id: string;
  subject_id: string;
  score: number;
  entered_by: string | null;
  updated_at: string;
}

// School's grading system, applied to a percentage (score / max * 100):
//   >= 75  -> E.E  (Exceeds Expectations)
//   >= 50  -> M.E  (Meets Expectations)
//   >= 25  -> A.E  (Approaches Expectations)
//   else   -> B.E  (Below Expectations)
export function cbcLevel(score: number): string {
  if (score >= 75) return "EE";
  if (score >= 50) return "ME";
  if (score >= 25) return "AE";
  return "BE";
}

// The school's learning areas are fixed by the CBC curriculum for this
// grade band — they are NOT admin-editable. See supabase/schema.sql,
// where the subjects table only grants SELECT to app users; only this
// list (via the seed insert in that same file) can ever populate it.
// A group of one subject stands alone in the marklist; a group of two
// (English+Composition, Kiswahili+Insha) is combined into one graded
// column, matching the school's existing mark sheet.
// `label` is the short form used anywhere space is tight (mark entry,
// dense tables). `fullLabel` is the full CBC learning-area name, used
// only where there's room to spell it out (the report form).
export const SUBJECT_GROUPS = [
  { key: "math", label: "Math", fullLabel: "Mathematics", subjectNames: ["Math"] },
  { key: "english", label: "English", fullLabel: "English", subjectNames: ["English", "Composition"] },
  { key: "kiswahili", label: "Kiswahili", fullLabel: "Kiswahili", subjectNames: ["Kiswahili", "Insha"] },
  { key: "pre_tech", label: "Pre-Tech", fullLabel: "Pre-Technical Studies", subjectNames: ["Pre-Tech"] },
  { key: "c_a", label: "C/A", fullLabel: "Creative Arts", subjectNames: ["C/A"] },
  { key: "agri", label: "Agri", fullLabel: "Agriculture", subjectNames: ["Agri"] },
  { key: "cre", label: "CRE", fullLabel: "Christian Religious Education", subjectNames: ["CRE"] },
  { key: "sst", label: "SST", fullLabel: "Social Studies", subjectNames: ["SST"] },
  { key: "int_sci", label: "Int-Sci", fullLabel: "Integrated Science", subjectNames: ["Int-Sci"] },
];

// Flat list of the 11 real learning areas, derived from the groups above
// so there is exactly one place that defines what they are.
export const FIXED_SUBJECTS = SUBJECT_GROUPS.flatMap((g) => g.subjectNames);

// Full spelled-out name for each individual subject row as stored in the
// `subjects` table (as opposed to SUBJECT_GROUPS.fullLabel above, which
// is the combined *group* name -- e.g. "English" covers both English and
// Composition together). Used on the System Admin > Learning Areas page,
// where each subject is listed on its own and there's room to spell it
// out in full; the marklist/mark-entry screens keep the short `name`
// as-is everywhere else, since those tables are column-width constrained.
export const SUBJECT_FULL_NAMES: Record<string, string> = {
  "Math": "Mathematics",
  "English": "English Language",
  "Composition": "English Composition",
  "Kiswahili": "Kiswahili",
  "Insha": "Kiswahili Insha",
  "Pre-Tech": "Pre-Technical Studies",
  "C/A": "Creative Arts",
  "Agri": "Agriculture",
  "CRE": "Christian Religious Education",
  "SST": "Social Studies",
  "Int-Sci": "Integrated Science",
};

export const CBC_COLORS: Record<string, string> = {
  EE: "#22c55e",
  ME: "#3b82f6",
  AE: "#f59e0b",
  BE: "#ef4444",
};

export const CBC_LABELS: Record<string, string> = {
  EE: "Exceeds Expectations",
  ME: "Meets Expectations",
  AE: "Approaches Expectations",
  BE: "Below Expectations",
};
