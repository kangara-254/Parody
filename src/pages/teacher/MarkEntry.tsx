import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useNavigate } from "react-router-dom";
import { EXAMS, SUBJECTS } from "../../../config";
import { supabase } from "../../../lib/supabase";
import { useOnlineStatus } from "../../../hooks/useOnlineStatus";
import { useLearnerCache } from "../../../hooks/useLearnerCache";
import Loading from "../../Loading";

interface Mark {
  learner_id: string;
  draft_score?: number;
  committed_score: number;
  committed_at: string;
}

export default function MarkEntry() {
  const { classId, examId, subjectId } = useParams();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [rowStatus, setRowStatus] = useState<Record<string, "pending" | "error">>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement>>({});

  const { learners } = useLearnerCache(classId);
  const currentExam = EXAMS.find((e) => e.id === examId);
  const activeView = SUBJECTS.find((s) => s.id === subjectId);

  useEffect(() => {
    const loadMarks = async () => {
      try {
        const { data, error: err } = await supabase
          .from("exam_marks")
          .select("*")
          .eq("class_id", classId)
          .eq("exam_id", examId)
          .eq("subject_id", subjectId);

        if (err) throw err;

        setMarks(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load marks");
      } finally {
        setLoading(false);
      }
    };

    loadMarks();
  }, [classId, examId, subjectId]);

  const handleScoreChange = (learnerId: string, value: string) => {
    const numValue = value === "" ? undefined : parseInt(value, 10);
    setMarks((prev) =>
      prev.map((m) =>
        m.learner_id === learnerId ? { ...m, draft_score: numValue } : m
      )
    );
  };

  const handleScoreKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>, learnerId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await autoSaveRow(learnerId);
      focusNextScoreInput(learnerId);
    }
  };

  const autoSaveRow = async (learnerId: string) => {
    const mark = marks.find((m) => m.learner_id === learnerId);
    if (!mark || mark.draft_score === undefined) return;

    setRowStatus((prev) => ({ ...prev, [learnerId]: "pending" }));

    try {
      const { error: err } = await supabase.from("exam_marks").upsert(
        {
          class_id: classId,
          exam_id: examId,
          subject_id: subjectId,
          learner_id: learnerId,
          score: mark.draft_score,
          committed_at: new Date().toISOString(),
        },
        { onConflict: "class_id,exam_id,subject_id,learner_id" }
      );

      if (err) throw err;

      setMarks((prev) =>
        prev.map((m) =>
          m.learner_id === learnerId
            ? {
                ...m,
                committed_score: mark.draft_score!,
                committed_at: new Date().toISOString(),
                draft_score: undefined,
              }
            : m
        )
      );

      setRowStatus((prev) => {
        const updated = { ...prev };
        delete updated[learnerId];
        return updated;
      });

      if (isOnline) {
        setStatus("✓ Saved");
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      }
    } catch (err) {
      setRowStatus((prev) => ({ ...prev, [learnerId]: "error" }));
      setRowError((prev) => ({
        ...prev,
        [learnerId]: err instanceof Error ? err.message : "Failed to save",
      }));
    }
  };

  const focusNextScoreInput = (learnerId: string) => {
    const learnerIndex = groupedLearnersList.findIndex((l) => l.id === learnerId);
    if (learnerIndex !== -1 && learnerIndex < groupedLearnersList.length - 1) {
      const nextLearnerId = groupedLearnersList[learnerIndex + 1].id;
      inputRefs.current[nextLearnerId]?.focus();
    }
  };

  const saveAll = async () => {
    setLoading(true);
    try {
      const unsavedMarks = marks.filter(
        (m) => m.draft_score !== undefined && m.draft_score !== m.committed_score
      );

      for (const mark of unsavedMarks) {
        await autoSaveRow(mark.learner_id);
      }

      setStatus("All marks saved");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  // Group by COMMITTED score, not draft. This keeps rows stable while typing.
  const groupedLearners = learners.reduce(
    (acc, learner) => {
      const mark = marks.find((m) => m.learner_id === learner.id);
      const committedScore = mark?.committed_score;

      if (committedScore === undefined) {
        acc.needsMark.push(learner);
      } else if (rowStatus[learner.id] === "pending") {
        acc.pendingSync.push(learner);
      } else {
        acc.saved.push(learner);
      }

      return acc;
    },
    { needsMark: [], pendingSync: [], saved: [] } as Record<
      string,
      typeof learners
    >
  );

  const groupedLearnersList = [
    ...groupedLearners.needsMark,
    ...groupedLearners.pendingSync,
    ...groupedLearners.saved,
  ];

  return (
    <div className="p-5 sm:p-10">
      {!currentExam || !activeView ? (
        <div>Exam or subject not found</div>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl sm:text-4xl font-bold mb-1">
              Mark Entry — {activeView.subjectName}
            </h1>
            <p className="text-ink/60 text-sm">
              {currentExam.name} • {learners.length} learner{learners.length !== 1 ? "s" : ""}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-4 rounded-lg bg-maroon/10 border border-maroon/20 text-maroon">
              {error}
            </div>
          )}

          {learners.length === 0 ? (
            <p className="text-ink/60">No learners in this class.</p>
          ) : (
            <>
              <div className="rounded-lg border border-line overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-black/5 border-b border-line">
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
                        Name
                      </th>
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
                        Mark
                      </th>
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
                        %
                      </th>
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
                        Level
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      function renderRow(l: typeof learners[0]) {
                        const mark = marks.find((m) => m.learner_id === l.id);
                        const score = mark?.draft_score ?? mark?.committed_score;
                        const maxMark = currentExam.totalMarks || 100;
                        const pct = score !== undefined ? (score / maxMark) * 100 : null;
                        const level =
                          pct !== null
                            ? pct >= 80
                              ? "Excellent"
                              : pct >= 60
                              ? "Good"
                              : pct >= 40
                              ? "Pass"
                              : "Fail"
                            : null;

                        const isBlank = score === undefined;

                        return (
                          <tr key={l.id} className="border-b border-line hover:bg-black/2 transition">
                            <td className="px-3 sm:px-5 py-3 text-sm font-medium text-ink">
                              {l.name}
                            </td>
                            <td className="px-3 sm:px-5 py-3">
                              <input
                                ref={(el) => {
                                  if (el) inputRefs.current[l.id] = el;
                                }}
                                type="number"
                                min="0"
                                max={maxMark}
                                value={score ?? ""}
                                onChange={(e) => handleScoreChange(l.id, e.target.value)}
                                onKeyDown={(e) => handleScoreKeyDown(e, l.id)}
                                placeholder="—"
                                className="w-16 px-2 py-1.5 text-sm border border-line rounded bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 sm:px-5 py-2">
                              <div className="flex flex-col gap-1">
                                {pct !== null && (
                                  <span className="text-sm font-semibold text-ink">
                                    {Math.round(pct)}%
                                  </span>
                                )}
                                {rowStatus[l.id] === "pending" && (
                                  <span className="text-[10px] text-amber-600">
                                    {isOnline ? "Syncing…" : "⏳ Saved on device — will sync"}
                                  </span>
                                )}
                                {rowStatus[l.id] === "error" && (
                                  <span
                                    className="text-[10px] text-maroon"
                                    title={rowError[l.id]}
                                  >
                                    ⚠ {rowError[l.id] || "Not saved"}
                                  </span>
                                )}
                                {isBlank && !rowStatus[l.id] && (
                                  <span className="text-[10px] text-maroon/70">Not marked</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 sm:px-5 py-2 text-xs text-ink/60">
                              {pct !== null ? `${Math.round(pct)}%` : "—"}
                            </td>
                            <td className="px-3 sm:px-5 py-2">
                              {level ? (
                                <span className={`neu-badge neu-badge-${level.toLowerCase()}`}>
                                  {level}
                                </span>
                              ) : (
                                <span className="text-xs text-ink/40">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      }

                      function divider(label: string, count: number) {
                        return (
                          <tr key={`divider-${label}`} className="bg-black/5">
                            <td
                              colSpan={4}
                              className="px-3 sm:px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50"
                            >
                              {label} ({count})
                            </td>
                          </tr>
                        );
                      }

                      const { needsMark, pendingSync, saved } = groupedLearners;
                      return (
                        <>
                          {needsMark.length > 0 &&
                            divider("Still needs a mark", needsMark.length)}
                          {needsMark.map(renderRow)}
                          {pendingSync.length > 0 &&
                            divider("Pending sync", pendingSync.length)}
                          {pendingSync.map(renderRow)}
                          {saved.length > 0 && divider("Saved", saved.length)}
                          {saved.map(renderRow)}
                        </>
                      );
                    })()}
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
                  {saving
                    ? "Saving…"
                    : justSaved
                    ? "✓ Saved"
                    : `Save ${activeView.subjectName} marks`}
                </button>
                {status && (
                  <span className="text-sm text-success bg-success/10 border border-success/20 rounded-full px-3 py-1">
                    ✓ {status}
                  </span>
                )}
                {groupedLearners.pendingSync.length > 0 && (
                  <span className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                    {isOnline ? "Syncing" : "⏳"} {groupedLearners.pendingSync.length} mark
                    {groupedLearners.pendingSync.length === 1 ? "" : "s"} saved on this device,
                    not yet on the server
                  </span>
                )}
                {error && <span className="text-sm text-maroon">{error}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
