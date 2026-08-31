import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AcademicYear, Learner, SchoolClass } from "../../types";

// Bulk year-rollover tool. Replaces editing every learner's class_id
// one at a time: pick where each class should go (another class, or
// "Graduating"), then apply. Calls the DB functions promote_class() /
// graduate_class() (see schema.sql migration v5), which only ever
// touch status='active' learners and record the move in `enrollments`
// against whichever academic year is currently marked current -- so
// this page insists a current year is set before it lets you apply
// anything.
const GRADUATE = "__graduate__";

export default function PromotePage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({}); // class_id -> class_id | GRADUATE
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string>("");
  const [applying, setApplying] = useState(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const [c, l, y] = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("learners").select("*").eq("status", "active"),
      supabase.from("academic_years").select("*").order("year"),
    ]);
    if (c.error) setError(c.error.message);
    setClasses(c.data || []);
    setLearners(l.data || []);
    setYears(y.data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const currentYear = years.find((y) => y.is_current);
  const activeCountFor = (classId: string) => learners.filter((l) => l.class_id === classId).length;

  const pairs = useMemo(
    () =>
      Object.entries(targets).filter(([, to]) => to) as [string, string][],
    [targets]
  );

  async function apply() {
    if (!supabase) return;
    setError("");
    setResult("");
    if (!currentYear) {
      setError("Mark an academic year as current on the Academic Years page before promoting.");
      return;
    }
    if (pairs.length === 0) {
      setError("Choose where at least one class should go.");
      return;
    }
    setApplying(true);
    const summary: string[] = [];
    for (const [fromId, to] of pairs) {
      const fromName = classes.find((c) => c.id === fromId)?.name || fromId;
      if (to === GRADUATE) {
        const { data, error: err } = await supabase.rpc("graduate_class", { p_class_id: fromId });
        if (err) {
          setError(err.message);
          setApplying(false);
          return;
        }
        summary.push(`${fromName}: ${data} learner(s) marked graduated`);
      } else {
        const toName = classes.find((c) => c.id === to)?.name || to;
        const { data, error: err } = await supabase.rpc("promote_class", { p_from_class_id: fromId, p_to_class_id: to });
        if (err) {
          setError(err.message);
          setApplying(false);
          return;
        }
        summary.push(`${fromName} → ${toName}: ${data} learner(s) moved`);
      }
    }
    setResult(summary.join("\n"));
    setTargets({});
    setApplying(false);
    load();
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Promote Classes</h1>
        <p className="text-sm text-ink/60 mt-1">
          Move every active learner in a class up to the next class at once, or graduate a whole class out of the
          school. This never touches already-archived learners.
        </p>
      </header>

      {!currentYear && !loading && (
        <div className="neu-card p-4 mb-5 text-sm text-maroon">
          No academic year is marked current. Go to Academic Years and set the new year as current before promoting —
          otherwise there's no year to record this move against.
        </div>
      )}
      {currentYear && (
        <div className="neu-card p-4 mb-5 text-sm text-ink/70">
          Promoting into academic year <span className="font-medium text-ink">{currentYear.year}</span>.
        </div>
      )}

      <div className="neu-card overflow-hidden mb-5">
        {loading ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : classes.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No classes yet.</div>
        ) : (
          <ul className="divide-y divide-navy/10">
            {classes.map((c) => {
              const count = activeCountFor(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <div className="text-sm text-ink font-medium">{c.name}</div>
                    <div className="text-xs text-ink/50">{count} active learner{count === 1 ? "" : "s"}</div>
                  </div>
                  <select
                    value={targets[c.id] || ""}
                    onChange={(e) => setTargets((t) => ({ ...t, [c.id]: e.target.value }))}
                    className="neu-input text-sm w-48"
                    disabled={count === 0}
                  >
                    <option value="">No change</option>
                    {classes
                      .filter((other) => other.id !== c.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          Promote to {other.name}
                        </option>
                      ))}
                    <option value={GRADUATE}>Graduate (leaving school)</option>
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <div className="text-sm text-maroon mb-3 whitespace-pre-line">{error}</div>}
      {result && <div className="neu-card p-4 mb-5 text-sm text-ink/70 whitespace-pre-line">{result}</div>}

      <button onClick={apply} disabled={applying || pairs.length === 0} className="neu-btn disabled:opacity-40">
        {applying ? "Applying…" : `Apply ${pairs.length ? `(${pairs.length} class${pairs.length === 1 ? "" : "es"})` : ""}`}
      </button>
    </div>
  );
}
