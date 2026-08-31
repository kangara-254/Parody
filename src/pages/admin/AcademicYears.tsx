import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AcademicYear } from "../../types";

// Replaces the old generic SimpleCrud("academic_years") usage. Adds the
// one thing that mattered but was missing: which year is CURRENT.
// Promotion (see Promote.tsx) and every new learner enrollment are
// always recorded against whichever year is marked current here -- so
// at year rollover, create the new year and mark it current FIRST,
// before running any promotions.
export default function AcademicYearsPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [newYear, setNewYear] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const { data, error: err } = await supabase.from("academic_years").select("*").order("year");
    if (err) setError(err.message);
    else setYears(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!supabase || !newYear.trim()) return;
    setError("");
    const { error: err } = await supabase.from("academic_years").insert({ year: Number(newYear) });
    if (err) setError(err.message);
    else {
      setNewYear("");
      load();
    }
  }

  async function setCurrent(id: string) {
    if (!supabase) return;
    setError("");
    // Unset the previous current year first, same pattern as
    // is_head_teacher in Teachers.tsx -- the DB's partial unique index
    // on is_current would reject two rows being true at once anyway,
    // so this order (unset-then-set) avoids that race.
    const prev = years.find((y) => y.is_current);
    if (prev && prev.id !== id) {
      const { error: err1 } = await supabase.from("academic_years").update({ is_current: false }).eq("id", prev.id);
      if (err1) return setError(err1.message);
    }
    const { error: err2 } = await supabase.from("academic_years").update({ is_current: true }).eq("id", id);
    if (err2) setError(err2.message);
    else load();
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!confirm("Delete this academic year? This cannot be undone.")) return;
    setError("");
    const { error: err } = await supabase.from("academic_years").delete().eq("id", id);
    if (err) setError(err.message);
    else load();
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Academic Years</h1>
        <p className="text-sm text-ink/60 mt-1">
          Mark the current year before promoting classes at year rollover — promotions and new enrollments are always
          recorded against whichever year is current.
        </p>
      </header>

      <div className="neu-card p-5 mb-5">
        <div className="flex gap-2">
          <input
            type="number"
            value={newYear}
            onChange={(e) => setNewYear(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="e.g. 2027"
            className="flex-1 neu-input focus:outline-none focus:ring-2 focus:ring-navy/40"
          />
          <button onClick={add} className="neu-btn">
            Add
          </button>
        </div>
        {error && <div className="text-sm text-maroon mt-2">{error}</div>}
      </div>

      <div className="neu-card overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : years.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No academic years yet. Add one above.</div>
        ) : (
          <ul className="divide-y divide-line">
            {years.map((y) => (
              <li key={y.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink">{y.year}</span>
                  {y.is_current && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-navy/10 text-navy font-medium">Current</span>
                  )}
                </div>
                <div className="flex gap-3 shrink-0">
                  {!y.is_current && (
                    <button onClick={() => setCurrent(y.id)} className="text-xs text-navy font-medium hover:opacity-70">
                      Set as current
                    </button>
                  )}
                  <button onClick={() => remove(y.id)} className="text-xs text-maroon hover:opacity-70">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
