import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Teacher, SchoolClass, Subject, TeacherAssignment } from "../../types";

async function callEdgeFunction(name: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase is not configured." };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "Your session expired. Please log in again." };
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) return { ok: false, error: result.error || "Something went wrong." };
  return { ok: true };
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<"active" | "left" | "all">("active");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetStatus, setResetStatus] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone_number: "",
    password: "",
    tsc_number: "",
    role: "teacher" as "admin" | "teacher",
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    const [t, c, s, a] = await Promise.all([
      supabase.from("teachers").select("*").order("name"),
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*").order("name"),
      supabase.from("teacher_assignments").select("*"),
    ]);
    if (t.error) setError(t.error.message);
    setTeachers(t.data || []);
    setClasses(c.data || []);
    setSubjects(s.data || []);
    setAssignments(a.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function resetForm() {
    setForm({ name: "", phone_number: "", password: "", tsc_number: "", role: "teacher" });
    setEditingId(null);
  }

  async function save() {
    if (!supabase) return;
    setError("");

    if (editingId) {
      const { error: err } = await supabase
        .from("teachers")
        .update({ name: form.name, role: form.role })
        .eq("id", editingId);
      if (err) return setError(err.message);
      resetForm();
      loadAll();
      return;
    }

    if (!form.name.trim() || !form.phone_number.trim() || !form.password) {
      setError("Name, phone number and password are all required.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSaving(true);
    const result = await callEdgeFunction("create-teacher", {
      name: form.name,
      phone_number: form.phone_number,
      password: form.password,
      tsc_number: form.tsc_number || null,
      role: form.role,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error!);
      return;
    }
    resetForm();
    loadAll();
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (
      !confirm(
        "Permanently delete this teacher? This can't be undone: their assignments will be removed and any marks " +
          "they entered will lose the record of who entered them. Their phone number becomes free to reuse. Only " +
          "do this for a genuine cleanup -- for a teacher who has simply left, Deactivate instead."
      )
    )
      return;
    setError("");
    setDeletingId(id);
    // Goes through delete-teacher, not a raw table delete: it removes
    // the Auth login too, not just the public.teachers row, so the
    // phone number is truly free again (see delete-teacher/index.ts).
    // The function itself requires the teacher to already be
    // deactivated, so this is only reachable from the "left" tab.
    const result = await callEdgeFunction("delete-teacher", { teacher_id: id });
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error!);
      return;
    }
    loadAll();
  }

  // A teacher who has left: ban their login, keep everything else (see
  // supabase/functions/deactivate-teacher). This is the everyday
  // "teacher left the school" action, not a raw delete.
  async function deactivate(id: string) {
    if (!supabase) return;
    if (
      !confirm(
        "Deactivate this teacher? They'll lose access to the portal immediately, but their assignments and marks " +
          "history stay intact so past reports keep printing correctly. You can reactivate them later, or delete " +
          "them permanently from the Left tab if needed."
      )
    )
      return;
    setError("");
    setDeletingId(id);
    const result = await callEdgeFunction("deactivate-teacher", { teacher_id: id });
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error!);
      return;
    }
    loadAll();
  }

  async function reactivate(id: string) {
    if (!supabase) return;
    setError("");
    setDeletingId(id);
    const result = await callEdgeFunction("reactivate-teacher", { teacher_id: id });
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error!);
      return;
    }
    loadAll();
  }

  // Exactly one teacher is "the" head teacher at a time -- their name and
  // signature line print on every report form (see exportReportDocx.ts).
  // Unset whoever currently holds it before setting the new one so there
  // is never more than one.
  async function setHeadTeacher(teacherId: string) {
    if (!supabase) return;
    setError("");
    const current = teachers.find((t) => t.is_head_teacher);
    if (current && current.id !== teacherId) {
      const { error: err } = await supabase.from("teachers").update({ is_head_teacher: false }).eq("id", current.id);
      if (err) return setError(err.message);
    }
    const { error: err } = await supabase.from("teachers").update({ is_head_teacher: true }).eq("id", teacherId);
    if (err) return setError(err.message);
    loadAll();
  }

  async function submitReset(teacherId: string) {
    if (resetPassword.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }
    setResetSaving(true);
    setResetError("");
    const result = await callEdgeFunction("reset-teacher-password", { teacher_id: teacherId, password: resetPassword });
    setResetSaving(false);
    if (!result.ok) {
      setResetError(result.error!);
      return;
    }
    setResetStatus("Password reset. Share the new password with this teacher directly.");
    setResetPassword("");
  }

  async function toggleAssignment(teacherId: string, classId: string, subjectId: string) {
    if (!supabase) return;
    const existing = assignments.find(
      (a) => a.teacher_id === teacherId && a.class_id === classId && a.subject_id === subjectId
    );
    if (existing) {
      await supabase.from("teacher_assignments").delete().eq("id", existing.id);
    } else {
      await supabase.from("teacher_assignments").insert({ teacher_id: teacherId, class_id: classId, subject_id: subjectId });
    }
    loadAll();
  }

  const visibleTeachers = statusTab === "all" ? teachers : teachers.filter((t) => t.status === statusTab);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">Teachers</h1>
        <p className="text-sm text-ink/60 mt-1">Manage staff accounts and assign classes and subjects.</p>
      </header>

      <div className="glass-card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="glass-input"
          />
          <input
            placeholder="Phone number"
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
            disabled={!!editingId}
            className="glass-input disabled:opacity-50"
          />
          {!editingId && (
            <input
              placeholder="Password (min 6 characters)"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="glass-input"
            />
          )}
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "teacher" })}
            className="glass-input"
          >
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
          {!editingId && (
            <input
              placeholder="TSC number (optional, for records)"
              value={form.tsc_number}
              onChange={(e) => setForm({ ...form, tsc_number: e.target.value })}
              className="glass-input"
            />
          )}
        </div>
        {editingId && (
          <p className="text-xs text-ink/40 mt-2">
            Phone number can't be changed here — it's tied to a real login account. Use "Reset password" below if
            they've forgotten it, or delete and re-add them if the phone number itself needs to change.
          </p>
        )}
        {!editingId && (
          <p className="text-xs text-ink/40 mt-2">
            Teachers can't change their own password — set it here and share it with them directly. You can reset it
            later from their entry below if they forget it.
          </p>
        )}
        <div className="flex gap-2 mt-3">
          <button onClick={save} disabled={saving} className="glass-btn disabled:opacity-50">
            {saving ? "Saving…" : editingId ? "Save changes" : "Add teacher"}
          </button>
          {editingId && (
            <button onClick={resetForm} className="text-sm text-ink/50 px-2">
              Cancel
            </button>
          )}
        </div>
        {error && <div className="text-sm text-maroon mt-2">{error}</div>}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 pt-4">
          {(["active", "left", "all"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={statusTab === tab ? "tab-btn tab-btn-active" : "tab-btn"}
            >
              {tab === "active" ? "Active" : tab === "left" ? "Left" : "All"}
              {tab !== "all" && ` (${teachers.filter((t) => t.status === tab).length})`}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : visibleTeachers.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No teachers here yet.</div>
        ) : (
          <ul className="divide-y divide-line mt-3">
            {visibleTeachers.map((t) => {
              const teacherAssignments = assignments.filter((a) => a.teacher_id === t.id);
              return (
                <li key={t.id} className="px-4 sm:px-5 py-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-ink font-medium truncate">
                        {t.name} <span className="text-xs text-ink/40 capitalize">· {t.role}</span>
                        {t.is_head_teacher && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-maroon/10 text-maroon font-medium align-middle">
                            ★ Head Teacher
                          </span>
                        )}
                        {t.status === "left" && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-ink/10 text-ink/60 font-medium align-middle">
                            Left
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink/50">
                        Phone {t.phone_number}
                        {t.tsc_number ? ` · TSC ${t.tsc_number}` : ""} · {teacherAssignments.length} assignment(s)
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 sm:gap-3 shrink-0">
                      {!t.is_head_teacher && t.status === "active" && (
                        <button onClick={() => setHeadTeacher(t.id)} className="text-xs text-ink/50 hover:text-ink py-1.5">
                          Set as Head Teacher
                        </button>
                      )}
                      <button
                        onClick={() => setOpenId(openId === t.id ? null : t.id)}
                        className="text-xs text-maroon font-medium py-1.5"
                      >
                        {openId === t.id ? "Hide assignments" : "Assign classes"}
                      </button>
                      {t.is_bootstrap_admin ? (
                        <button
                          type="button"
                          disabled
                          title="The original bootstrap administrator's password can't be reset from here."
                          className="text-xs text-ink/25 cursor-not-allowed py-1.5"
                        >
                          Reset password
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setResetId(resetId === t.id ? null : t.id);
                            setResetPassword("");
                            setResetError("");
                            setResetStatus("");
                          }}
                          className="text-xs text-ink/50 hover:text-ink py-1.5"
                        >
                          {resetId === t.id ? "Cancel reset" : "Reset password"}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(t.id);
                          setForm({
                            name: t.name,
                            phone_number: t.phone_number,
                            password: "",
                            tsc_number: t.tsc_number ?? "",
                            role: t.role,
                          });
                        }}
                        className="text-xs text-ink/50 hover:text-ink py-1.5"
                      >
                        Edit
                      </button>
                      {t.is_bootstrap_admin ? (
                        <button
                          type="button"
                          disabled
                          title="The original bootstrap administrator is protected from deactivation."
                          className="text-xs text-ink/25 cursor-not-allowed py-1.5"
                        >
                          Deactivate
                        </button>
                      ) : t.status === "active" ? (
                        <button
                          onClick={() => deactivate(t.id)}
                          disabled={deletingId === t.id}
                          className="text-xs text-maroon hover:opacity-70 disabled:opacity-50 py-1.5"
                        >
                          {deletingId === t.id ? "Deactivating…" : "Deactivate"}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => reactivate(t.id)}
                            disabled={deletingId === t.id}
                            className="text-xs text-navy hover:opacity-70 disabled:opacity-50 py-1.5"
                          >
                            {deletingId === t.id ? "Reactivating…" : "Reactivate"}
                          </button>
                          <button
                            onClick={() => remove(t.id)}
                            disabled={deletingId === t.id}
                            className="text-xs text-maroon/70 hover:opacity-70 disabled:opacity-50 py-1.5"
                          >
                            {deletingId === t.id ? "Deleting…" : "Delete permanently"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {resetId === t.id && (
                    <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
                      <input
                        placeholder="New password (min 6 characters)"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        className="glass-input w-full sm:w-56"
                      />
                      <button
                        onClick={() => submitReset(t.id)}
                        disabled={resetSaving}
                        className="glass-btn-sm disabled:opacity-40"
                      >
                        {resetSaving ? "Saving…" : "Set new password"}
                      </button>
                      {resetStatus && <span className="text-xs text-maroon">{resetStatus}</span>}
                      {resetError && <span className="text-xs text-maroon">{resetError}</span>}
                    </div>
                  )}

                  {openId === t.id && (
                    <div className="mt-3 pt-3 border-t border-line">
                      <p className="text-xs text-ink/40 mb-2">
                        {t.status === "left"
                          ? "This teacher has left -- you can remove existing assignments below, but new ones can't be added until they're reactivated."
                          : "Click a class + subject to toggle assignment."}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                        {classes.map((cls) => (
                          <div key={cls.id} className="glass-card p-3">
                            <div className="text-xs font-medium text-ink mb-2">{cls.name}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {subjects.map((subj) => {
                                const isAssigned = assignments.some(
                                  (a) => a.teacher_id === t.id && a.class_id === cls.id && a.subject_id === subj.id
                                );
                                const disabled = t.status === "left" && !isAssigned;
                                return (
                                  <button
                                    key={subj.id}
                                    onClick={() => toggleAssignment(t.id, cls.id, subj.id)}
                                    disabled={disabled}
                                    className={`text-[11px] px-2 py-1 rounded border transition disabled:opacity-30 disabled:cursor-not-allowed ${
                                      isAssigned
                                        ? "bg-maroon/20 border-maroon/40 text-maroon"
                                        : "bg-black/5 border-black/10 text-ink/50 hover:text-ink hover:bg-black/10"
                                    }`}
                                  >
                                    {subj.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
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
