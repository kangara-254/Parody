import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { SchoolClass, Teacher, ClassTeacher } from "../../types";

export default function ClassesPage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classTeachers, setClassTeachers] = useState<ClassTeacher[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null); // which class's "assign teacher" picker is open
  const [pickerTeacherId, setPickerTeacherId] = useState("");

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const [c, t, ct] = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("teachers").select("*").order("name"),
      supabase.from("class_teachers").select("*"),
    ]);
    if (c.error) setError(c.error.message);
    setClasses(c.data || []);
    setTeachers(t.data || []);
    setClassTeachers(ct.data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!supabase || !newName.trim()) return;
    setError("");
    const { error: err } = await supabase.from("classes").insert({ name: newName.trim() });
    if (err) setError(err.message);
    else {
      setNewName("");
      load();
    }
  }

  async function addClassTeacher(classId: string, teacherId: string) {
    if (!supabase || !teacherId) return;
    setError("");
    const { error: err } = await supabase.from("class_teachers").insert({ class_id: classId, teacher_id: teacherId });
    if (err) setError(err.message);
    else {
      setPickerTeacherId("");
      setOpenId(null);
      load();
    }
  }

  async function removeClassTeacher(classId: string, teacherId: string) {
    if (!supabase) return;
    setError("");
    const { error: err } = await supabase
      .from("class_teachers")
      .delete()
      .eq("class_id", classId)
      .eq("teacher_id", teacherId);
    if (err) setError(err.message);
    else load();
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!confirm("Delete this class? Learners in it will need to be reassigned first.")) return;
    const { error: err } = await supabase.from("classes").delete().eq("id", id);
    if (err) setError(err.message);
    else load();
  }

  function teachersFor(classId: string): Teacher[] {
    const ids = new Set(classTeachers.filter((ct) => ct.class_id === classId).map((ct) => ct.teacher_id));
    return teachers.filter((t) => ids.has(t.id));
  }

  function availableTeachersFor(classId: string): Teacher[] {
    const assignedIds = new Set(classTeachers.filter((ct) => ct.class_id === classId).map((ct) => ct.teacher_id));
    // A deactivated ("left") teacher can't be newly assigned as a class
    // teacher -- but if one is already assigned (from before they left),
    // that existing assignment is left alone here so historical reports
    // keep resolving their name; an admin can remove it explicitly via
    // the × button if it should change.
    return teachers.filter((t) => !assignedIds.has(t.id) && t.status === "active");
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Classes</h1>
        <p className="text-sm text-ink/60 mt-1">
          Manage classes and their class teacher(s) — a class can have more than one class teacher.
        </p>
      </header>

      <div className="neu-card p-5 mb-5">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New class, e.g. 9A5"
            className="flex-1 neu-input"
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
        ) : classes.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No classes yet.</div>
        ) : (
          <ul className="divide-y divide-navy/10">
            {classes.map((c) => {
              const assigned = teachersFor(c.id);
              const available = availableTeachersFor(c.id);
              return (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-sm text-ink font-medium">{c.name}</span>
                    <button onClick={() => remove(c.id)} className="text-xs text-maroon hover:opacity-70 shrink-0">
                      Delete class
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-2">
                    {assigned.length === 0 ? (
                      <span className="text-xs text-ink/40">No class teacher assigned yet.</span>
                    ) : (
                      assigned.map((t) => (
                        <span key={t.id} className="neu-badge neu-badge-open">
                          {t.name}
                          <button
                            onClick={() => removeClassTeacher(c.id, t.id)}
                            className="ml-1 opacity-60 hover:opacity-100"
                            aria-label={`Remove ${t.name} as class teacher of ${c.name}`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  {openId === c.id ? (
                    <div className="flex gap-2">
                      <select
                        value={pickerTeacherId}
                        onChange={(e) => setPickerTeacherId(e.target.value)}
                        className="neu-input flex-1 text-sm"
                      >
                        <option value="">Select a teacher to add…</option>
                        {available.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => addClassTeacher(c.id, pickerTeacherId)}
                        disabled={!pickerTeacherId}
                        className="neu-btn-sm disabled:opacity-40"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setOpenId(null);
                          setPickerTeacherId("");
                        }}
                        className="text-xs text-ink/40 hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setOpenId(c.id)} className="text-xs text-maroon font-medium hover:opacity-70">
                      + Add class teacher
                    </button>
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
