import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  Exam, Learner, SchoolClass, Subject, Mark, ExamSubjectConfig, AcademicYear,
  ClassTeacher, Teacher, TeacherAssignment, CBC_COLORS, TermCalendar, cbcLevel,
  SubjectTeacherHistory, ClassTeacherHistory, HeadTeacherHistory,
} from "../types";
import { buildMarklist, MarklistRow } from "../lib/marklist";
import { fetchHistoricalLearners } from "../lib/enrollment";
import { buildReportRoster } from "../lib/reportRoster";
import { generateTeacherComment, generateHeadTeacherComment } from "../lib/generateComment";
import { exportReportFormDocx, exportReportFormsBatchDocx, ReportFormData } from "../lib/exportReportDocx";
import { exportReportFormPdf, exportReportFormsBatchPdf } from "../lib/exportReportPdf";

const SCHOOL_NAME = "KARIOBANGI SOUTH PRIMARY AND JUNIOR SCHOOL";

export default function ReportForms() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [classTeachers, setClassTeachers] = useState<ClassTeacher[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [termDates, setTermDates] = useState<TermCalendar[]>([]);

  const [classId, setClassId] = useState("");
  const [examId, setExamId] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [examSubjectConfig, setExamSubjectConfig] = useState<ExamSubjectConfig[]>([]);
  const [historyMarks, setHistoryMarks] = useState<Mark[]>([]);
  const [historyConfigs, setHistoryConfigs] = useState<ExamSubjectConfig[]>([]);
  const [subjectTeacherHistory, setSubjectTeacherHistory] = useState<SubjectTeacherHistory[]>([]);
  const [classTeacherHistory, setClassTeacherHistory] = useState<ClassTeacherHistory[]>([]);
  const [headTeacherHistory, setHeadTeacherHistory] = useState<HeadTeacherHistory[]>([]);

  const [openLearnerId, setOpenLearnerId] = useState("");
  const [editedComment, setEditedComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchPdfBusy, setBatchPdfBusy] = useState(false);

  useEffect(() => {
    loadContext();
  }, []);

  async function loadContext() {
    if (!supabase) return;
    setLoading(true);
    const [c, s, e, y, ec, ct, t, ta, td] = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*").order("name"),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("academic_years").select("*").order("year", { ascending: false }),
      supabase.from("exam_classes").select("*"),
      supabase.from("class_teachers").select("*"),
      supabase.from("teachers").select("*"),
      supabase.from("teacher_assignments").select("*"),
      supabase.from("term_calendar").select("*"),
    ]);
    setClasses(c.data || []);
    setSubjects(s.data || []);
    setExams(e.data || []);
    setYears(y.data || []);
    setExamClasses(ec.data || []);
    setClassTeachers(ct.data || []);
    setTeachers(t.data || []);
    setAssignments(ta.data || []);
    setTermDates(td.data || []);
    setLoading(false);
  }

  const visibleClasses = useMemo(() => {
    if (user?.role === "admin") return classes;
    const myClassIds = new Set(classTeachers.filter((ct) => ct.teacher_id === user?.id).map((ct) => ct.class_id));
    return classes.filter((c) => myClassIds.has(c.id));
  }, [classes, classTeachers, user]);

  const examsForClass = useMemo(() => {
    if (!classId) return [];
    const ids = new Set(examClasses.filter((x) => x.class_id === classId).map((x) => x.exam_id));
    return exams.filter((e) => ids.has(e.id));
  }, [examClasses, exams, classId]);

  useEffect(() => {
    if (classId && examId) loadResults();
  }, [classId, examId]);

  async function loadResults() {
    if (!supabase) return;
    const classExamIds = examClasses
      .filter((x) => x.class_id === classId)
      .map((x) => x.exam_id);
    const exam = exams.find((e) => e.id === examId);
    // Use who was actually enrolled in this class for this exam's
    // academic year, not who currently is -- a report form reprinted
    // after a learner has been promoted or graduated should still show
    // them as they were when they sat this exam. See src/lib/enrollment.ts.
    const [l, m, cfg, hm, hcfg, sth, cth, hth] = await Promise.all([
      fetchHistoricalLearners(supabase, [classId], exam?.academic_year_id),
      supabase.from("marks").select("*").eq("exam_id", examId),
      supabase.from("exam_subject_config").select("*").eq("exam_id", examId),
      classExamIds.length ? supabase.from("marks").select("*").in("exam_id", classExamIds) : Promise.resolve({ data: [] as Mark[], error: null }),
      classExamIds.length ? supabase.from("exam_subject_config").select("*").in("exam_id", classExamIds) : Promise.resolve({ data: [] as ExamSubjectConfig[], error: null }),
      // Report-roster history (schema.sql migration v7) -- who actually
      // taught/led this class in this exam's academic year, so a
      // reprint stays accurate even after reassignment. Empty results
      // are expected and fine for years predating that migration;
      // buildReportRoster falls back to the current tables then.
      exam?.academic_year_id
        ? supabase.from("subject_teacher_history").select("*").eq("class_id", classId).eq("academic_year_id", exam.academic_year_id)
        : Promise.resolve({ data: [] as SubjectTeacherHistory[], error: null }),
      exam?.academic_year_id
        ? supabase.from("class_teacher_history").select("*").eq("class_id", classId).eq("academic_year_id", exam.academic_year_id)
        : Promise.resolve({ data: [] as ClassTeacherHistory[], error: null }),
      exam?.academic_year_id
        ? supabase.from("head_teacher_history").select("*").eq("academic_year_id", exam.academic_year_id)
        : Promise.resolve({ data: [] as HeadTeacherHistory[], error: null }),
    ]);
    setLearners(l);
    setMarks(m.data || []);
    setExamSubjectConfig(cfg.data || []);
    setHistoryMarks(hm.data || []);
    setHistoryConfigs(hcfg.data || []);
    setSubjectTeacherHistory(sth.data || []);
    setClassTeacherHistory(cth.data || []);
    setHeadTeacherHistory(hth.data || []);
  }

  const marklist = useMemo(
    () => buildMarklist(learners, marks, subjects, examSubjectConfig),
    [learners, marks, subjects, examSubjectConfig]
  );

  const currentClass = classes.find((c) => c.id === classId);
  const currentExam = exams.find((e) => e.id === examId);
  const currentYear = currentExam ? years.find((y) => y.id === currentExam.academic_year_id) : null;
  const currentTermDates = currentExam ? termDates.find((d) => d.academic_year_id === currentExam.academic_year_id && d.term === currentExam.term) : null;
  const formatDate = (value: string | undefined) => value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "Not set";

  const examTitle = currentClass && currentExam
    ? `${currentClass.name.toUpperCase()} ${currentExam.name.toUpperCase()} TERM ${currentExam.term} ${currentYear?.year ?? ""}`.trim()
    : "";

  const roster = useMemo(
    () =>
      buildReportRoster({
        classId,
        subjects,
        assignments,
        classTeachers,
        teachers,
        academicYearId: currentExam?.academic_year_id,
        subjectTeacherHistory,
        classTeacherHistory,
        headTeacherHistory,
      }),
    [classId, subjects, assignments, classTeachers, teachers, currentExam, subjectTeacherHistory, classTeacherHistory, headTeacherHistory]
  );

  const progressByLearner = useMemo(() => {
    const result: Record<string, { label: string; percentage: number }[]> = {};
    const classExamIds = new Set(examClasses.filter((x) => x.class_id === classId).map((x) => x.exam_id));
    const classExams = exams
      .filter((e) => classExamIds.has(e.id))
      .sort((a, b) => {
        const ay = years.find((y) => y.id === a.academic_year_id)?.year ?? 0;
        const by = years.find((y) => y.id === b.academic_year_id)?.year ?? 0;
        return ay - by || a.term - b.term || a.created_at.localeCompare(b.created_at);
      });

    learners.forEach((learner) => {
      result[learner.id] = classExams.map((exam) => {
        const examMarks = historyMarks.filter((m) => m.exam_id === exam.id && m.learner_id === learner.id);
        const examConfig = historyConfigs.filter((c) => c.exam_id === exam.id);
        const built = buildMarklist([learner], examMarks, subjects, examConfig).rows[0];
        const percentage = built?.grandMax ? Math.round((built.grandTotal / built.grandMax) * 1000) / 10 : null;
        const year = years.find((y) => y.id === exam.academic_year_id)?.year ?? "";
        return {
          label: `${exam.name} T${exam.term} ${year}`,
          percentage: percentage ?? 0,
        };
      }).filter((point) => point.percentage > 0);
    });
    return result;
  }, [classId, examClasses, exams, years, learners, historyMarks, historyConfigs, subjects]);

  function reportDataFor(row: MarklistRow, teacherComment: string): ReportFormData {
    return {
      schoolName: SCHOOL_NAME,
      examTitle,
      row: { ...row, className: currentClass?.name },
      classSize: marklist.rows.length,
      teacherComment,
      headTeacherComment: generateHeadTeacherComment(row, marklist.rows.length),
      classTeacherName: roster.classTeacherName,
      headTeacherName: roster.headTeacherName,
      subjectTeacherByGroupKey: roster.subjectTeacherByGroupKey,
      progress: progressByLearner[row.learner.id] ?? [],
      termEndsOn: currentTermDates ? formatDate(currentTermDates.term_ends_on) : "Not set",
      nextTermBeginsOn: currentTermDates ? formatDate(currentTermDates.next_term_begins_on) : "Not set",
    };
  }

  function openLearner(row: MarklistRow) {
    if (openLearnerId === row.learner.id) {
      setOpenLearnerId("");
      return;
    }
    setOpenLearnerId(row.learner.id);
    setEditedComment(generateTeacherComment(row, marklist.rows.length));
  }

  async function downloadOne(row: MarklistRow) {
    await exportReportFormDocx({
      ...reportDataFor(row, editedComment),
      filename: `${row.learner.name.replace(/\s+/g, "_")}_${examTitle.replace(/\s+/g, "_")}_REPORT`,
    });
  }

  async function downloadOnePdf(row: MarklistRow) {
    await exportReportFormPdf({
      ...reportDataFor(row, editedComment),
      filename: `${row.learner.name.replace(/\s+/g, "_")}_${examTitle.replace(/\s+/g, "_")}_REPORT`,
    });
  }

  async function downloadAll() {
    if (marklist.rows.length === 0) return;
    setBatchBusy(true);
    try {
      const reports = marklist.rows.map((row) => reportDataFor(row, generateTeacherComment(row, marklist.rows.length)));
      await exportReportFormsBatchDocx({
        reports,
        filename: `${examTitle.replace(/\s+/g, "_")}_ALL_REPORT_FORMS`,
      });
    } finally {
      setBatchBusy(false);
    }
  }

  async function downloadAllPdf() {
    if (marklist.rows.length === 0) return;
    setBatchPdfBusy(true);
    try {
      const reports = marklist.rows.map((row) => reportDataFor(row, generateTeacherComment(row, marklist.rows.length)));
      await exportReportFormsBatchPdf({
        reports,
        filename: `${examTitle.replace(/\s+/g, "_")}_ALL_REPORT_FORMS`,
      });
    } finally {
      setBatchPdfBusy(false);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Report Forms</h1>
        <p className="text-sm text-ink/60 mt-1">
          Generate CBC report forms with names, comments, and grading all filled in automatically. Download one
          learner at a time to review their comment first, or the whole class in one file to print.
        </p>
      </header>

      <div className="glass-card p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setExamId("");
            setOpenLearnerId("");
          }}
          className="glass-input"
        >
          <option value="">Select class</option>
          {visibleClasses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={examId}
          onChange={(e) => {
            setExamId(e.target.value);
            setOpenLearnerId("");
          }}
          disabled={!classId}
          className="glass-input disabled:opacity-50"
        >
          <option value="">Select exam</option>
          {examsForClass.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} (Term {e.term})
            </option>
          ))}
        </select>
      </div>

      {user?.role !== "admin" && visibleClasses.length === 0 && !loading && (
        <div className="text-sm text-ink/60 glass-card p-6 mb-5">
          Report forms are only generated by a class's own class teacher and admin. You're not set as the class
          teacher for any class yet — ask your admin if that's not right.
        </div>
      )}

      {classId && examId && !roster.headTeacherName && (
        <div className="text-sm text-ink/60 glass-card p-4 mb-5">
          No Head Teacher is set yet, so that name will print blank on these report forms. An admin can set one
          under Teachers.
        </div>
      )}

      {classId && examId && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-medium text-ink">
                {currentClass?.name} — {currentExam?.name} (Term {currentExam?.term}, {currentYear?.year})
              </h2>
              <p className="text-xs text-ink/50 mt-1">
                Term ends: {currentTermDates ? formatDate(currentTermDates.term_ends_on) : "Not set"} · Next term begins: {currentTermDates ? formatDate(currentTermDates.next_term_begins_on) : "Not set"}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={downloadAll} disabled={batchBusy || marklist.rows.length === 0} className="glass-btn-sm disabled:opacity-50">
                {batchBusy ? "Preparing…" : `Download all .docx (${marklist.rows.length})`}
              </button>
              <button onClick={downloadAllPdf} disabled={batchPdfBusy || marklist.rows.length === 0} className="glass-btn-sm disabled:opacity-50">
                {batchPdfBusy ? "Preparing…" : `Download all .pdf (${marklist.rows.length})`}
              </button>
            </div>
          </div>

          {marklist.rows.length === 0 ? (
            <div className="p-6 text-sm text-ink/50">No marks recorded yet for this exam.</div>
          ) : (
            <ul className="divide-y divide-line">
              {marklist.rows.map((row) => (
                <li key={row.learner.id}>
                  <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm text-ink font-medium">{row.learner.name}</div>
                      <div className="text-xs text-ink/50">
                        Position {row.rank} of {marklist.rows.length} · {row.grandTotal} / {row.grandMax}
                      </div>
                    </div>
                    <button onClick={() => openLearner(row)} className="text-xs text-maroon font-medium shrink-0">
                      {openLearnerId === row.learner.id ? "Close" : "Preview & download"}
                    </button>
                  </div>

                  {openLearnerId === row.learner.id && (
                    <div className="px-5 pb-5">
                      <div className="overflow-x-auto mb-4">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="text-left">
                            <th className="pb-2 font-medium text-ink/60">Learning Area</th>
                            <th className="pb-2 font-medium text-ink/60">Score</th>
                            <th className="pb-2 font-medium text-ink/60">Level</th>
                            <th className="pb-2 font-medium text-ink/60">Teacher</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.groups.map((g) => (
                            <tr key={g.key} className="border-t border-line">
                              <td className="py-2 text-ink whitespace-nowrap">{g.fullLabel}</td>
                              <td className="py-2 text-ink whitespace-nowrap">
                                {g.score ?? "—"}
                                {g.maxMarks ? <span className="text-ink/40"> / {g.maxMarks}</span> : null}
                              </td>
                              <td className="py-2">
                                {g.level && (
                                  <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: CBC_COLORS[g.level] }}>
                                    {g.level}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 text-ink/60">{roster.subjectTeacherByGroupKey[g.key] || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>

                      <div className="mt-2 text-xs text-ink/60">
                        <span className="font-medium">Grand Total:</span> {row.grandTotal} / {row.grandMax} · <span className="font-medium">Level:</span> {row.grandMax ? cbcLevel((row.grandTotal / row.grandMax) * 100) : "—"} · Position {row.rank} of {marklist.rows.length}
                      </div>

                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-ink/70">
                          Class teacher's comment — auto-filled from this term's grades, edit freely
                        </span>
                        <button
                          onClick={() => setEditedComment(generateTeacherComment(row, marklist.rows.length))}
                          className="text-xs text-maroon font-medium hover:opacity-70 shrink-0 ml-3"
                        >
                          ↻ Regenerate
                        </button>
                      </div>
                      <textarea
                        value={editedComment}
                        onChange={(e) => setEditedComment(e.target.value)}
                        rows={2}
                        className="w-full glass-input mb-2"
                      />
                      <div className="text-xs text-ink/50 mb-3">
                        Head teacher's comment (auto): {generateHeadTeacherComment(row, marklist.rows.length)}
                      </div>

                      <div className="flex gap-2">
                        <button onClick={() => downloadOne(row)} className="glass-btn-sm">
                          Download this report (.docx)
                        </button>
                        <button onClick={() => downloadOnePdf(row)} className="glass-btn-sm">
                          Download this report (.pdf)
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!classId && !loading && (user?.role === "admin" || visibleClasses.length > 0) && (
        <div className="text-sm text-ink/50">Select a class and assessment above to generate report forms.</div>
      )}
    </div>
  );
}
