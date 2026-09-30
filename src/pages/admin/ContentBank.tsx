import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { PageHeader } from "../../components/ui";

type Kind = "questions" | "notes";

const QUESTION_EXAMPLE = `[{"grade":"Grade 8","subject":"Mathematics","strand":"Numbers","question_text":"...","options":["A","B","C","D"],"answer":"A","marks":1}]`;
const NOTES_EXAMPLE = `[{"grade":"Grade 8","subject":"Agriculture","strand":"Food Production","title":"Preparation of Animal Products","content":"..."}]`;

export default function ContentBank() {
  const [kind, setKind] = useState<Kind>("questions");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function importData() {
    if (!supabase) return;
    setBusy(true);
    setMsg("");
    setFailed(false);
    try {
      const data = JSON.parse(text);
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data.questions)
          ? data.questions
          : Array.isArray(data.notes)
            ? data.notes
            : [data];

      if (kind === "questions") {
        const payload = rows.map((x: any) => ({
          grade: x.grade || "",
          subject: x.subject || "",
          strand: x.strand || null,
          sub_strand: x.sub_strand || x.subStrand || null,
          learning_area: x.learning_area || x.learningArea || null,
          question_type: x.question_type || x.type || "mcq",
          question_text: x.question_text || x.text || "",
          options: x.options || [],
          correct_answer: x.correct_answer || x.answer || null,
          marks: Number(x.marks || 1),
          difficulty: x.difficulty || "medium",
          parts: x.parts || [],
          active: true,
        }));
        const { error } = await supabase.from("question_bank").insert(payload);
        if (error) throw error;
        setMsg(`Imported ${payload.length} question(s).`);
      } else {
        const payload = rows.map((x: any) => ({
          grade: x.grade || "",
          subject: x.subject || "",
          strand: x.strand || null,
          sub_strand: x.sub_strand || x.subStrand || null,
          learning_area: x.learning_area || x.learningArea || null,
          title: x.title || "Learning Notes",
          content: x.content || x.text || "",
          active: true,
        }));
        const { error } = await supabase.from("notes_bank").insert(payload);
        if (error) throw error;
        setMsg(`Imported ${payload.length} note item(s).`);
      }
      setText("");
    } catch (e: any) {
      setFailed(true);
      setMsg(e.message || "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Content Bank"
        description="Import the question and notes datasets. The generator reads these records directly from the database."
      />

      <div className="flex gap-2 mb-4" role="tablist" aria-label="Content type">
        {(["questions", "notes"] as Kind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={`tab-btn ${kind === k ? "tab-btn-active" : ""}`}
            onClick={() => {
              setKind(k);
              setMsg("");
            }}
          >
            {k === "questions" ? "Questions" : "Notes"}
          </button>
        ))}
      </div>

      <div className="neu-card p-5">
        <label htmlFor="import-json" className="block text-sm font-medium text-ink mb-1">
          Paste JSON
        </label>
        <p className="text-xs text-ink/55 mb-3">
          An array, or an object containing a <code>{kind}</code> array.
        </p>
        <textarea
          id="import-json"
          className="neu-input min-h-[360px] font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "questions" ? QUESTION_EXAMPLE : NOTES_EXAMPLE}
          spellCheck={false}
        />
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button disabled={busy || !text.trim()} className="neu-btn" onClick={importData}>
            {busy ? "Importing…" : `Import ${kind}`}
          </button>
          {msg && (
            <span className={`text-sm ${failed ? "text-maroon" : "text-success"}`} role="status">
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
