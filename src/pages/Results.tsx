import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Exam, Learner, SchoolClass, Subject, Mark, ExamSubjectConfig, AcademicYear, ClassTeacher, CBC_COLORS, CBC_LABELS, SUBJECT_GROUPS } from "../types";
import { buildMarklist, buildAnalysis } from "../lib/marklist";
import { fetchHistoricalLearners } from "../lib/enrollment";
import { exportMarklistXlsx, exportAnalysisXlsx } from "../lib/exportXlsx";
import { exportAnalysisPdf } from "../lib/exportAnalysisPdf";

const SCHOOL_NAME = "KARIOBANGI SOUTH PRIMARY AND JUNIOR SCHOOL";

export default function Results() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [classTeachers, setClassTeachers] = useState<ClassTeacher[]>([]);
  const [classId, setClassId] = useState("");
  const [examId, setExamId] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [examSubjectConfig, setExamSubjectConfig] = useState<ExamSubjectConfig[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState("");
  const [tab, setTab] = useState<"marklist" | "analysis">("marklist");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContext();
  }, []);

  async function loadContext() {
    if (!supabase) return;
    setLoading(true);
    const [c, s, e, y, ec, ct] = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*").order("name"),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("academic_years").select("*").order("year", { ascending: false }),
      supabase.from("exam_classes").select("*"),
      supabase.from("class_teachers").select("*"),
    ]);
    setClasses(c.data || []);
    setSubjects(s.data || []);
    setExams(e.data || []);
    setYears(y.data || []);
    setExamClasses(ec.data || []);
    setClassTeachers(ct.data || []);
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
    const exam = exams.find((e) => e.id === examId);
    // Use who was actually enrolled in this class for this exam's
    // academic year, not who currently is -- otherwise a learner who
    // has since been promoted or graduated disappears from a past
    // exam's marklist even though their results are still real. See
    // src/lib/enrollment.ts.
    const [l, m, cfg] = await Promise.all([
      fetchHistoricalLearners(supabase, [classId], exam?.academic_year_id),
      supabase.from("marks").select("*").eq("exam_id", examId),
      supabase.from("exam_subject_config").select("*").eq("exam_id", examId),
    ]);
    setLearners(l);
    setMarks(m.data || []);
    setExamSubjectConfig(cfg.data || []);
  }

  const marklist = useMemo(
    () => buildMarklist(learners, marks, subjects, examSubjectConfig),
    [learners, marks, subjects, examSubjectConfig]
  );
  const analysis = useMemo(() => buildAnalysis(marklist.rows), [marklist.rows]);

  const currentClass = classes.find((c) => c.id === classId);
  const currentExam = exams.find((e) => e.id === examId);
  const currentYear = currentExam ? years.find((y) => y.id === currentExam.academic_year_id) : null;
  const titleBase = currentClass && currentExam ? `${currentClass.name.toUpperCase()} ${currentExam.name.toUpperCase()} ${currentYear?.year ?? ""}`.trim() : "";
  const marklistTitle = `${titleBase} MARKLIST`;
  const analysisTitle = `${titleBase} ANALYSIS`;

  const groupBreakdown = useMemo(() => {
    return SUBJECT_GROUPS.map((g) => {
      const scores = marklist.rows
        .map((r) => r.groups.find((x) => x.key === g.key))
        .filter((x): x is NonNullable<typeof x> => !!x && x.score !== null && x.maxMarks !== null);
      if (scores.length === 0) return null;
      const avgPct = scores.reduce((sum, s) => sum + ((s.score as number) / (s.maxMarks as number)) * 100, 0) / scores.length;
      const dist: Record<string, number> = { EE: 0, ME: 0, AE: 0, BE: 0 };
      scores.forEach((s) => {
        if (s.level) dist[s.level]++;
      });
      return { subject: g.label, average: Math.round(avgPct * 10) / 10, ...dist };
    }).filter(Boolean) as any[];
  }, [marklist]);

  const learnerDetail = useMemo(() => {
    if (!selectedLearnerId) return null;
    return marklist.rows.find((r) => r.learner.id === selectedLearnerId) || null;
  }, [selectedLearnerId, marklist]);

  const [trend, setTrend] = useState<{ label: string; average: number }[]>([]);
  useEffect(() => {
    if (selectedLearnerId) loadTrend(selectedLearnerId);
    else setTrend([]);
  }, [selectedLearnerId]);

  async function loadTrend(learnerId: string) {
    if (!supabase) return;
    const { data } = await supabase.from("marks").select("*, exam:exams(id,name,term,academic_year_id)").eq("learner_id", learnerId);
    if (!data) return;
    const byExam: Record<string, number[]> = {};
    const examMeta: Record<string, any> = {};
    (data as any[]).forEach((m) => {
      byExam[m.exam_id] = byExam[m.exam_id] || [];
      byExam[m.exam_id].push(Number(m.score));
      examMeta[m.exam_id] = m.exam;
    });
    const rows = Object.entries(byExam).map(([examId, scores]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const meta = examMeta[examId];
      const year = years.find((y) => y.id === meta?.academic_year_id)?.year ?? "";
      return { label: `${meta?.name ?? ""} T${meta?.term ?? ""} '${String(year).slice(-2)}`, average: Math.round(avg * 10) / 10 };
    });
    setTrend(rows);
  }

  function downloadMarklistXlsx() {
    exportMarklistXlsx({
      title: marklistTitle,
      schoolName: SCHOOL_NAME,
      rows: marklist.rows,
      totals: marklist.totals,
      filename: marklistTitle.replace(/\s+/g, "_"),
    });
  }

  function downloadAnalysisXlsx() {
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
        <h1 className="font-display text-2xl text-ink">Marklist</h1>
        <p className="text-sm text-ink/60 mt-1">
          {user?.role === "admin" ? "View the marklist and analysis for any class and assessment." : "View the marklist and analysis for your class."}
        </p>
      </header>

      <div className="glass-card p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setExamId("");
            setSelectedLearnerId("");
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
            setSelectedLearnerId("");
          }}
          disabled={!classId}
          className="glass-input disabled:opacity-50"
        >
          <option value="">Select assessment</option>
          {examsForClass.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} (Term {e.term}){!e.locked ? " — Open" : ""}
            </option>
          ))}
        </select>
      </div>

      {user?.role !== "admin" && visibleClasses.length === 0 && !loading && (
        <div className="text-sm text-ink/60 glass-card p-6 mb-5">
          The marklist is only visible to a class's own class teacher and admin. You're not set as the class
          teacher for any class yet — ask your admin if that's not right.
        </div>
      )}

      {classId && examId && (
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
            <div className="glass-card overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-medium text-ink">
                  {currentClass?.name} — {currentExam?.name} (Term {currentExam?.term}, {currentYear?.year})
                </h2>
                <div className="flex gap-2">
                  <button onClick={downloadMarklistXlsx} className="glass-btn-sm">
                    Download .xlsx
                  </button>
                </div>
              </div>
              {marklist.rows.length === 0 ? (
                <div className="p-6 text-sm text-ink/50">No marks recorded yet for this exam.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-paper text-left">
                        <th className="px-3 py-2 font-medium text-ink/60">#</th>
                        <th className="px-3 py-2 font-medium text-ink/60">Name</th>
                        {SUBJECT_GROUPS.map((g) => (
                          <th key={g.key} colSpan={2} className="px-2 py-2 font-medium text-ink/60 text-center whitespace-nowrap">
                            {g.label}
                          </th>
                        ))}
                        <th className="px-3 py-2 font-medium text-ink/60">G.Tot</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {marklist.rows.map((r) => (
                        <tr key={r.learner.id} className="border-t border-line">
                          <td className="px-3 py-1.5 text-ink/70">{r.rank}</td>
                          <td className="px-3 py-1.5 text-ink whitespace-nowrap">{r.learner.name}</td>
                          {r.groups.map((g) => (
                            <td key={g.key + "s"} className="px-1.5 py-1.5 text-center text-ink">
                              {g.score ?? "—"}
                              <span className="text-ink/40 ml-1">{g.level ?? ""}</span>
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-ink font-medium">{r.grandTotal}</td>
                          <td className="px-3 py-1.5">
                            <button onClick={() => setSelectedLearnerId(r.learner.id)} className="text-[10px] text-maroon font-medium whitespace-nowrap">
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-line font-medium">
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5 text-ink">TOTAL</td>
                        {SUBJECT_GROUPS.map((g) => (
                          <td key={g.key} className="px-1.5 py-1.5 text-center text-ink">
                            {marklist.totals.groupTotals[g.key]}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-ink">{marklist.totals.grandTotal}</td>
                        <td></td>
                      </tr>
                      <tr className="text-ink/60">
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5">AVERAGE</td>
                        {SUBJECT_GROUPS.map((g) => (
                          <td key={g.key} className="px-1.5 py-1.5 text-center">
                            {marklist.totals.groupAverages[g.key]}
                          </td>
                        ))}
                        <td className="px-3 py-1.5">{marklist.totals.grandAverage}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "analysis" && (
            <div className="glass-card overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-medium text-ink">
                  {currentClass?.name} — {currentExam?.name} grade distribution
                </h2>
                <div className="flex gap-2">
                  <button onClick={downloadAnalysisXlsx} className="glass-btn-sm">
                    Download .xlsx
                  </button>
                  <button onClick={downloadAnalysisPdf} className="glass-btn-sm">
                    Download .pdf
                  </button>
                </div>
              </div>
              {marklist.rows.length === 0 ? (
                <div className="p-6 text-sm text-ink/50">No marks recorded yet for this exam.</div>
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
                        <td className="px-4 py-2 text-ink font-bold">{row.fullLabel}</td>
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

          {tab === "marklist" && groupBreakdown.length > 0 && (
            <div className="glass-card p-5 mb-6">
              <h2 className="text-sm font-medium text-ink mb-4">Average score by subject</h2>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={groupBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5dcd7" />
                    <XAxis dataKey="subject" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="average" fill="#7a1f2b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <h3 className="text-sm font-medium text-ink mt-8 mb-4">CBC level distribution by subject</h3>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={groupBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5dcd7" />
                    <XAxis dataKey="subject" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    {(["EE", "ME", "AE", "BE"] as const).map((lvl) => (
                      <Bar key={lvl} dataKey={lvl} stackId="cbc" fill={CBC_COLORS[lvl]} name={`${lvl} · ${CBC_LABELS[lvl]}`} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {tab === "marklist" && selectedLearnerId && learnerDetail && (
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-ink">{learnerDetail.learner.name} — exam breakdown</h2>
                <button onClick={() => setSelectedLearnerId("")} className="text-xs text-ink/40">
                  Close
                </button>
              </div>
              <table className="w-full text-sm mb-6">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 font-medium text-ink/60">Subject</th>
                    <th className="pb-2 font-medium text-ink/60">Score</th>
                    <th className="pb-2 font-medium text-ink/60">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {learnerDetail.groups.map((g) => (
                    <tr key={g.key} className="border-t border-line">
                      <td className="py-2 text-ink">{g.label}</td>
                      <td className="py-2 text-ink">
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
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line font-medium">
                    <td className="py-2 text-ink">Grand Total</td>
                    <td className="py-2 text-ink">{learnerDetail.grandTotal}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>

              <div className="mb-6 text-xs text-ink/50">
                Need this learner's report form? Open <span className="text-maroon font-medium">Report Forms</span> from the
                menu — it's generated there with the class/head teacher's names and comments filled in automatically.
              </div>

              {trend.length > 1 && (
                <>
                  <h3 className="text-sm font-medium text-ink mb-4">Performance trend across terms/years</h3>
                  <div style={{ width: "100%", height: 220 }}>
                    <ResponsiveContainer>
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5dcd7" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="average" stroke="#7a1f2b" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {!classId && !loading && (user?.role === "admin" || visibleClasses.length > 0) && (
        <div className="text-sm text-ink/50">Select a class and assessment above to view the marklist.</div>
      )}
    </div>
  );
}
