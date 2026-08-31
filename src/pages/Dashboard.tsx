import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Exam, SchoolClass, Teacher, TeacherAssignment, Subject } from "../types";
import { ClassTeachersStatus } from "./teacher/MyClassLearners";
import { randomGreeting } from "../lib/greetings";

export default function Dashboard({ effectiveRole }: { effectiveRole?: "admin" | "teacher" } = {}) {
  const { user } = useAuth();
  // effectiveRole (passed down from App.tsx) lets an admin who chose
  // "Teacher Page" (see AdminRoleChoice.tsx) see their own teacher
  // dashboard instead of the admin one, even though user.role is still
  // "admin". Falls back to the real role if not provided.
  const role = effectiveRole ?? user?.role;
  if (role === "admin") return <AdminDashboard />;
  return <TeacherDashboard />;
}

// ============================================================
// ADMIN DASHBOARD
// One dominant panel -- "classes yet to submit" for the exam that
// matters right now -- with headcounts and assessment status
// demoted to a quiet secondary row underneath, rather than three
// equal-weight stat cards competing for attention.
// ============================================================
function AdminDashboard() {
  const { user } = useAuth();
  const [greeting] = useState(randomGreeting());
  const [teacherCount, setTeacherCount] = useState(0);
  const [learnerCount, setLearnerCount] = useState(0);
  const [exams, setExams] = useState<Exam[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const [t, l, e, c, ec] = await Promise.all([
      supabase.from("teachers").select("*"),
      // Current headcount should reflect currently-enrolled learners
      // only -- graduated/transferred/withdrawn learners are archived,
      // not deleted, so they'd otherwise inflate this count forever.
      supabase.from("learners").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("classes").select("*").order("name"),
      supabase.from("exam_classes").select("*"),
    ]);
    setTeacherCount(Array.isArray(t.data) ? t.data.length : 0);
    setLearnerCount(l.count || 0);
    const examList = e.data || [];
    setExams(examList);
    setClasses(c.data || []);
    setExamClasses(ec.data || []);
    if (!selectedExamId && examList.length) setSelectedExamId(examList.find((x) => !x.locked)?.id || examList[0].id);
    setLoading(false);
  }

  const openExam = exams.find((e) => !e.locked) ?? null;

  return (
    <div>
      <section className="mb-6 sm:mb-8">
        <p className="neu-eyebrow">{greeting}</p>
        <h1 className="font-display text-2xl sm:text-3xl text-maroon-ink mt-1">{user?.name}.</h1>
      </section>

      {/* Hero: the one thing an admin needs to check right now. */}
      <div className="hero-panel p-5 sm:p-6 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
          <h2 className="font-display text-lg text-ink">Classes yet to submit results</h2>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="glass-input w-full sm:w-64"
          >
            <option value="">Select exam</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <ClassSubmissionList examId={selectedExamId} classes={classes} examClasses={examClasses} />
      </div>

      {/* Quiet secondary row -- headcounts and overall assessment state. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="stat-quiet p-4 flex items-center justify-between">
          <span className="text-xs text-ink/50">Teachers</span>
          <span className="font-display text-lg text-ink/70">{loading ? "—" : teacherCount}</span>
        </div>
        <div className="stat-quiet p-4 flex items-center justify-between">
          <span className="text-xs text-ink/50">Learners</span>
          <span className="font-display text-lg text-ink/70">{loading ? "—" : learnerCount}</span>
        </div>
        {/* Only one exam can ever be open at a time (see Exams.tsx and the
            exams_single_open DB trigger), so this never needs to be a count
            -- just which one, in green, or that none is when there isn't
            one. That's the whole status an admin needs at a glance. */}
        <div className="stat-quiet p-4 flex items-center justify-between gap-3">
          <span className="text-xs text-ink/50 shrink-0">Assessment</span>
          {loading ? (
            <span className="font-display text-lg text-ink/70">—</span>
          ) : openExam ? (
            <span className="text-sm font-medium text-emerald-700 flex items-center gap-1.5 truncate">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              {openExam.name} — Open
            </span>
          ) : (
            <span className="text-sm font-medium text-red-600">No exam open</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ClassSubmissionList({
  examId,
  classes,
  examClasses,
}: {
  examId: string;
  classes: SchoolClass[];
  examClasses: { exam_id: string; class_id: string }[];
}) {
  const [pending, setPending] = useState<SchoolClass[]>([]);
  const [submitted, setSubmitted] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (examId) check();
    else {
      setPending([]);
      setSubmitted([]);
    }
  }, [examId]);

  async function check() {
    if (!supabase) return;
    setLoading(true);
    const classIds = examClasses.filter((x) => x.exam_id === examId).map((x) => x.class_id);
    const sittingClasses = classIds.map((id) => classes.find((c) => c.id === id)).filter((c): c is SchoolClass => !!c);

    const [learnersQ, marksQ] = await Promise.all([
      supabase
        .from("learners")
        .select("id, class_id")
        .in("class_id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("status", "active"),
      supabase.from("marks").select("learner_id").eq("exam_id", examId),
    ]);
    const learnerClassMap = new Map((learnersQ.data || []).map((l: any) => [l.id, l.class_id]));
    const classesWithMarks = new Set((marksQ.data || []).map((m: any) => learnerClassMap.get(m.learner_id)).filter(Boolean));

    setPending(sittingClasses.filter((c) => !classesWithMarks.has(c.id)));
    setSubmitted(sittingClasses.filter((c) => classesWithMarks.has(c.id)));
    setLoading(false);
  }

  if (!examId) return <p className="text-sm text-ink/50 mt-3">Select an exam above to see submission progress.</p>;
  if (loading) return <p className="text-sm text-ink/50 mt-3">Checking…</p>;
  const total = pending.length + submitted.length;
  if (total === 0) return <p className="text-sm text-ink/50 mt-3">No classes assigned to this exam yet.</p>;

  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-display text-2xl text-maroon-ink">{submitted.length}/{total}</span>
        <span className="text-sm text-ink/60">classes submitted</span>
        {pending.length === 0 && <span className="neu-badge neu-badge-open ml-2">All submitted</span>}
      </div>
      <div className="progress-track mb-4">
        <div
          className={`progress-fill ${pending.length === 0 ? "progress-fill-done" : ""}`}
          style={{ width: `${total ? (submitted.length / total) * 100 : 0}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {pending.map((c) => (
          <span key={c.id} className="neu-badge neu-badge-closed">
            {c.name} — pending
          </span>
        ))}
        {submitted.map((c) => (
          <span key={c.id} className="neu-badge neu-badge-open">
            {c.name} — submitted
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TEACHER DASHBOARD
// One dominant panel -- the assignment furthest from done, with a
// progress bar and a plain-language remaining count -- instead of
// three equal-weight stat cards. Everything else is quieter.
// ============================================================
type AssignmentProgress = {
  key: string;
  className: string;
  subjectName: string;
  entered: number;
  expected: number;
};

function TeacherDashboard() {
  const { user } = useAuth();
  const [greeting] = useState(randomGreeting());
  const [exams, setExams] = useState<Exam[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [progress, setProgress] = useState<AssignmentProgress[]>([]);
  const [myClasses, setMyClasses] = useState<SchoolClass[]>([]);
  const [myClassId, setMyClassId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    if (!supabase || !user) return;
    setLoading(true);
    const [ex, as, cl, su, ct] = await Promise.all([
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("teacher_assignments").select("*").eq("teacher_id", user.id),
      supabase.from("classes").select("*"),
      supabase.from("subjects").select("*"),
      supabase.from("class_teachers").select("class_id").eq("teacher_id", user.id),
    ]);
    const examList = ex.data || [];
    const assignmentList = as.data || [];
    const classList = cl.data || [];
    const subjectList = su.data || [];
    setExams(examList);
    setAssignments(assignmentList);
    setClasses(classList);
    setSubjects(subjectList);

    // Classes this teacher is the class teacher for -- surfaced right
    // here on the dashboard (previously only reachable via My Class).
    const myClassIds = new Set((ct.data || []).map((r: any) => r.class_id));
    const myClassList = classList.filter((c) => myClassIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
    setMyClasses(myClassList);
    setMyClassId((prev) => (prev && myClassList.some((c) => c.id === prev) ? prev : myClassList[0]?.id || ""));

    // Per-assignment marks entered vs expected for open exams -- this
    // is what lets the hero panel point at the *specific* class and
    // learning area needing attention, not just an aggregate count.
    const openExamIds = examList.filter((e) => !e.locked).map((e) => e.id);
    if (openExamIds.length && assignmentList.length) {
      const classIds = assignmentList.map((a) => a.class_id);
      const [learnersQ, marksQ] = await Promise.all([
        supabase.from("learners").select("id, class_id").in("class_id", classIds).eq("status", "active"),
        supabase.from("marks").select("learner_id, exam_id, subject_id").in("exam_id", openExamIds),
      ]);
      const learners = learnersQ.data || [];
      const marks = marksQ.data || [];

      const rows: AssignmentProgress[] = assignmentList.map((a) => {
        const classLearners = learners.filter((l) => l.class_id === a.class_id);
        const expected = classLearners.length * openExamIds.length;
        const learnerIds = new Set(classLearners.map((l) => l.id));
        const entered = marks.filter(
          (m) => openExamIds.includes(m.exam_id) && m.subject_id === a.subject_id && learnerIds.has(m.learner_id)
        ).length;
        return {
          key: a.id,
          className: classList.find((c) => c.id === a.class_id)?.name || "Unknown class",
          subjectName: subjectList.find((s) => s.id === a.subject_id)?.name || "Unknown subject",
          entered,
          expected,
        };
      });
      setProgress(rows);
    } else {
      setProgress([]);
    }
    setLoading(false);
  }

  const openExams = exams.filter((e) => !e.locked);
  const incomplete = progress
    .filter((p) => p.expected > 0 && p.entered < p.expected)
    .sort((a, b) => a.entered / a.expected - b.entered / b.expected);
  const focus = incomplete[0];
  const restIncomplete = incomplete.slice(1);

  return (
    <div>
      <section className="mb-6 sm:mb-8">
        <p className="neu-eyebrow">{greeting}</p>
        <h1 className="font-display text-2xl sm:text-3xl text-maroon-ink mt-1">{user?.name}.</h1>
      </section>

      {/* Hero: the single assignment needing attention, made visually
          dominant -- everything else is quieter by comparison. */}
      <div className="hero-panel p-5 sm:p-6 mb-5">
        {loading ? (
          <p className="text-sm text-ink/50">Checking your assignments…</p>
        ) : openExams.length === 0 ? (
          <>
            <p className="neu-eyebrow mb-1">Assessment status</p>
            <p className="text-sm text-ink/60">No assessment currently open. Nothing needs marks right now.</p>
          </>
        ) : focus ? (
          <>
            <p className="neu-eyebrow mb-1">Marks need attention</p>
            <h2 className="font-display text-xl text-ink mb-3">
              {focus.className} · {focus.subjectName}
            </h2>
            <div className="progress-track mb-2">
              <div className="progress-fill" style={{ width: `${(focus.entered / focus.expected) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink/60">
                {focus.entered}/{focus.expected} learners entered · {Math.round((focus.entered / focus.expected) * 100)}%
              </span>
              <span className="font-medium text-maroon-ink">{focus.expected - focus.entered} remaining</span>
            </div>
            {restIncomplete.length > 0 && (
              <div className="mt-4 pt-4 border-t border-line space-y-2">
                {restIncomplete.map((p) => (
                  <div key={p.key} className="flex items-center justify-between text-xs text-ink/50">
                    <span>
                      {p.className} · {p.subjectName}
                    </span>
                    <span>{p.expected - p.entered} remaining</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="neu-eyebrow mb-1">Marks</p>
            <div className="flex items-center gap-2">
              <span className="neu-badge neu-badge-open">All caught up</span>
              <span className="text-sm text-ink/60">Every open assessment has marks entered for your classes.</span>
            </div>
          </>
        )}
      </div>

      {/* Quiet secondary row. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="stat-quiet p-4 flex items-center justify-between">
          <span className="text-xs text-ink/50">Your assignments</span>
          <span className="font-display text-lg text-ink/70">{loading ? "—" : assignments.length}</span>
        </div>
        <div className="stat-quiet p-4 flex items-center justify-between gap-3">
          <span className="text-xs text-ink/50 shrink-0">Open assessments</span>
          {/* Mirrors the admin dashboard's Assessment stat: green when
              something's open, red when nothing is -- previously this
              was plain grey either way. */}
          {loading ? (
            <span className="text-sm text-ink/70 text-right">—</span>
          ) : openExams.length > 0 ? (
            <span className="text-sm font-medium text-emerald-700 flex items-center gap-1.5 truncate text-right">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              {openExams.map((e) => e.name).join(", ")}
            </span>
          ) : (
            <span className="text-sm font-medium text-red-600">None</span>
          )}
        </div>
      </div>

      <div className="glass-card p-4 sm:p-5 mb-6">
        <h2 className="text-sm font-medium neu-panel-title mb-3">Your assignments</h2>
        {loading ? (
          <div className="text-sm text-ink/50">Loading…</div>
        ) : assignments.length === 0 ? (
          <div className="text-sm text-ink/50">No assignments yet. Contact your admin.</div>
        ) : (
          <ul className="divide-y divide-navy/10">
            {assignments.map((a) => {
              const cls = classes.find((c) => c.id === a.class_id);
              const subj = subjects.find((s) => s.id === a.subject_id);
              return (
                <li key={a.id} className="py-2 flex items-center justify-between">
                  <div className="text-sm text-ink">
                    {cls?.name || "Unknown class"} — <span className="text-ink/60">{subj?.name || "Unknown subject"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!loading && myClasses.length > 0 && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-sm font-medium neu-panel-title">Teachers &amp; submissions for your class</h2>
            {myClasses.length > 1 && (
              <select value={myClassId} onChange={(e) => setMyClassId(e.target.value)} className="neu-input w-full sm:w-56">
                {myClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {(() => {
            const cls = myClasses.find((c) => c.id === myClassId);
            return cls ? <ClassTeachersStatus classObj={cls} /> : null;
          })()}
        </div>
      )}
    </div>
  );
}
