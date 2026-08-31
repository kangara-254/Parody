import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Learner, LearnerStatus, LEARNER_STATUS_LABELS, SchoolClass } from "../../types";

// If restrictToClassId is set (class teacher use), the class picker is
// hidden and every learner added/shown is locked to that one class.
export default function LearnersPage({ restrictToClassId }: { restrictToClassId?: string }) {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [filterClass, setFilterClass] = useState(restrictToClassId || "");
  // Active is the default view everywhere -- graduated/transferred/
  // withdrawn learners are archived, not deleted, so they still exist
  // but shouldn't clutter the everyday roster view. See schema.sql
  // migration v5.
  const [statusTab, setStatusTab] = useState<LearnerStatus | "all">("active");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", admission_number: "", class_id: restrictToClassId || "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    const [l, c] = await Promise.all([
      supabase.from("learners").select("*").order("name"),
      supabase.from("classes").select("*").order("name"),
    ]);
    if (l.error) setError(l.error.message);
    setLearners(l.data || []);
    setClasses(c.data || []);
    if (!form.class_id) {
      const defaultClass = restrictToClassId || c.data?.[0]?.id || "";
      setForm((f) => ({ ...f, class_id: defaultClass }));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function resetForm() {
    setForm({ name: "", admission_number: "", class_id: restrictToClassId || classes[0]?.id || "" });
    setEditingId(null);
  }

  async function save() {
    if (!supabase) return;
    setError("");
    if (!form.name.trim() || !form.admission_number.trim() || !form.class_id) {
      setError("Name, admission number and class are all required.");
      return;
    }
    if (!/^\d+$/.test(form.admission_number.trim())) {
      setError("Admission number must be a number (digits only).");
      return;
    }
    if (editingId) {
      const { error: err } = await supabase.from("learners").update(form).eq("id", editingId);
      if (err) return setError(err.message);
    } else {
      const { error: err } = await supabase.from("learners").insert(form);
      if (err) return setError(err.message);
    }
    resetForm();
    loadAll();
  }

  // Soft delete: a learner who has left is archived (status changed),
  // never hard-deleted, so their marks and past report cards stay
  // intact. See supabase/schema.sql migration v5.
  async function archive(id: string, status: LearnerStatus) {
    if (!supabase) return;
    setError("");
    const { error: err } = await supabase.from("learners").update({ status }).eq("id", id);
    if (err) setError(err.message);
    else {
      setArchivingId(null);
      loadAll();
    }
  }

  async function restore(id: string) {
    if (!supabase) return;
    setError("");
    const { error: err } = await supabase.from("learners").update({ status: "active" }).eq("id", id);
    if (err) setError(err.message);
    else loadAll();
  }

  // Real, permanent delete. Only offered for learners already archived
  // (not currently active) -- this is a genuine data-entry cleanup
  // action, not the everyday "this learner left" workflow, and it
  // really does remove their marks history for good.
  async function destroyPermanently(id: string) {
    if (!supabase) return;
    if (
      !confirm(
        "Permanently delete this learner? This cannot be undone and will also permanently remove all of their marks history. If they simply left the school, use Archive instead."
      )
    )
      return;
    const { error: err } = await supabase.from("learners").delete().eq("id", id);
    if (err) setError(err.message);
    else loadAll();
  }

  const byClass = restrictToClassId
    ? learners.filter((l) => l.class_id === restrictToClassId)
    : filterClass
    ? learners.filter((l) => l.class_id === filterClass)
    : learners;
  const visible = statusTab === "all" ? byClass : byClass.filter((l) => l.status === statusTab);
  const className = (id: string) => classes.find((c) => c.id === id)?.name || "—";

  // Grade is read straight off the class name -- classes here are
  // always named starting with their grade digit (e.g. "9A1", "7C2"),
  // there's no separate numeric grade column. Only used to gate the
  // Graduated tab/option below.
  const restrictedClassName = restrictToClassId ? classes.find((c) => c.id === restrictToClassId)?.name : undefined;
  const isGrade9 = !!restrictedClassName?.trim().startsWith("9");

  // The teacher-facing "My Class" view (restrictToClassId set) only
  // needs the statuses relevant to day-to-day class management --
  // Withdrawn and the catch-all All are admin-only concerns, and
  // Graduated only ever applies to a grade 9 class (see isGrade9
  // above). The full admin Learners page keeps every tab.
  const statusTabs: { key: LearnerStatus | "all"; label: string }[] = restrictToClassId
    ? [
        { key: "active", label: "Active" },
        ...(isGrade9 ? [{ key: "graduated" as const, label: "Graduated" }] : []),
        { key: "transferred", label: "Transferred" },
      ]
    : [
        { key: "active", label: "Active" },
        { key: "graduated", label: "Graduated" },
        { key: "transferred", label: "Transferred" },
        { key: "withdrawn", label: "Withdrawn" },
        { key: "all", label: "All" },
      ];

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">
          {restrictToClassId ? `Learners — ${className(restrictToClassId)}` : "Learners"}
        </h1>
        <p className="text-sm text-ink/60 mt-1">
          {restrictToClassId ? "Add and manage learners in your class." : "Manage the learner roster."}
        </p>
      </header>

      <div className="neu-card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="neu-input"
          />
          <input
            placeholder="Admission number"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.admission_number}
            onChange={(e) => setForm({ ...form, admission_number: e.target.value.replace(/\D/g, "") })}
            className="neu-input"
          />
          {restrictToClassId ? (
            <div className="neu-input flex items-center text-ink/60">{className(restrictToClassId)}</div>
          ) : (
            <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} className="neu-input">
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={save} className="neu-btn">
            {editingId ? "Save changes" : "Add learner"}
          </button>
          {editingId && (
            <button onClick={resetForm} className="text-sm text-ink/50 px-2">
              Cancel
            </button>
          )}
        </div>
        {error && <div className="text-sm text-maroon mt-2">{error}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {statusTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusTab(t.key)}
            className={statusTab === t.key ? "tab-btn tab-btn-active" : "tab-btn"}
          >
            {t.label}
            {t.key !== "all" && ` (${byClass.filter((l) => l.status === t.key).length})`}
          </button>
        ))}
        {!restrictToClassId && (
          <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="neu-input ml-auto">
            <option value="">All classes ({learners.length})</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="neu-card overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No learners here yet.</div>
        ) : (
          <ul className="divide-y divide-navy/10">
            {visible.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-5 py-3 gap-3">
                <div>
                  <div className="text-sm text-ink font-medium">{l.name}</div>
                  <div className="text-xs text-ink/50">
                    Adm {l.admission_number} · {className(l.class_id)}
                    {l.status !== "active" && <> · {LEARNER_STATUS_LABELS[l.status]}</>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {l.status === "active" ? (
                    archivingId === l.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          className="neu-input text-xs py-1"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) archive(l.id, e.target.value as LearnerStatus);
                          }}
                        >
                          <option value="" disabled>
                            Mark as…
                          </option>
                          {/* Kept in sync with the statusTabs list above --
                              a class teacher shouldn't be offered an
                              archive status they have no tab to see
                              again afterwards. */}
                          {(!restrictToClassId || isGrade9) && <option value="graduated">Graduated</option>}
                          <option value="transferred">Transferred</option>
                          {!restrictToClassId && <option value="withdrawn">Withdrawn</option>}
                        </select>
                        <button onClick={() => setArchivingId(null)} className="text-xs text-ink/40">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(l.id);
                            setForm({ name: l.name, admission_number: l.admission_number, class_id: l.class_id });
                          }}
                          className="text-xs text-ink/50 hover:text-ink"
                        >
                          Edit
                        </button>
                        <button onClick={() => setArchivingId(l.id)} className="text-xs text-maroon hover:opacity-70">
                          Archive
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <button onClick={() => restore(l.id)} className="text-xs text-navy hover:opacity-70">
                        Restore
                      </button>
                      <button onClick={() => destroyPermanently(l.id)} className="text-xs text-maroon/70 hover:opacity-70">
                        Delete permanently
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
