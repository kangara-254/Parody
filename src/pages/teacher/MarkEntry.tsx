import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PageHeader, EmptyState } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Exam, Learner, SchoolClass, Subject, TeacherAssignment, Mark, ExamSubjectConfig, cbcLevel } from "../../types";

// ------------------------------------------------------------------
// Offline-first mark caching.
// A teacher entering marks on a weak connection shouldn't lose work
// the moment a save fails. Every score is written to localStorage the
// instant it's typed/confirmed, BEFORE the network call is attempted.
// If the network call fails (offline, timeout, etc.) the entry stays
// cached and is retried automatically once the browser reports it's
// back online, or the next time this screen loads. Only cleared from
// the cache once Supabase confirms the write.
// Keyed by exam+class+subject so different grids never collide, and
// scoped to this device only (no cross-device sync needed -- it's
// just a local safety net until the real save lands).
// ------------------------------------------------------------------
interface PendingMark {
  learnerId: string;
  subjectId: string;
  score: number;
  subjectName: string;
  cachedAt: string;
}

function pendingCacheKey(examId: string, classId: string, subjectId: string) {
  return `jss_pending_marks:${examId}:${classId}:${subjectId}`;
}

function readPendingCache(key: string): Record<string, PendingMark> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePendingCache(key: string, cache: Record<string, PendingMark>) {
  try {
    if (Object.keys(cache).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) -- the
    // teacher's marks still get an ordinary save attempt below, this
    // just means there's no offline safety net for that attempt.
  }
}

function sanitizeMarkValue(value: string) {
  if (value === "") return "";
  const digits = value.replace(/[^\d.]/g, "");
  if (!digits) return "";
  const [whole, ...rest] = digits.split(".");
  const decimal = rest.join("");
  return decimal ? `${whole}.${decimal}` : whole;
}

export default function MarkEntry() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [scores, setScores] = useState<Record<string, string>>({});

  const [partnerMarks, setPartnerMarks] = useState<Record<string, Mark>>({});
  const [partnerScores, setPartnerScores] = useState<Record<string, string>>({});

  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [examId, setExamId] = useState("");
  const [activeHalf, setActiveHalf] = useState<"main" | "partner">("main");
  const scoreInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, "saving" | "saved" | "pending" | "error">>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const savedTimerRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [pendingMarks, setPendingMarks] = useState<Record<string, PendingMark>>({});
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [maxMarks, setMaxMarks] = useState<ExamSubjectConfig | null>(null);
  const [maxMarksDraft, setMaxMarksDraft] = useState("100");
  const [maxMarksPartner, setMaxMarksPartner] = useState<ExamSubjectConfig | null>(null);
  const [maxMarksPartnerDraft, setMaxMarksPartnerDraft] = useState("100");
  const [savingMax, setSavingMax] = useState(false);
  const [savingMaxPartner, setSavingMaxPartner] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { loadContext(); }, []);

  useEffect(() => {
    function goOnline() {
      setIsOnline(true);
      flushPending();
    }
    function goOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, classId, subjectId, activeHalf]);

  async function loadContext() {
    if (!supabase || !user) return;
    setLoading(true);
    const [a, c, s, e, ec] = await Promise.all([
      supabase.from("teacher_assignments").select("*").eq("teacher_id", user.id),
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*").order("name"),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("exam_classes").select("*"),
    ]);
    setAssignments(a.data || []);
    setClasses(c.data || []);
    setSubjects(s.data || []);
    setExams(e.data || []);
    setExamClasses(ec.data || []);
    setLoading(false);
  }

  const myClasses = useMemo(() => {
    const ids = new Set(assignments.map((a) => a.class_id));
    return classes.filter((c) => ids.has(c.id));
  }, [assignments, classes]);

  const mySubjectsForClass = useMemo(() => {
    const ids = new Set(assignments.filter((a) => a.class_id === classId).map((a) => a.subject_id));
    const assigned = subjects.filter((s) => ids.has(s.id));
    const hidden = new Set(["Composition", "Insha"]);
    return assigned.filter((s) => !hidden.has(s.name));
  }, [assignments, subjects, classId]);

  const examsForClass = useMemo(() => {
    const ids = new Set(examClasses.filter((x) => x.class_id === classId).map((x) => x.exam_id));
    return exams.filter((e) => ids.has(e.id));
  }, [examClasses, exams, classId]);

  const currentExam = exams.find((e) => e.id === examId);
  const currentSubject = subjects.find((s) => s.id === subjectId);
  const isPairedSubject = currentSubject?.name === "English" || currentSubject?.name === "Kiswahili";
  const partnerName = currentSubject?.name === "English" ? "Composition" : currentSubject?.name === "Kiswahili" ? "Insha" : null;
  const partnerSubject = useMemo(() => subjects.find((s) => s.name === partnerName) || null, [subjects, partnerName]);

  useEffect(() => {
    if (classId && !mySubjectsForClass.some((s) => s.id === subjectId)) setSubjectId("");
  }, [classId]);

  const openExamForClass = useMemo(() => examsForClass.find((e) => !e.locked) ?? null, [examsForClass]);
  useEffect(() => {
    setExamId(openExamForClass?.id ?? "");
  }, [openExamForClass]);

  useEffect(() => {
    if (classId && subjectId && examId) loadGrid();
  }, [classId, subjectId, examId]);

  useEffect(() => {
    setActiveHalf("main");
  }, [subjectId]);

  useEffect(() => {
    Object.values(savedTimerRefs.current).forEach(clearTimeout);
    savedTimerRefs.current = {};
    setRowStatus({});
    setRowError({});
    setSearch("");
  }, [classId, subjectId, examId, activeHalf]);

  const visibleLearners = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return learners;
    return learners.filter((l) => l.name.toLowerCase().includes(q));
  }, [learners, search]);

  const singleMatchId = search.trim() && visibleLearners.length === 1 ? visibleLearners[0].id : null;

  async function loadGrid() {
    if (!supabase) return;
    setError("");
    setStatus("");
    const partnerId = partnerSubject?.id;
    const [l, m, cfg, pm, pcfg] = await Promise.all([
      supabase.from("learners").select("*").eq("class_id", classId).eq("status", "active").order("name"),
      supabase.from("marks").select("*").eq("exam_id", examId).eq("subject_id", subjectId),
      supabase.from("exam_subject_config").select("*").eq("exam_id", examId).eq("subject_id", subjectId).maybeSingle(),
      partnerId ? supabase.from("marks").select("*").eq("exam_id", examId).eq("subject_id", partnerId) : Promise.resolve({ data: [] as any[] }),
      partnerId ? supabase.from("exam_subject_config").select("*").eq("exam_id", examId).eq("subject_id", partnerId).maybeSingle() : Promise.resolve({ data: null as ExamSubjectConfig | null }),
    ]);
    setLearners(l.data || []);
    const markMap: Record<string, Mark> = {};
    const scoreMap: Record<string, string> = {};
    (m.data || []).forEach((mk: any) => {
      markMap[mk.learner_id] = mk;
      scoreMap[mk.learner_id] = String(mk.score);
    });
    setMarks(markMap);
    setScores(scoreMap);
    setMaxMarks(cfg.data || null);
    setMaxMarksDraft(cfg.data ? String(cfg.data.max_marks) : "100");

    const partnerMarkMap: Record<string, Mark> = {};
    const partnerScoreMap: Record<string, string> = {};
    (((pm as any).data as any[]) || []).forEach((mk: any) => {
      partnerMarkMap[mk.learner_id] = mk;
      partnerScoreMap[mk.learner_id] = String(mk.score);
    });
    setPartnerMarks(partnerMarkMap);
    setPartnerScores(partnerScoreMap);
    const partnerCfgData = (pcfg as any).data as ExamSubjectConfig | null;
    setMaxMarksPartner(partnerCfgData || null);
    setMaxMarksPartnerDraft(partnerCfgData ? String(partnerCfgData.max_marks) : "100");
  }

  async function saveMaxMarks() {
    if (!supabase || !user || !examId || !subjectId) return;
    const val = Number(maxMarksDraft);
    if (Number.isNaN(val) || val <= 0) {
      setError("Maximum score must be a positive number.");
      return;
    }
    setSavingMax(true);
    setError("");
    const { data, error: err } = await supabase
      .from("exam_subject_config")
      .upsert(
        { exam_id: examId, subject_id: subjectId, max_marks: val, set_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: "exam_id,subject_id" }
      )
      .select()
      .single();
    setSavingMax(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMaxMarks(data as ExamSubjectConfig);
    setStatus("Maximum score saved. Scores are now graded as a percentage of this.");
  }

  async function saveMaxMarksPartner() {
    if (!supabase || !user || !examId || !partnerSubject) return;
    const val = Number(maxMarksPartnerDraft);
    if (Number.isNaN(val) || val <= 0) {
      setError("Maximum score must be a positive number.");
      return;
    }
    setSavingMaxPartner(true);
    setError("");
    const { data, error: err } = await supabase
      .from("exam_subject_config")
      .upsert(
        {
          exam_id: examId,
          subject_id: partnerSubject.id,
          max_marks: val,
          set_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "exam_id,subject_id" }
      )
      .select()
      .single();
    setSavingMaxPartner(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMaxMarksPartner(data as ExamSubjectConfig);
    setStatus(`Maximum score saved for ${partnerSubject.name}.`);
  }

  function updateScore(learnerId: string, value: string) {
    setScores((s) => ({ ...s, [learnerId]: value }));
  }

  function updatePartnerScore(learnerId: string, value: string) {
    setPartnerScores((s) => ({ ...s, [learnerId]: value }));
  }

  const effectiveMax = maxMarks?.max_marks ?? Number(maxMarksDraft) ?? 100;
  const effectiveMaxPartner = maxMarksPartner?.max_marks ?? Number(maxMarksPartnerDraft) ?? 100;

  const activeView = useMemo(() => {
    const isPartner = isPairedSubject && activeHalf === "partner";
    return {
      subjectId: isPartner ? partnerSubject?.id ?? "" : subjectId,
      subjectName: isPartner ? partnerName ?? "" : currentSubject?.name ?? "",
      scoreMap: isPartner ? partnerScores : scores,
      updateScore: isPartner ? updatePartnerScore : updateScore,
      marksMap: isPartner ? partnerMarks : marks,
      maxConfig: isPartner ? maxMarksPartner : maxMarks,
      max: isPartner ? effectiveMaxPartner : effectiveMax,
    };
  }, [isPairedSubject, activeHalf, partnerSubject, partnerName, subjectId, currentSubject, partnerScores, scores, partnerMarks, marks, maxMarksPartner, maxMarks, effectiveMaxPartner, effectiveMax]);

  const readyToEnter = !!activeView.maxConfig;

  const pendingCount = Object.keys(pendingMarks).length;

  useEffect(() => {
    if (!activeView.subjectId || !classId || !examId) {
      setPendingMarks({});
      return;
    }
    const key = pendingCacheKey(examId, classId, activeView.subjectId);
    const cached = readPendingCache(key);
    setPendingMarks(cached);
    if (Object.keys(cached).length > 0) {
      Object.values(cached).forEach((pm) => activeView.updateScore(pm.learnerId, String(pm.score)));
      setRowStatus((s) => {
        const next = { ...s };
        Object.keys(cached).forEach((learnerId) => (next[learnerId] = "pending"));
        return next;
      });
      if (navigator.onLine) flushPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView.subjectId, classId, examId]);

  function flushPending() {
    const subjId = activeView.subjectId;
    if (!supabase || !subjId || !classId || !examId) return;
    const key = pendingCacheKey(examId, classId, subjId);
    const cache = readPendingCache(key);
    const entries = Object.values(cache);
    if (entries.length === 0) return;
    entries.forEach(async (pm) => {
      setRowStatus((s) => ({ ...s, [pm.learnerId]: "saving" }));
      const { error: err } = await supabase!.from("marks").upsert(
        [
          {
            exam_id: examId,
            learner_id: pm.learnerId,
            subject_id: pm.subjectId,
            score: pm.score,
            entered_by: user!.id,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: "exam_id,learner_id,subject_id" }
      );
      if (err) {
        setRowStatus((s) => ({ ...s, [pm.learnerId]: "pending" }));
        return;
      }
      const current = readPendingCache(key);
      delete current[pm.learnerId];
      writePendingCache(key, current);
      setPendingMarks(current);
      setRowStatus((s) => ({ ...s, [pm.learnerId]: "saved" }));
      clearTimeout(savedTimerRefs.current[pm.learnerId]);
      savedTimerRefs.current[pm.learnerId] = setTimeout(() => {
        setRowStatus((s) => {
          if (s[pm.learnerId] !== "saved") return s;
          const next = { ...s };
          delete next[pm.learnerId];
          return next;
        });
      }, 1800);
    });
  }

  function cachePendingMark(learnerId: string, subjId: string, score: number, subjectName: string) {
    if (!classId || !examId) return;
    const key = pendingCacheKey(examId, classId, subjId);
    const cache = readPendingCache(key);
    cache[learnerId] = { learnerId, subjectId: subjId, score, subjectName, cachedAt: new Date().toISOString() };
    writePendingCache(key, cache);
    setPendingMarks(cache);
  }

  function clearPendingMark(learnerId: string, subjId: string) {
    if (!classId || !examId) return;
    const key = pendingCacheKey(examId, classId, subjId);
    const cache = readPendingCache(key);
    delete cache[learnerId];
    writePendingCache(key, cache);
    setPendingMarks(cache);
  }

  function focusNextScoreInput(currentLearnerId: string) {
    if (!search.trim()) {
      const idx = learners.findIndex((l) => l.id === currentLearnerId);
      const next = idx >= 0 ? learners[idx + 1] : null;
      if (next) {
        scoreInputRefs.current[next.id]?.focus();
        scoreInputRefs.current[next.id]?.select();
        return;
      }
      saveButtonRef.current?.focus();
      return;
    }
    setSearch("");
    searchInputRef.current?.focus();
  }

  async function autoSaveRow(learnerId: string, subjectIdToSave: string, score: number, subjectName: string, isLastLearner: boolean) {
    if (!supabase || !user) return;
    cachePendingMark(learnerId, subjectIdToSave, score, subjectName);
    setRowStatus((s) => ({ ...s, [learnerId]: "saving" }));
    if (!navigator.onLine) {
      setRowStatus((s) => ({ ...s, [learnerId]: "pending" }));
      return;
    }
    const { error: err } = await supabase.from("marks").upsert(
      [
        {
          exam_id: examId,
          learner_id: learnerId,
          subject_id: subjectIdToSave,
          score,
          entered_by: user.id,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "exam_id,learner_id,subject_id" }
    );
    if (err) {
      setRowStatus((s) => ({ ...s, [learnerId]: "pending" }));
      return;
    }
    clearPendingMark(learnerId, subjectIdToSave);
    setRowError((e) => {
      const next = { ...e };
      delete next[learnerId];
      return next;
    });
    setRowStatus((s) => ({ ...s, [learnerId]: "saved" }));
    clearTimeout(savedTimerRefs.current[learnerId]);
    savedTimerRefs.current[learnerId] = setTimeout(() => {
      setRowStatus((s) => {
        if (s[learnerId] !== "saved") return s;
        const next = { ...s };
        delete next[learnerId];
        return next;
      });
    }, 1800);

    if (isLastLearner) {
      setStatus(`All ${subjectName} marks are saved. Safe to switch subjects or move on.`);
    }
  }

  function handleScoreKeyDown(e: KeyboardEvent<HTMLInputElement>, learnerId: string) {
    // A digit must not save or leave the box. Enter is the only key
    // that commits this row and moves to the next learner, including
    // a one-digit mark such as 7.
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (currentExam?.locked) return;

    const idx = learners.findIndex((l) => l.id === learnerId);
    const isLastLearner = !search.trim() && idx === learners.length - 1;

    const raw = activeView.scoreMap[learnerId];
    if (raw === undefined || raw === "") {
      focusNextScoreInput(learnerId);
      return;
    }
    const max = activeView.maxConfig?.max_marks;
    const score = Number(raw);
    if (Number.isNaN(score) || max === undefined || score < 0 || score > max) {
      setRowStatus((s) => ({ ...s, [learnerId]: "error" }));
      setRowError((e2) => ({ ...e2, [learnerId]: `Must be 0–${max ?? "?"}` }));
      return;
    }
    setStatus("");
    focusNextScoreInput(learnerId);
    autoSaveRow(learnerId, activeView.subjectId, score, activeView.subjectName, isLastLearner);
  }

  async function saveAll() {
    if (!supabase || !currentExam) return;
    if (currentExam.locked) {
      setError("This exam is locked by admin. You can no longer edit marks for it.");
      return;
    }
    if (!activeView.maxConfig) {
      setError(`Set and save the maximum score for ${activeView.subjectName} before entering scores.`);
      return;
    }
    setError("");
    setSaving(true);

    function buildRows(subjId: string, scoreMap: Record<string, string>, max: number) {
      return learners
        .map((l) => {
          const raw = scoreMap[l.id];
          if (raw === undefined || raw === "") return null;
          const score = Number(raw);
          if (Number.isNaN(score) || score < 0 || score > max) return { invalid: true, name: l.name };
          return {
            exam_id: examId,
            learner_id: l.id,
            subject_id: subjId,
            score,
            entered_by: user!.id,
            updated_at: new Date().toISOString(),
          };
        })
        .filter(Boolean) as any[];
    }

    const rows = buildRows(activeView.subjectId, activeView.scoreMap, activeView.max);
    const invalid = rows.find((r) => r.invalid);
    if (invalid) {
      setSaving(false);
      setError(`Invalid score for ${invalid.name} in ${activeView.subjectName}. Scores must be between 0 and ${activeView.max}.`);
      return;
    }

    rows.forEach((r) => cachePendingMark(r.learner_id, r.subject_id, r.score, activeView.subjectName));

    if (!navigator.onLine) {
      setSaving(false);
      setStatus(`${rows.length} mark(s) cached on this device — they'll sync automatically once you're back online.`);
      setRowStatus((s) => {
        const next = { ...s };
        rows.forEach((r) => (next[r.learner_id] = "pending"));
        return next;
      });
      return;
    }

    const { error: err } = await supabase.from("marks").upsert(rows, { onConflict: "exam_id,learner_id,subject_id" });
    setSaving(false);
    if (err) {
      setStatus(`Couldn't reach the server. ${rows.length} mark(s) are saved on this device and will sync automatically.`);
      setRowStatus((s) => {
        const next = { ...s };
        rows.forEach((r) => (next[r.learner_id] = "pending"));
        return next;
      });
      return;
    }
    rows.forEach((r) => clearPendingMark(r.learner_id, r.subject_id));
    setStatus(`Saved ${rows.length} mark(s) for ${activeView.subjectName}.`);
    setJustSaved(true);
    clearTimeout(justSavedTimer.current);
    justSavedTimer.current = setTimeout(() => setJustSaved(false), 2200);
    loadGrid();
  }

  return (
    <div>
      <PageHeader title="Enter Marks" description="Pick a class, learning area and exam you're assigned to, then fill in the grid." />

      {!loading && myClasses.length === 0 && (
        <div className="glass-card"><EmptyState title="No classes assigned yet" hint="Ask your admin to assign you a class and subject." /></div>
      )}

      {myClasses.length > 0 && (
        <>
          <div className="glass-card p-5 mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="glass-input">
              <option value="">Select class</option>
              {myClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!classId} className="glass-input disabled:opacity-50">
              <option value="">Select learning area</option>
              {mySubjectsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className={`glass-input flex items-center ${!classId || openExamForClass ? "text-ink" : "text-maroon"}`}>
              {!classId ? (
                <span className="text-ink/40">Select a class first</span>
              ) : openExamForClass ? (
                <>
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2 shrink-0" />
                  {openExamForClass.name} (Term {openExamForClass.term})
                </>
              ) : (
                "No exam is currently open for marks entry."
              )}
            </div>
          </div>

          {isPairedSubject && classId && (
            <div className="text-xs text-ink/50 mb-4 px-1">
              {currentSubject?.name} covers <strong>{partnerName}</strong> too, but they're entered independently — pick one below, finish the class, then switch to the other. They're only combined into one {currentSubject?.name} grade elsewhere in the portal.
            </div>
          )}

          {currentExam?.locked && (
            <div className="text-sm text-maroon bg-maroon/10 border border-maroon/20 rounded-lg px-3 py-2 mb-4">
              This exam is locked. You can view marks but can't edit them — ask admin to unlock it.
            </div>
          )}

          {classId && subjectId && !openExamForClass && (
            <div className="glass-card mb-4"><EmptyState title="No exam is open for marks entry" hint="Past assessments for this class can still be viewed under Marklist." /></div>
          )}

          {classId && subjectId && examId && (
            <>
              {isPairedSubject && (
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setActiveHalf("main")} className={`text-sm px-4 py-2 rounded-lg font-medium transition ${activeHalf === "main" ? "bg-maroon text-white" : "bg-black/5 text-ink/60 hover:bg-black/10"}`}>
                    {currentSubject?.name}
                  </button>
                  <button onClick={() => setActiveHalf("partner")} className={`text-sm px-4 py-2 rounded-lg font-medium transition ${activeHalf === "partner" ? "bg-maroon text-white" : "bg-black/5 text-ink/60 hover:bg-black/10"}`}>
                    {partnerName}
                  </button>
                </div>
              )}

              <div className="glass-card p-5 mb-5">
                <div className="text-sm font-medium text-ink mb-2">Maximum score for {activeView.subjectName}</div>
                <p className="text-xs text-ink/50 mb-3">What was this exam out of? Set it once — every score below is graded as a percentage of this, not out of 100.</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="number" min={1} value={activeHalf === "partner" ? maxMarksPartnerDraft : maxMarksDraft} onChange={(e) => (activeHalf === "partner" ? setMaxMarksPartnerDraft(e.target.value) : setMaxMarksDraft(e.target.value))} disabled={!!currentExam?.locked} className="glass-input w-28 disabled:opacity-50 no-spinner" />
                  <button onClick={activeHalf === "partner" ? saveMaxMarksPartner : saveMaxMarks} disabled={(activeHalf === "partner" ? savingMaxPartner : savingMax) || !!currentExam?.locked} className="glass-btn-sm disabled:opacity-40">
                    {(activeHalf === "partner" ? savingMaxPartner : savingMax) ? "Saving…" : activeView.maxConfig ? "Update" : "Save"}
                  </button>
                  {activeView.maxConfig && <span className="text-xs text-ink/50">Currently out of {activeView.maxConfig.max_marks}.</span>}
                  {!activeView.maxConfig && <span className="text-xs text-maroon">Not set yet — set this before entering scores.</span>}
                </div>
              </div>

              {learners.length > 0 && readyToEnter && (
                <div className="mb-3 flex items-center gap-2">
                  <input ref={searchInputRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a learner by name — e.g. to mark scripts in the order you picked them up, or fix one score" className="glass-input w-full text-sm" />
                  {search && (
                    <button type="button" onClick={() => { setSearch(""); searchInputRef.current?.focus(); }} className="glass-btn-sm shrink-0">Clear</button>
                  )}
                </div>
              )}

              {search.trim() && (
                <div className="mb-2 text-xs text-ink/50">
                  {visibleLearners.length === 0 ? "No learner matches that." : `${visibleLearners.length} match${visibleLearners.length === 1 ? "" : "es"} — showing filtered list below.`}
                </div>
              )}

              <div className="glass-card overflow-hidden">
                {learners.length === 0 ? (
                  <EmptyState title="No learners in this class yet" hint="Ask your admin or class teacher to add learners." />
                ) : !readyToEnter ? (
                  <EmptyState title="Set the maximum score first" hint="The mark grid unlocks once you set the maximum score above." />
                ) : (
                  <>
                    <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-paper text-left shadow-[0_1px_0_0_rgba(36,20,23,0.10)]">
                            <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 bg-paper sticky top-0 left-0 z-30">Learner</th>
                            <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 w-24 sm:w-32 bg-paper sticky top-0 z-20">Score (0–{activeView.maxConfig?.max_marks})</th>
                            <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 w-16 sm:w-20 bg-paper sticky top-0 z-20">%</th>
                            <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 w-20 sm:w-28 bg-paper sticky top-0 z-20">Level</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* One stable list. Splitting rows into "needs a
                              mark / pending / saved" on each keystroke moved
                              the focused input and dropped the caret after
                              the first digit. Status stays on the row. */}
                          {visibleLearners.map((l) => {
                            const val = activeView.scoreMap[l.id] ?? "";
                            const numeric = Number(val);
                            const valid = val !== "" && !Number.isNaN(numeric);
                            const pct = valid ? (numeric / (activeView.maxConfig?.max_marks ?? 1)) * 100 : null;
                            const level = pct !== null ? cbcLevel(pct) : null;
                            const isBlank = val === "";
                            return (
                              <tr key={l.id} className={`border-t border-line ${l.id === singleMatchId ? "bg-maroon-50" : ""}`}>
                                <td className="px-3 sm:px-5 py-2 text-ink bg-paper sticky left-0 z-10">{l.name}</td>
                                <td className="px-3 sm:px-5 py-2">
                                  <div className="flex flex-col gap-0.5">
                                    <input
                                      ref={(el) => (scoreInputRefs.current[l.id] = el)}
                                      type="text"
                                      inputMode="numeric"
                                      value={val}
                                      disabled={!!currentExam?.locked}
                                      placeholder="—"
                                      onChange={(e) => {
                                        const next = sanitizeMarkValue(e.target.value);
                                        activeView.updateScore(l.id, next);
                                        setRowStatus((s) => {
                                          if (!(l.id in s)) return s;
                                          const nextStatus = { ...s };
                                          delete nextStatus[l.id];
                                          return nextStatus;
                                        });
                                      }}
                                      onKeyDown={(e) => handleScoreKeyDown(e, l.id)}
                                      className={`w-20 sm:w-24 glass-input text-sm disabled:opacity-50 no-spinner transition-shadow duration-300 ${
                                        rowStatus[l.id] === "saved"
                                          ? "ring-2 ring-success confirm-pulse"
                                          : rowStatus[l.id] === "pending"
                                          ? "ring-2 ring-amber-400"
                                          : rowStatus[l.id] === "error"
                                          ? "ring-2 ring-maroon"
                                          : isBlank
                                          ? "ring-1 ring-maroon/30"
                                          : ""
                                      }`}
                                    />
                                    {rowStatus[l.id] === "saving" && <span className="text-[10px] text-ink/40">Saving…</span>}
                                    {rowStatus[l.id] === "saved" && <span className="text-[10px] text-success">✓ Saved</span>}
                                    {rowStatus[l.id] === "pending" && <span className="text-[10px] text-amber-600">{isOnline ? "Syncing…" : "⏳ Saved on device — will sync"}</span>}
                                    {rowStatus[l.id] === "error" && <span className="text-[10px] text-maroon" title={rowError[l.id]}>⚠ {rowError[l.id] || "Not saved"}</span>}
                                    {isBlank && !rowStatus[l.id] && <span className="text-[10px] text-maroon/70">Not marked</span>}
                                  </div>
                                </td>
                                <td className="px-3 sm:px-5 py-2 text-xs text-ink/60">{pct !== null ? `${Math.round(pct)}%` : "—"}</td>
                                <td className="px-3 sm:px-5 py-2">
                                  {level ? <span className={`neu-badge neu-badge-${level.toLowerCase()}`}>{level}</span> : <span className="text-xs text-ink/40">—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-5 border-t border-line flex items-center gap-3 flex-wrap">
                      <button ref={saveButtonRef} onClick={saveAll} disabled={saving || !!currentExam?.locked} className={`glass-btn disabled:opacity-40 transition-colors duration-300 ${justSaved ? "!bg-success !text-white confirm-pulse" : ""}`}>
                        {saving ? "Saving…" : justSaved ? "✓ Saved" : `Save ${activeView.subjectName} marks`}
                      </button>
                      {status && <span className="text-sm text-success bg-success/10 border border-success/20 rounded-full px-3 py-1">✓ {status}</span>}
                      {pendingCount > 0 && (
                        <span className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                          {isOnline ? "Syncing" : "⏳"} {pendingCount} mark{pendingCount === 1 ? "" : "s"} saved on this device, not yet on the server
                        </span>
                      )}
                      {error && <span className="text-sm text-maroon">{error}</span>}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
