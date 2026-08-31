import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Exam, Learner, SchoolClass, Subject, TeacherAssignment, Mark, ExamSubjectConfig, cbcLevel } from "../../types";

export default function MarkEntry() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [examClasses, setExamClasses] = useState<{ exam_id: string; class_id: string }[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({}); // key = learnerId, main subject
  const [scores, setScores] = useState<Record<string, string>>({}); // draft values, key = learnerId, main subject

  // Composition/Insha -- the partner half of a paired learning area.
  // These never get their own row in the subject picker (see
  // mySubjectsForClass below). The teacher enters them independently
  // from English/Kiswahili, via the tab switcher below (see activeHalf
  // and activeView) -- never as a second column next to the main
  // subject.
  const [partnerMarks, setPartnerMarks] = useState<Record<string, Mark>>({});
  const [partnerScores, setPartnerScores] = useState<Record<string, string>>({});

  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [examId, setExamId] = useState("");
  // A paired learning area (English/Kiswahili) shows its two halves as
  // tabs, not side-by-side columns -- the teacher finishes one half for
  // the whole class, then switches. "main" = the picked subject itself
  // (English/Kiswahili), "partner" = its pair (Composition/Insha).
  const [activeHalf, setActiveHalf] = useState<"main" | "partner">("main");
  const scoreInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  // Per-row autosave feedback for the Enter-to-advance flow (see
  // autoSaveRow / handleScoreKeyDown below). Keyed by learner id.
  // "saved" entries clear themselves after a couple of seconds via
  // savedTimerRefs; "error" entries stick around until fixed.
  const [rowStatus, setRowStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const savedTimerRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
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

  useEffect(() => {
    loadContext();
  }, []);

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

  // A teacher given English or Kiswahili automatically also holds
  // Composition or Insha (see the pair_learning_area_assignment trigger
  // in schema.sql) — but each pair should still show as ONE learning
  // area to pick from here, not two, so picking a class/subject/exam
  // stays simple. Composition/Insha marks are still entered below, as a
  // second column next to English/Kiswahili once picked -- they just
  // never appear as their own separately-selectable learning area.
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

  // Marks entry always targets the ONE exam currently open for this
  // class -- a teacher shouldn't have to pick through a list of old
  // exams just to find the editable one. examsForClass is already
  // scoped to the picked class, so this is just "which of those is
  // open" (at most one, per the single-open-exam rule -- see
  // Exams.tsx and the exams_single_open DB trigger). If nothing is
  // open for this class, examId stays empty and the UI below shows a
  // plain "no exam open" message instead of a picker.
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
  }, [classId, subjectId, examId, activeHalf]);

  async function loadGrid() {
    if (!supabase) return;
    setError("");
    setStatus("");
    const partnerId = partnerSubject?.id;
    const [l, m, cfg, pm, pcfg] = await Promise.all([
      // Mark entry is always for the class as it stands today -- only
      // currently-active learners should get a row to enter marks for.
      supabase.from("learners").select("*").eq("class_id", classId).eq("status", "active").order("name"),
      supabase.from("marks").select("*").eq("exam_id", examId).eq("subject_id", subjectId),
      supabase.from("exam_subject_config").select("*").eq("exam_id", examId).eq("subject_id", subjectId).maybeSingle(),
      partnerId
        ? supabase.from("marks").select("*").eq("exam_id", examId).eq("subject_id", partnerId)
        : Promise.resolve({ data: [] as any[] }),
      partnerId
        ? supabase.from("exam_subject_config").select("*").eq("exam_id", examId).eq("subject_id", partnerId).maybeSingle()
        : Promise.resolve({ data: null as ExamSubjectConfig | null }),
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
      setError("Max marks must be a positive number.");
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
    setStatus("Max marks saved. Scores are now graded as a percentage of this.");
  }

  async function saveMaxMarksPartner() {
    if (!supabase || !user || !examId || !partnerSubject) return;
    const val = Number(maxMarksPartnerDraft);
    if (Number.isNaN(val) || val <= 0) {
      setError("Max marks must be a positive number.");
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
    setStatus(`Max marks saved for ${partnerSubject.name}.`);
  }

  function updateScore(learnerId: string, value: string) {
    setScores((s) => ({ ...s, [learnerId]: value }));
  }

  function updatePartnerScore(learnerId: string, value: string) {
    setPartnerScores((s) => ({ ...s, [learnerId]: value }));
  }

  const effectiveMax = maxMarks?.max_marks ?? Number(maxMarksDraft) ?? 100;
  const effectiveMaxPartner = maxMarksPartner?.max_marks ?? Number(maxMarksPartnerDraft) ?? 100;

  // Everything the grid/table needs to render ONE learning area's entry
  // column -- the currently active half. For a non-paired subject
  // there's only ever one half. For a paired one, main/partner are
  // entered on entirely separate visits (different tab, different
  // save), so only the active half's data is relevant to what's on
  // screen right now.
  const activeView = useMemo(() => {
    const isPartner = isPairedSubject && activeHalf === "partner";
    return {
      subjectId: isPartner ? partnerSubject?.id ?? "" : subjectId,
      subjectName: isPartner ? partnerName ?? "" : currentSubject?.name ?? "",
      scoreMap: isPartner ? partnerScores : scores,
      updateScore: isPartner ? updatePartnerScore : updateScore,
      maxConfig: isPartner ? maxMarksPartner : maxMarks,
      max: isPartner ? effectiveMaxPartner : effectiveMax,
    };
  }, [isPairedSubject, activeHalf, partnerSubject, partnerName, subjectId, currentSubject, partnerScores, scores, maxMarksPartner, maxMarks, effectiveMaxPartner, effectiveMax]);

  const readyToEnter = !!activeView.maxConfig;

  function focusNextScoreInput(currentLearnerId: string) {
    const idx = learners.findIndex((l) => l.id === currentLearnerId);
    const next = idx >= 0 ? learners[idx + 1] : null;
    if (next) {
      scoreInputRefs.current[next.id]?.focus();
      scoreInputRefs.current[next.id]?.select();
    } else {
      saveButtonRef.current?.focus();
    }
  }

  // Saves exactly one learner's mark for the currently active
  // half/subject -- fired the moment Enter is pressed on that row, not
  // batched with the rest. Runs after handleScoreKeyDown has already
  // validated the value, so this only ever hits the network with
  // something that's allowed to be saved.
  //
  // isLastLearner is true when this was the bottom row in the list --
  // i.e. the teacher just pressed Enter after the last learner, which
  // is the moment right before they'd switch to the paired subject's
  // tab or leave the page. That's the one save that needs a clear,
  // hard-to-miss confirmation, not just the small per-row flash.
  async function autoSaveRow(learnerId: string, subjectIdToSave: string, score: number, subjectName: string, isLastLearner: boolean) {
    if (!supabase || !user) return;
    setRowStatus((s) => ({ ...s, [learnerId]: "saving" }));
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
      setRowStatus((s) => ({ ...s, [learnerId]: "error" }));
      setRowError((e) => ({ ...e, [learnerId]: err.message }));
      return;
    }
    setRowError((e) => {
      const next = { ...e };
      delete next[learnerId];
      return next;
    });
    setRowStatus((s) => ({ ...s, [learnerId]: "saved" }));
    clearTimeout(savedTimerRefs.current[learnerId]);
    savedTimerRefs.current[learnerId] = setTimeout(() => {
      setRowStatus((s) => {
        if (s[learnerId] !== "saved") return s; // don't clobber a newer status
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
    if (e.key !== "Enter") return;
    // Plain input[type=number] would otherwise let Enter interact with
    // the native spinner/step behaviour on some browsers instead of
    // moving on -- always take over Enter here.
    e.preventDefault();
    if (currentExam?.locked) return;

    const idx = learners.findIndex((l) => l.id === learnerId);
    const isLastLearner = idx === learners.length - 1;

    const raw = activeView.scoreMap[learnerId];
    if (raw === undefined || raw === "") {
      // Nothing typed for this row -- just move on, nothing to save.
      focusNextScoreInput(learnerId);
      return;
    }
    const max = activeView.maxConfig?.max_marks;
    const score = Number(raw);
    if (Number.isNaN(score) || max === undefined || score < 0 || score > max) {
      // Invalid -- flag it and keep focus here rather than advancing,
      // so a mistyped mark can't silently slip past uncaught.
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
      setError(`Set and save the max marks for ${activeView.subjectName} before entering scores.`);
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

    // Only the active half's rows are saved -- main and partner are
    // independent entry sessions now, so there is nothing to combine
    // here (see activeView above).
    const rows = buildRows(activeView.subjectId, activeView.scoreMap, activeView.max);
    const invalid = rows.find((r) => r.invalid);
    if (invalid) {
      setSaving(false);
      setError(`Invalid score for ${invalid.name} in ${activeView.subjectName}. Scores must be between 0 and ${activeView.max}.`);
      return;
    }

    const { error: err } = await supabase.from("marks").upsert(rows, { onConflict: "exam_id,learner_id,subject_id" });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setStatus(`Saved ${rows.length} mark(s) for ${activeView.subjectName}.`);
    // Button flashes green + "Saved ✓" for a couple of seconds so
    // pressing Save gives an unmistakable confirmation, not just a
    // line of text elsewhere on the page.
    setJustSaved(true);
    clearTimeout(justSavedTimer.current);
    justSavedTimer.current = setTimeout(() => setJustSaved(false), 2200);
    loadGrid();
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Enter Marks</h1>
        <p className="text-sm text-ink/60 mt-1">Pick a class, learning area and exam you're assigned to, then fill in the grid.</p>
      </header>

      {!loading && myClasses.length === 0 && (
        <div className="text-sm text-ink/60 glass-card p-6">
          You haven't been assigned to any classes yet. Ask your admin to assign you a class and subject.
        </div>
      )}

      {myClasses.length > 0 && (
        <>
          <div className="glass-card p-5 mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="glass-input">
              <option value="">Select class</option>
              {myClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={!classId}
              className="glass-input disabled:opacity-50"
            >
              <option value="">Select learning area</option>
              {mySubjectsForClass.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {/* Read-only status, not a picker -- see openExamForClass above.
                There's never more than one open exam to choose between, so
                a dropdown here would just be old exams a teacher could
                accidentally (and harmlessly, since locked exams reject
                edits) select instead of the one that matters right now. */}
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
              {currentSubject?.name} covers <strong>{partnerName}</strong> too, but they're entered independently —
              pick one below, finish the class, then switch to the other. They're only combined into one{" "}
              {currentSubject?.name} grade elsewhere in the portal.
            </div>
          )}

          {currentExam?.locked && (
            <div className="text-sm text-maroon bg-maroon/10 border border-maroon/20 rounded-lg px-3 py-2 mb-4">
              This exam is locked. You can view marks but can't edit them — ask admin to unlock it.
            </div>
          )}

          {classId && subjectId && !openExamForClass && (
            <div className="glass-card p-6 text-sm text-ink/50 mb-4">
              No exam is currently open for marks entry.{" "}
              <span className="text-ink/40">Past assessments for this class can still be viewed under Marklist.</span>
            </div>
          )}

          {classId && subjectId && examId && (
            <>
              {isPairedSubject && (
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setActiveHalf("main")}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition ${
                      activeHalf === "main" ? "bg-maroon text-white" : "bg-black/5 text-ink/60 hover:bg-black/10"
                    }`}
                  >
                    {currentSubject?.name}
                  </button>
                  <button
                    onClick={() => setActiveHalf("partner")}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition ${
                      activeHalf === "partner" ? "bg-maroon text-white" : "bg-black/5 text-ink/60 hover:bg-black/10"
                    }`}
                  >
                    {partnerName}
                  </button>
                </div>
              )}

              <div className="glass-card p-5 mb-5">
                <div className="text-sm font-medium text-ink mb-2">Max marks for {activeView.subjectName}</div>
                <p className="text-xs text-ink/50 mb-3">
                  What was this exam out of? Set it once — every score below is graded as a percentage of this, not out of 100.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="number"
                    min={1}
                    value={activeHalf === "partner" ? maxMarksPartnerDraft : maxMarksDraft}
                    onChange={(e) => (activeHalf === "partner" ? setMaxMarksPartnerDraft(e.target.value) : setMaxMarksDraft(e.target.value))}
                    disabled={!!currentExam?.locked}
                    className="glass-input w-28 disabled:opacity-50 no-spinner"
                  />
                  <button
                    onClick={activeHalf === "partner" ? saveMaxMarksPartner : saveMaxMarks}
                    disabled={(activeHalf === "partner" ? savingMaxPartner : savingMax) || !!currentExam?.locked}
                    className="glass-btn-sm disabled:opacity-40"
                  >
                    {(activeHalf === "partner" ? savingMaxPartner : savingMax)
                      ? "Saving…"
                      : activeView.maxConfig
                      ? "Update"
                      : "Save"}
                  </button>
                  {activeView.maxConfig && <span className="text-xs text-ink/50">Currently out of {activeView.maxConfig.max_marks}.</span>}
                  {!activeView.maxConfig && <span className="text-xs text-maroon">Not set yet — set this before entering scores.</span>}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                {learners.length === 0 ? (
                  <div className="p-6 text-sm text-ink/50">No learners in this class yet.</div>
                ) : !readyToEnter ? (
                  <div className="p-6 text-sm text-ink/50">Set the max marks above first.</div>
                ) : (
                  <>
                    {/* One column of scores at a time (see activeView) --
                        keeps this usable on a phone-width screen and
                        matches the fact that main/partner are now
                        separate entry sessions, not two things a teacher
                        fills in side by side. Learner name column is
                        sticky-left so it stays visible while scrolling
                        horizontally on narrow screens. */}
                    <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-paper text-left sticky top-0 z-10 shadow-[0_1px_0_0_rgba(36,20,23,0.10)]">
                          <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 bg-paper sticky left-0 z-20">Learner</th>
                          <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 w-24 sm:w-32 bg-paper">
                            Score (0–{activeView.maxConfig?.max_marks})
                          </th>
                          <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 w-16 sm:w-20 bg-paper">%</th>
                          <th className="px-3 sm:px-5 py-3 font-medium text-ink/60 w-20 sm:w-28 bg-paper">Level</th>
                        </tr>
                      </thead>
                      <tbody>
                        {learners.map((l) => {
                          const val = activeView.scoreMap[l.id] ?? "";
                          const numeric = Number(val);
                          const valid = val !== "" && !Number.isNaN(numeric);
                          const pct = valid ? (numeric / (activeView.maxConfig?.max_marks ?? 1)) * 100 : null;
                          const level = pct !== null ? cbcLevel(pct) : null;
                          return (
                            <tr key={l.id} className="border-t border-line">
                              <td className="px-3 sm:px-5 py-2 text-ink bg-paper sticky left-0 z-10">{l.name}</td>
                              <td className="px-3 sm:px-5 py-2">
                                <div className="flex flex-col gap-0.5">
                                  <input
                                    ref={(el) => (scoreInputRefs.current[l.id] = el)}
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    max={activeView.maxConfig?.max_marks}
                                    value={val}
                                    disabled={!!currentExam?.locked}
                                    onChange={(e) => {
                                      activeView.updateScore(l.id, e.target.value);
                                      // Typing again after a save/error clears the
                                      // stale indicator instead of leaving a "✓
                                      // Saved" sitting under a since-edited value.
                                      setRowStatus((s) => {
                                        if (!(l.id in s)) return s;
                                        const next = { ...s };
                                        delete next[l.id];
                                        return next;
                                      });
                                    }}
                                    onKeyDown={(e) => handleScoreKeyDown(e, l.id)}
                                    className={`w-20 sm:w-24 glass-input text-sm disabled:opacity-50 no-spinner transition-shadow duration-300 ${
                                      rowStatus[l.id] === "saved"
                                        ? "ring-2 ring-success confirm-pulse"
                                        : rowStatus[l.id] === "error"
                                        ? "ring-2 ring-maroon"
                                        : ""
                                    }`}
                                  />
                                  {rowStatus[l.id] === "saving" && (
                                    <span className="text-[10px] text-ink/40">Saving…</span>
                                  )}
                                  {rowStatus[l.id] === "saved" && (
                                    <span className="text-[10px] text-success">✓ Saved</span>
                                  )}
                                  {rowStatus[l.id] === "error" && (
                                    <span className="text-[10px] text-maroon" title={rowError[l.id]}>
                                      ⚠ {rowError[l.id] || "Not saved"}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 sm:px-5 py-2 text-xs text-ink/60">{pct !== null ? `${Math.round(pct)}%` : "—"}</td>
                              <td className="px-3 sm:px-5 py-2">
                                {level ? (
                                  <span className={`neu-badge neu-badge-${level.toLowerCase()}`}>{level}</span>
                                ) : (
                                  <span className="text-xs text-ink/40">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                    <div className="p-5 border-t border-line flex items-center gap-3 flex-wrap">
                      <button
                        ref={saveButtonRef}
                        onClick={saveAll}
                        disabled={saving || !!currentExam?.locked}
                        className={`glass-btn disabled:opacity-40 transition-colors duration-300 ${
                          justSaved ? "!bg-success !text-white confirm-pulse" : ""
                        }`}
                      >
                        {saving ? "Saving…" : justSaved ? "✓ Saved" : `Save ${activeView.subjectName} marks`}
                      </button>
                      {status && (
                        <span className="text-sm text-success bg-success/10 border border-success/20 rounded-full px-3 py-1">
                          ✓ {status}
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
