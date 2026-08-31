import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fetchHistoricalLearners } from "../../lib/enrollment";
import { AcademicYear, Learner, LEARNER_STATUS_LABELS, SchoolClass } from "../../types";

// Read-only "roster as it was" viewer. learners.class_id only ever
// holds where a learner is RIGHT NOW -- once they're promoted, the
// class they used to be in has no record of them left on the learner
// row itself. The permanent year-by-year record lives in
// `enrollments` (see supabase/schema.sql migration v5), which is what
// fetchHistoricalLearners() reads from. This page exists purely to
// surface that history in a way an admin can browse without needing
// an exam to already exist for that year (Results/Report Forms only
// show it as a side effect of opening a marklist).
//
// Deliberately separate from the Learners page: that page edits the
// LIVE roster, and mixing "pick a past year" into it risks an admin
// thinking they can edit 2026 data while looking at 2028's database
// state. This page never writes anything.
export default function ClassHistoryPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [allLearners, setAllLearners] = useState<Learner[]>([]);
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [roster, setRoster] = useState<Learner[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  async function loadFilters() {
    if (!supabase) return;
    setLoading(true);
    const [y, c, l] = await Promise.all([
      supabase.from("academic_years").select("*").order("year", { ascending: false }),
      supabase.from("classes").select("*").order("name"),
      supabase.from("learners").select("*"),
    ]);
    const yearRows: AcademicYear[] = y.data || [];
    setYears(yearRows);
    setClasses(c.data || []);
    setAllLearners(l.data || []);
    if (!yearId) {
      const current = yearRows.find((yr) => yr.is_current);
      setYearId(current?.id || yearRows[0]?.id || "");
    }
    if (!classId && c.data && c.data.length > 0) {
      setClassId(c.data[0].id);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function run() {
      if (!supabase || !yearId || !classId) {
        setRoster(null);
        return;
      }
      setFetching(true);
      setError("");
      try {
        const data = await fetchHistoricalLearners(supabase, [classId], yearId);
        setRoster(data);
      } catch (e: any) {
        setError(e?.message || "Could not load that roster.");
        setRoster(null);
      }
      setFetching(false);
    }
    run();
  }, [yearId, classId]);

  const selectedYear = years.find((y) => y.id === yearId);
  const selectedClass = classes.find((c) => c.id === classId);
  const isCurrentYear = !!selectedYear?.is_current;

  const currentLearnerById = useMemo(() => {
    const map = new Map<string, Learner>();
    allLearners.forEach((l) => map.set(l.id, l));
    return map;
  }, [allLearners]);

  const className = (id: string) => classes.find((c) => c.id === id)?.name || "—";

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Class History</h1>
        <p className="text-sm text-ink/60 mt-1">
          See exactly who was in a class during a past academic year — even after learners have since been promoted,
          graduated, or moved on. This is a historical record; it can't be edited here.
        </p>
      </header>

      <div className="neu-card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wide text-ink/50 mb-1.5">Academic year</label>
            <select value={yearId} onChange={(e) => setYearId(e.target.value)} className="neu-input w-full" disabled={loading}>
              {years.length === 0 && <option value="">No years yet</option>}
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.year}
                  {y.is_current ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-ink/50 mb-1.5">Class</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="neu-input w-full" disabled={loading}>
              {classes.length === 0 && <option value="">No classes yet</option>}
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selectedYear && selectedClass && (
        <div className="neu-card p-4 mb-5 text-sm text-ink/70">
          Showing <span className="font-medium text-ink">{selectedClass.name}</span> as it was in{" "}
          <span className="font-medium text-ink">{selectedYear.year}</span>
          {isCurrentYear && " — the current year, so this matches the live roster"}.
        </div>
      )}

      {error && <div className="text-sm text-maroon mb-3">{error}</div>}

      <div className="neu-card overflow-hidden">
        {loading || fetching ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : !roster || roster.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">
            No enrollment record found for this class in this year.
          </div>
        ) : (
          <ul className="divide-y divide-navy/10">
            {roster.map((l) => {
              const nowLearner = currentLearnerById.get(l.id);
              const nowClassId = nowLearner?.class_id;
              const nowStatus = nowLearner?.status;
              const movedClass = nowClassId && nowClassId !== classId;
              const notActiveNow = nowStatus && nowStatus !== "active";
              return (
                <li key={l.id} className="flex items-center justify-between px-5 py-3 gap-3">
                  <div>
                    <div className="text-sm text-ink font-medium">{l.name}</div>
                    <div className="text-xs text-ink/50">Adm {l.admission_number}</div>
                  </div>
                  {(movedClass || notActiveNow) && (
                    <div className="text-xs text-ink/40 shrink-0 text-right">
                      {notActiveNow
                        ? `Now ${LEARNER_STATUS_LABELS[nowStatus!].toLowerCase()}`
                        : movedClass
                        ? `Now in ${className(nowClassId!)}`
                        : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
