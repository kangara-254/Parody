import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Exam, AcademicYear, SchoolClass, TermCalendar } from "../../types";
import DateField from "../../components/DateField";

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [termDates, setTermDates] = useState<TermCalendar[]>([]);
  const [termDateForm, setTermDateForm] = useState({ term: 1, term_ends_on: "", next_term_begins_on: "" });

  const [form, setForm] = useState({ name: "", term: 1, academic_year_id: "" });

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    const [e, y, c, td] = await Promise.all([
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
      supabase.from("academic_years").select("*").order("year", { ascending: false }),
      supabase.from("classes").select("*").order("name"),
      supabase.from("term_calendar").select("*"),
    ]);
    if (e.error) setError(e.error.message);
    setExams(e.data || []);
    setYears(y.data || []);
    setClasses(c.data || []);
    setTermDates(td.data || []);
    if (!form.academic_year_id && y.data && y.data.length) setForm((f) => ({ ...f, academic_year_id: y.data![0].id }));
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const saved = termDates.find((x) => x.academic_year_id === form.academic_year_id && x.term === termDateForm.term);
    setTermDateForm((f) => ({
      ...f,
      term_ends_on: saved?.term_ends_on ?? "",
      next_term_begins_on: saved?.next_term_begins_on ?? "",
    }));
  }, [form.academic_year_id, termDateForm.term, termDates]);

  async function saveTermDates() {
    if (!supabase) return;
    setError("");
    if (!form.academic_year_id || !termDateForm.term_ends_on || !termDateForm.next_term_begins_on) {
      setError("Academic year, term end date and next term start date are required.");
      return;
    }
    if (termDateForm.next_term_begins_on < termDateForm.term_ends_on) {
      setError("Next term cannot begin before the current term ends.");
      return;
    }
    const { error: err } = await supabase.from("term_calendar").upsert({
      academic_year_id: form.academic_year_id,
      term: termDateForm.term,
      term_ends_on: termDateForm.term_ends_on,
      next_term_begins_on: termDateForm.next_term_begins_on,
      updated_at: new Date().toISOString(),
    }, { onConflict: "academic_year_id,term" });
    if (err) return setError(err.message);
    loadAll();
  }

  // Creating an exam automatically seats every existing class on it --
  // there is no separate "assign classes" step any more. (Only one exam
  // is meant to be open school-wide at a time; that rule is enforced
  // elsewhere and only affects locking, not this assignment.)
  async function createExam() {
    if (!supabase) return;
    setError("");
    if (!form.name.trim() || !form.academic_year_id) {
      setError("Assessment name and academic year are required.");
      return;
    }
    const { data: inserted, error: err } = await supabase.from("exams").insert(form).select().single();
    if (err) return setError(err.message);
    if (inserted && classes.length) {
      const { error: assignErr } = await supabase
        .from("exam_classes")
        .insert(classes.map((c) => ({ exam_id: inserted.id, class_id: c.id })));
      if (assignErr) setError(assignErr.message);
    }
    setForm({ ...form, name: "" });
    loadAll();
  }

  async function toggleLock(exam: Exam) {
    if (!supabase) return;
    // Only one exam is ever open school-wide (the DB enforces this too --
    // see exams_single_open in schema.sql) -- so opening this one will
    // silently close whichever exam is currently open, if any. Confirm
    // that here rather than let it happen invisibly, since the admin
    // opening THIS exam may not be the same admin who opened the other one.
    if (exam.locked) {
      const currentlyOpen = exams.find((e) => !e.locked && e.id !== exam.id);
      if (
        currentlyOpen &&
        !confirm(`"${currentlyOpen.name}" is currently open. Opening "${exam.name}" will close it. Continue?`)
      ) {
        return;
      }
    }
    const { error: err } = await supabase.from("exams").update({ locked: !exam.locked }).eq("id", exam.id);
    if (err) setError(err.message);
    else loadAll();
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!confirm("Delete this assessment? All marks recorded for it will also be deleted.")) return;
    const { error: err } = await supabase.from("exams").delete().eq("id", id);
    if (err) setError(err.message);
    else loadAll();
  }

  const yearLabel = (id: string) => years.find((y) => y.id === id)?.year ?? "—";
  const formatDate = (value: string | undefined) =>
    value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "Not set";
  const termDatesFor = (ex: Exam) => termDates.find((x) => x.academic_year_id === ex.academic_year_id && x.term === ex.term);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Assessments</h1>
        <p className="text-sm text-ink/60 mt-1">
          Create assessments (every class is seated automatically). Only one can be open for marks entry at a time —
          opening one closes whichever was open before it. New assessments start closed.
        </p>
      </header>

      {years.length === 0 && (
        <div className="text-sm text-maroon bg-maroon/10 border border-maroon/20 rounded-lg px-3 py-2 mb-4">
          Add an academic year first (Academic Years page) before creating an assessment.
        </div>
      )}

      <div className="neu-card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            placeholder="Assessment name, e.g. Mid Term"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="neu-input"
          />
          <select
            value={form.term}
            onChange={(e) => setForm({ ...form, term: Number(e.target.value) })}
            className="neu-input"
          >
            <option value={1}>Term 1</option>
            <option value={2}>Term 2</option>
            <option value={3}>Term 3</option>
          </select>
          <select
            value={form.academic_year_id}
            onChange={(e) => setForm({ ...form, academic_year_id: e.target.value })}
            className="neu-input"
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.year}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={createExam}
          disabled={years.length === 0}
          className="mt-3 neu-btn disabled:opacity-40"
        >
          Create assessment
        </button>
        <p className="text-xs text-ink/40 mt-2">All {classes.length} class(es) will automatically sit this assessment.</p>
        {error && <div className="text-sm text-maroon mt-2">{error}</div>}
      </div>

      <div className="neu-card p-5 mb-5">
        <h2 className="text-sm font-medium text-ink mb-1">Term dates</h2>
        <p className="text-xs text-ink/50 mb-3">
          These dates appear on report forms. Only admins can set them. Enter dates as <strong>dd/mm/yyyy</strong>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <select
              value={termDateForm.term}
              onChange={(e) => setTermDateForm({ ...termDateForm, term: Number(e.target.value) as 1 | 2 | 3 })}
              className="neu-input w-full"
            >
              <option value={1}>Term 1</option>
              <option value={2}>Term 2</option>
              <option value={3}>Term 3</option>
            </select>
            <div className="text-[11px] text-ink/40 mt-1">Which term these dates belong to</div>
          </div>
          <div>
            <DateField
              value={termDateForm.term_ends_on}
              onChange={(iso) => setTermDateForm({ ...termDateForm, term_ends_on: iso })}
              label="Term ends (dd/mm/yyyy)"
              className="neu-input w-full"
            />
            <div className="text-[11px] text-ink/40 mt-1">The date this term ends / closes</div>
          </div>
          <div>
            <DateField
              value={termDateForm.next_term_begins_on}
              onChange={(iso) => setTermDateForm({ ...termDateForm, next_term_begins_on: iso })}
              label="Next term begins (dd/mm/yyyy)"
              className="neu-input w-full"
            />
            <div className="text-[11px] text-ink/40 mt-1">The date the following term opens</div>
          </div>
        </div>
        <div className="text-xs text-ink/50 mt-2">Selected year: {form.academic_year_id ? yearLabel(form.academic_year_id) : "—"} · Current saved: {termDates.find((x) => x.academic_year_id === form.academic_year_id && x.term === termDateForm.term) ? "Set" : "Not set"}</div>
        <button onClick={saveTermDates} disabled={!form.academic_year_id} className="mt-3 neu-btn disabled:opacity-40">Save term dates</button>
      </div>

      <div className="neu-card overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : exams.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No assessments yet.</div>
        ) : (
          <ul className="divide-y divide-line">
            {exams.map((ex) => {
              const td = termDatesFor(ex);
              return (
                <li key={ex.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-ink font-medium">
                        {ex.name}{" "}
                        {/* Only "open" gets a badge -- a closed exam simply has no badge at all,
                            since the absence of the green pill already communicates that. */}
                        {!ex.locked && (
                          <span className="text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full ml-1">
                            Open
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink/50">
                        Term {ex.term} · {yearLabel(ex.academic_year_id)} ·{" "}
                        {td ? `${formatDate(td.term_ends_on)} → ${formatDate(td.next_term_begins_on)}` : "Term dates not set"}
                      </div>
                    </div>
                    <div className="flex gap-3 shrink-0">
                      <button onClick={() => toggleLock(ex)} className="text-xs text-ink/50 hover:text-ink">
                        {ex.locked ? "Open" : "Close"}
                      </button>
                      <button onClick={() => remove(ex.id)} className="text-xs text-maroon hover:opacity-70">
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
