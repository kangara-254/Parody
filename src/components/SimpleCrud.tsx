import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  title: string;
  table: string;
  fieldLabel: string;
  fieldKey: string; // db column, e.g. "name" or "year"
  fieldType?: "text" | "number";
  helperText?: string;
}

export default function SimpleCrud({ title, table, fieldLabel, fieldKey, fieldType = "text", helperText }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const { data, error: err } = await supabase.from(table).select("*").order(fieldKey);
    if (err) setError(err.message);
    else setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [table]);

  async function add() {
    if (!supabase || !newValue.trim()) return;
    setError("");
    const payload: any = { [fieldKey]: fieldType === "number" ? Number(newValue) : newValue.trim() };
    const { error: err } = await supabase.from(table).insert(payload);
    if (err) setError(err.message);
    else {
      setNewValue("");
      load();
    }
  }

  async function saveEdit(id: string) {
    if (!supabase) return;
    setError("");
    const payload: any = { [fieldKey]: fieldType === "number" ? Number(editingValue) : editingValue.trim() };
    const { error: err } = await supabase.from(table).update(payload).eq("id", id);
    if (err) setError(err.message);
    else {
      setEditingId(null);
      load();
    }
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!confirm(`Delete this ${fieldLabel.toLowerCase()}? This cannot be undone.`)) return;
    setError("");
    const { error: err } = await supabase.from(table).delete().eq("id", id);
    if (err) setError(err.message);
    else load();
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">{title}</h1>
        {helperText && <p className="text-sm text-ink/60 mt-1">{helperText}</p>}
      </header>

      <div className="neu-card p-5 mb-5">
        <div className="flex gap-2">
          <input
            type={fieldType === "number" ? "number" : "text"}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={`New ${fieldLabel.toLowerCase()}`}
            className="flex-1 neu-input focus:outline-none focus:ring-2 focus:ring-navy/40"
          />
          <button
            onClick={add}
            className="neu-btn"
          >
            Add
          </button>
        </div>
        {error && <div className="text-sm text-maroon mt-2">{error}</div>}
      </div>

      <div className="neu-card overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-ink/50">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-ink/50">No {fieldLabel.toLowerCase()}s yet. Add one above.</div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3">
                {editingId === r.id ? (
                  <input
                    autoFocus
                    type={fieldType === "number" ? "number" : "text"}
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(r.id)}
                    className="flex-1 neu-input text-sm mr-3"
                  />
                ) : (
                  <span className="text-sm text-ink">{r[fieldKey]}</span>
                )}
                <div className="flex gap-2 shrink-0">
                  {editingId === r.id ? (
                    <>
                      <button onClick={() => saveEdit(r.id)} className="text-xs text-navy font-medium">
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-ink/40">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingId(r.id);
                          setEditingValue(String(r[fieldKey]));
                        }}
                        className="text-xs text-ink/50 hover:text-ink"
                      >
                        Edit
                      </button>
                      <button onClick={() => remove(r.id)} className="text-xs text-maroon hover:opacity-70">
                        Delete
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
