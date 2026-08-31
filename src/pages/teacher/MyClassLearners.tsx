import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { SchoolClass, Exam, Teacher, Subject, TeacherAssignment } from "../../types";
import LearnersPage from "../admin/Learners";

export default function MyClassLearners() {
  const { user } = useAuth();
  const [myClasses, setMyClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState("");
  const [tab, setTab] = useState<"learners" | "teachers">("learners");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    if (!supabase || !user) return;
    setLoading(true);
    const { data: ct } = await supabase.from("class_teachers").select("class_id").eq("teacher_id", user.id);
    const classIds = (ct || []).map((r: any) => r.class_id);
    if (classIds.length === 0) {
      setMyClasses([]);
      setLoading(false);
      return;
    }
    const { data: classes } = await supabase.from("classes").select("*").in("id", classIds).order("name");
    const list = classes || [];
    setMyClasses(list);
    setClassId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || ""));
    setLoading(false);
  }

  if (loading) return <div className="text-sm text-ink/50">Loading…</div>;

  if (myClasses.length === 0) {
    return (
      <div className="neu-card p-6 text-sm text-ink/50">
        You're not assigned as a class teacher for any class yet. Ask your admin to assign you one from the
        Classes page.
      </div>
    );
  }

  const currentClass = myClasses.find((c) => c.id === classId);

  return (
    <div>
      {myClasses.length > 1 && (
        <div className="mb-4">
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="neu-input w-full sm:w-64">
            {myClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("learners")} className={tab === "learners" ? "tab-btn tab-btn-active" : "tab-btn"}>
          Learners
        </button>
        <button onClick={() => setTab("teachers")} className={tab === "teachers" ? "tab-btn tab-btn-active" : "tab-btn"}>
          Teachers &amp; submissions
        </button>
      </div>

      {tab === "learners" && currentClass && <LearnersPage restrictToClassId={currentClass.id} />}
      {tab === "teachers" && currentClass && <ClassTeachersStatus classObj={currentClass} />}
    </div>
  );
}

// ============================================================
// "Teachers & submissions" tab -- every teacher who teaches a subject
// in this class teacher's class, with a neu-badge showing whether
// they've submitted marks yet for the selected exam. Composition and
// Insha are deliberately excluded from this list (see README §4 --
// they're auto-paired with English/Kiswahili and never assigned or
// entered separately, so listing them would double-count the same
// teacher).
// ============================================================
export function ClassTeachersStatus({ classObj }: { classObj: SchoolClass }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [examId, setExamId] = useState("");
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [submittedSubjectIds, setSubmittedSubjectIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContext();
  }, [classObj.id]);

  async function loadContext() {
    if (!supabase) return;
    setLoading(true);
    const [e, ec, a, t, s] = await Promise.all([
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("exam_classes").select("*").eq("class_id", classObj.id),
      supabase.from("teacher_assignments").select("*").eq("class_id", classObj.id),
      supabase.from("teachers").select("*"),
      supabase.from("subjects").select("*"),
    ]);
    const examIds = new Set((ec.data || []).map((x: any) => x.exam_id));
    const examList = (e.data || []).filter((x: any) => examIds.has(x.id));
    setExams(examList);
    setExamClasses(ec.data || []);
    setAssignments(a.data || []);
    setTeachers(t.data || []);
    setSubjects(s.data || []);
    if (!examId && examList.length) setExamId(examList.find((x: any) => !x.locked)?.id || examList[0].id);
    setLoading(false);
  }

  useEffect(() => {
    if (examId) loadSubmissions();
    else setSubmittedSubjectIds(new Set());
  }, [examId, assignments]);

  async function loadSubmissions() {
    if (!supabase) return;
    const { data } = await supabase
      .from("marks")
      .select("subject_id, learner_id, learners!inner(class_id)")
      .eq("exam_id", examId)
      .eq("learners.class_id", classObj.id);
    setSubmittedSubjectIds(new Set((data || []).map((m: any) => m.subject_id)));
  }

  // One row per (teacher, subject) assignment, excluding the silent
  // auto-paired Composition/Insha rows so each teacher's real subject
  // shows once (see comment above).
  const rows = useMemo(() => {
    const hidden = new Set(["Composition", "Insha"]);
    return assignments
      .map((a) => {
        const teacher = teachers.find((t) => t.id === a.teacher_id);
        const subject = subjects.find((s) => s.id === a.subject_id);
        if (!teacher || !subject || hidden.has(subject.name)) return null;
        return { key: a.id, teacher, subject };
      })
      .filter((r): r is { key: string; teacher: Teacher; subject: Subject } => !!r)
      .sort((a, b) => a.teacher.name.localeCompare(b.teacher.name));
  }, [assignments, teachers, subjects]);

  if (loading) return <div className="text-sm text-ink/50 py-4">Loading…</div>;

  if (exams.length === 0) {
    return <div className="neu-card p-6 text-sm text-ink/50">No exams have been set for {classObj.name} yet.</div>;
  }

  return (
    <div className="neu-card p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-sm font-medium neu-panel-title">Teachers for {classObj.name}</h2>
        <select value={examId} onChange={(e) => setExamId(e.target.value)} className="neu-input text-sm">
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} (Term {e.term})
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-ink/50">No teachers assigned to this class yet.</div>
      ) : (
        <ul className="divide-y divide-navy/10">
          {rows.map((r) => {
            const submitted = submittedSubjectIds.has(r.subject.id);
            return (
              <li key={r.key} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm text-ink font-medium">{r.teacher.name}</div>
                  <div className="text-xs text-ink/50">{r.subject.name}</div>
                </div>
                <span className={`neu-badge ${submitted ? "neu-badge-open" : "neu-badge-closed"}`}>
                  {submitted ? "Submitted" : "Pending"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
