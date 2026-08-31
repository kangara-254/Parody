import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Exam, Learner, SchoolClass, Subject, Mark, ExamSubjectConfig, AcademicYear, CBC_COLORS } from "../../types";
import { buildMarklist, buildAnalysis } from "../../lib/marklist";
import { fetchHistoricalLearners } from "../../lib/enrollment";
import { exportMarklistXlsx, exportAnalysisXlsx } from "../../lib/exportXlsx";
import { exportAnalysisPdf } from "../../lib/exportAnalysisPdf";
import { SUBJECT_GROUPS } from "../../types";

const SCHOOL_NAME = "KARIOBANGI SOUTH PRIMARY AND JUNIOR SCHOOL";
const GRADES = ["7", "8", "9"];

export default function OverallMarklist() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [grade, setGrade] = useState("8");
  const [examId, setExamId] = useState("");
  const [learners, setLearners] = useState<(Learner & { className?: string })[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [examSubjectConfig, setExamSubjectConfig] = useState<ExamSubjectConfig[]>([]);
  const [tab, setTab] = useState<"marklist" | "analysis">("marklist");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContext();
  }, []);

  async function loadContext() {
    if (!supabase) return;
    setLoading(true);
    const [c, s, e, y, ec] = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*").order("name"),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("academic_years").select("*").order("year", { ascending: false }),
      supabase.from("exam_classes").select("*"),
    ]);
    setClasses(c.data || []);
    setSubjects(s.data || []);
    setExams(e.data || []);
    setYears(y.data || []);
    setExamClasses(ec.data || []);
    setLoading(false);
  }

  const gradeClasses = useMemo(() => classes.filter((c) => c.name.startsWith(grade)), [classes, grade]);

  const examsForGrade = useMemo(() => {
    const gradeClassIds = new Set(gradeClasses.map((c) => c.id));
    const examIdsSitting = new Set(
      examClasses.filter((x) => gradeClassIds.has(x.class_id)).map((x) => x.exam_id)
    );
    return exams.filter((e) => examIdsSitting.has(e.id));
  }, [exams, examClasses, gradeClasses]);

  useEffect(() => {
    setExamId("");
  }, [grade]);

  useEffect(() => {
    if (examId) load();
  }, [examId, gradeClasses.map((c) => c.id).join(",")]);

  async function load() {
    if (!supabase || gradeClasses.length === 0) return;
    const classIds = gradeClasses.map((c) => c.id);
    const exam = exams.find((e) => e.id === examId);
    // Historical membership, not current -- see src/lib/enrollment.ts.
    const [l, m, cfg] = await Promise.all([
      fetchHistoricalLearners(supabase, classIds, exam?.academic_year_id),
      supabase.from("marks").select("*").eq("exam_id", examId),
      supabase.from("exam_subject_config").select("*").eq("exam_id", examId),
    ]);
    const classNameById = new Map(gradeClasses.map((c) => [c.id, c.name]));
    const withClassName = l.map((ln) => ({ ...ln, className: classNameById.get(ln.class_id) }));
    setLearners(withClassName);
    setMarks(m.data || []);
    setExamSubjectConfig(cfg.data || []);
  }

  const marklist = useMemo(
    () => buildMarklist(learners, marks, subjects, examSubjectConfig),
    [learners, marks, subjects, examSubjectConfig]
  );
  const analysis = useMemo(() => buildAnalysis(marklist.rows), [marklist.rows]);
  const currentExam = exams.find((e) => e.id === examId);
  const currentYear = currentExam ? years.find((y) => y.id === currentExam.academic_year_id) : null;
  const titleBase = currentExam ? `GRADE ${grade} ${currentExam.name.toUpperCase()} ${currentYear?.year ?? ""}`.trim() : "";
  const marklistTitle = `${titleBase} OVERALL MARKLIST`;
  const analysisTitle = `${titleBase} OVERALL ANALYSIS`;

  function downloadMarklist() {
    exportMarklistXlsx({
      title: marklistTitle,
      schoolName: SCHOOL_NAME,
      rows: marklist.rows,
      totals: marklist.totals,
      includeClassColumn: true,
      filename: marklistTitle.replace(/\s+/g, "_"),
    });
  }

  function downloadAnalysis() {
    exportAnalysisXlsx({
      title: analysisTitle,
      schoolName: SCHOOL_NAME,
      rows: analysis,
      filename: analysisTitle.replace(/\s+/g, "_"),
    });
  }

  function downloadAnalysisPdf() {
    exportAnalysisPdf({
      title: analysisTitle,
      schoolName: SCHOOL_NAME,
      rows: analysis,
      filename: analysisTitle.replace(/\s+/g, "_"),
    });
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Overall Marklist</h1>
        <p className="text-sm text-ink/60 mt-1">Every class in a grade, ranked together — e.g. all streams in Grade 8 as one list.</p>
      </header>

      <div className="glass-card p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className="glass-input">
          {GRADES.map((g) => (
            <option key={g} value={g}>
              Grade {g} — all streams ({classes.filter((c) => c.name.startsWith(g)).length} classes)
            </option>
          ))}
        </select>
        <select value={examId} onChange={(e) => setExamId(e.target.value)} className="glass-input">
          <option value="">Select assessment</option>
          {examsForGrade.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} (Term {e.term})
            </option>
          ))}
        </select>
      </div>

      {examId && (
        <>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setTab("marklist")} className={tab === "marklist" ? "tab-btn tab-btn-active" : "tab-btn"}>
              Marklist
            </button>
            <button onClick={() => setTab("analysis")} className={tab === "analysis" ? "tab-btn tab-btn-active" : "tab-btn"}>
              Analysis
            </button>
          </div>

          {tab === "marklist" && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-medium text-ink">
                  Grade {grade} — {currentExam?.name} (Term {currentExam?.term}, {currentYear?.year}) · {marklist.rows.length} learners
                </h2>
                <button onClick={downloadMarklist} className="glass-btn-sm">
                  Download .xlsx
                </button>
              </div>
              {marklist.rows.length === 0 ? (
                <div className="p-6 text-sm text-ink/50">No marks recorded yet across this grade for this exam.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-paper text-left">
                        <th className="px-3 py-2 font-medium text-ink/60">#</th>
                        <th className="px-3 py-2 font-medium text-ink/60">Name</th>
                        <th className="px-3 py-2 font-medium text-ink/60">Class</th>
                        {SUBJECT_GROUPS.map((g) => (
                          <th key={g.key} className="px-2 py-2 font-medium text-ink/60 text-center whitespace-nowrap">
                            {g.label}
                          </th>
                        ))}
                        <th className="px-3 py-2 font-medium text-ink/60">G.Tot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marklist.rows.map((r) => (
                        <tr key={r.learner.id} className="border-t border-line">
                          <td className="px-3 py-1.5 text-ink/70">{r.rank}</td>
                          <td className="px-3 py-1.5 text-ink whitespace-nowrap">{r.learner.name}</td>
                          <td className="px-3 py-1.5 text-ink/60">{r.className}</td>
                          {r.groups.map((g) => (
                            <td key={g.key} className="px-1.5 py-1.5 text-center text-ink">
                              {g.score ?? "—"} <span className="text-ink/40">{g.level ?? ""}</span>
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-ink font-medium">{r.grandTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "analysis" && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-medium text-ink">
                  Grade {grade} — {currentExam?.name} grade distribution (all streams combined)
                </h2>
                <div className="flex gap-2">
                  <button onClick={downloadAnalysis} className="glass-btn-sm">
                    Download .xlsx
                  </button>
                  <button onClick={downloadAnalysisPdf} className="glass-btn-sm">
                    Download .pdf
                  </button>
                </div>
              </div>
              {marklist.rows.length === 0 ? (
                <div className="p-6 text-sm text-ink/50">No marks recorded yet across this grade for this exam.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-paper text-left">
                      <th className="px-4 py-2 font-medium text-ink/60">Learning Area</th>
                      <th className="px-4 py-2 font-medium text-center" style={{ color: CBC_COLORS.EE }}>E.E</th>
                      <th className="px-4 py-2 font-medium text-center" style={{ color: CBC_COLORS.ME }}>M.E</th>
                      <th className="px-4 py-2 font-medium text-center" style={{ color: CBC_COLORS.AE }}>A.E</th>
                      <th className="px-4 py-2 font-medium text-center" style={{ color: CBC_COLORS.BE }}>B.E</th>
                      <th className="px-4 py-2 font-medium text-ink/60 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.map((row) => (
                      <tr key={row.key} className="border-t border-line">
                        <td className="px-4 py-2 text-ink">{row.label}</td>
                        <td className="px-4 py-2 text-center" style={{ background: `${CBC_COLORS.EE}22` }}>{row.ee}</td>
                        <td className="px-4 py-2 text-center" style={{ background: `${CBC_COLORS.ME}22` }}>{row.me}</td>
                        <td className="px-4 py-2 text-center" style={{ background: `${CBC_COLORS.AE}22` }}>{row.ae}</td>
                        <td className="px-4 py-2 text-center" style={{ background: `${CBC_COLORS.BE}22` }}>{row.be}</td>
                        <td className="px-4 py-2 text-center text-ink font-medium">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
