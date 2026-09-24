// build_notes_html.js — turns a lesson-notes content JSON object into a
// print-ready HTML page, rendered to PDF by the same Puppeteer pipeline
// as build_html.js / build_scheme_html.js (see api/generate-pdf.js).
//
// This is a JS port of the Python notes_engine.py (ReportLab Platypus),
// keeping its colour identity (navy / maroon / gold boxed style) rather
// than the plain black-and-white exam look, per content design.
//
// CONTENT SCHEMA
// ---------------
// {
//   "school": "...", "grade": "GRADE 7", "subject": "INTEGRATED SCIENCE",
//   "title": "GRADE 7 INTEGRATED SCIENCE",
//   "subtitle": "LESSON NOTES - STRAND 4: FORCE AND ENERGY",
//   "topic_code": "ISC-701-NOTES",
//   "footer": "LEARNER NOTES",
//   "logo_data_uri": "data:image/png;base64,...",   // optional, header logo
//   "watermark": "DRAFT",                            // optional, repeats every page
//   "sections": [
//     {
//       "heading": "1. ELECTRICAL ENERGY",
//       "intro": "Optional orienting sentence(s).",
//       "diagram": { ...optional overview figure, see notes_diagrams.js... },
//       "photo": { "data_uri": "...", "caption": "...", "width": 300 },
//       "subsections": [
//         {
//           "heading": "Sources of electricity",
//           "content": ["bullet", "bullet"],
//           "definition": {"term": "...", "meaning": "..."},
//           "worked_example": {"problem": "...", "steps": ["...", "..."]},
//           "example": "...",
//           "activity": "...",
//           "diagram": { "caption": "...", "width": 260, "height": 120, "shapes": [...] },
//           "photo": { "data_uri": "...", "caption": "...", "width": 300 }
//         }
//       ],
//       "key_terms": [{"term": "...", "meaning": "..."}],
//       "summary_points": ["...", "..."]
//     }
//   ],
//   // Either plain strings, or {question, answer} to also populate the
//   // auto-generated "ANSWER KEY" appendix at the very end (the main
//   // revision list itself never shows the answer inline).
//   "revision_questions": ["...", {"question": "...", "answer": "..."}]
// }
//
// All fields inside a subsection except "heading" are optional. "diagram"
// and "photo" may also sit directly on a section (shown once, before its
// subsections). A "CONTENTS" jump-list is auto-generated when there's more
// than one section; a consolidated "GLOSSARY" is auto-generated from every
// section's key_terms when more than one section has any. See
// notes_diagrams.js for the diagram shape vocabulary.

const { diagramFlowable, resetFigureCounter } = require('./notes_diagrams');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline math + soft line breaks, consistent with the exam engine's `inl()`
// (frac / sqrt / nthroot / superscript / subscript).
function inl(s) {
  return esc(s)
    .replace(/\[\[frac:([^|]+)\|([^\]]+)\]\]/g, '<span class="frac"><span class="fnum">$1</span><span class="fden">$2</span></span>')
    .replace(/\[\[nthroot:([^|]+)\|([^\]]+)\]\]/g, '<span class="sqrt"><sup class="sqrt-index">$1</sup>&radic;<span class="sqrt-radicand">$2</span></span>')
    .replace(/\[\[sqrt:([^\]]+)\]\]/g, '<span class="sqrt">&radic;<span class="sqrt-radicand">$1</span></span>')
    .replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
}

function bulletList(items) {
  if (!items || !items.length) return '';
  return `<ul class="bullets">${items.map(it => `<li>${inl(it)}</li>`).join('')}</ul>`;
}

function tintedBox(label, bodyText, cls) {
  return `<div class="box ${cls}"><div class="box-label">${esc(label)}</div><div class="box-body">${inl(bodyText)}</div></div>`;
}

function definitionBox(def) {
  return tintedBox(`DEFINITION \u2014 ${String(def.term || '').toUpperCase()}`, def.meaning, 'box-def');
}
function exampleBox(text) { return tintedBox('EXAMPLE', text, 'box-ex'); }
function activityBox(text) { return tintedBox('TRY THIS', text, 'box-act'); }

function keyTermsTable(terms) {
  if (!terms || !terms.length) return '';
  const rows = terms.map(t => `<tr><td class="kt-term">${inl(t.term)}</td><td class="kt-meaning">${inl(t.meaning)}</td></tr>`).join('');
  return `<table class="key-terms"><tbody>${rows}</tbody></table>`;
}

function workedExampleBox(we) {
  const steps = (we.steps || []).map(s => `<li>${inl(s)}</li>`).join('');
  return `<div class="box box-worked"><div class="box-label">WORKED EXAMPLE</div><div class="box-body">` +
    (we.problem ? `<div class="worked-problem">${inl(we.problem)}</div>` : '') +
    `<ol class="worked-steps">${steps}</ol></div></div>`;
}

// A real raster image (specimen photo, map, scanned figure) — reuses the
// same centred-figure-plus-caption look as a drawn diagram.
function photoBlock(p) {
  if (!p) return '';
  return `<div class="diagram-block"><div class="diagram-figure"><img src="${esc(p.data_uri)}" style="width:${p.width || 300}px"/></div>` +
    (p.caption ? `<div class="diagram-caption">${inl(p.caption)}</div>` : '') + `</div>`;
}

function slugify(s, i) {
  return 'sec-' + i + '-' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}

function tocBlock(sections) {
  if (sections.length <= 1) return '';
  const items = sections.map((sec, i) => `<li><a href="#${slugify(sec.heading, i)}">${inl(sec.heading)}</a></li>`).join('');
  return `<div class="toc"><div class="toc-title">CONTENTS</div><ol class="toc-list">${items}</ol></div>`;
}

// Pulls every section's key_terms into one alphabetised, de-duplicated
// table — a proper glossary, distinct from each section's own per-topic
// table. Only shown once there's actually more than one section's worth
// of terms to consolidate; otherwise it would just repeat the one table.
function aggregateGlossary(sections) {
  const map = new Map();
  let sectionsWithTerms = 0;
  sections.forEach(sec => {
    if (sec.key_terms && sec.key_terms.length) sectionsWithTerms++;
    (sec.key_terms || []).forEach(t => {
      const key = String(t.term || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, t);
    });
  });
  if (sectionsWithTerms <= 1) return [];
  return Array.from(map.values()).sort((a, b) => String(a.term).localeCompare(String(b.term)));
}

function glossaryBlock(terms) {
  if (!terms.length) return '';
  return `<div class="section" id="glossary"><div class="section-band">GLOSSARY</div>${keyTermsTable(terms)}</div>`;
}

const MAX_DIAGRAM_WIDTH = 460; // px, matches the text column width below

function renderSubsection(sub) {
  let out = `<div class="subsection">`;
  out += `<div class="sub-heading">${inl(sub.heading)}</div>`;
  if (sub.content && sub.content.length) out += bulletList(sub.content);
  if (sub.diagram) out += diagramFlowable(sub.diagram, MAX_DIAGRAM_WIDTH);
  if (sub.photo) out += photoBlock(sub.photo);
  if (sub.definition) out += definitionBox(sub.definition);
  if (sub.worked_example) out += workedExampleBox(sub.worked_example);
  if (sub.example) out += exampleBox(sub.example);
  if (sub.activity) out += activityBox(sub.activity);
  out += `</div>`;
  return out;
}

function renderSection(sec, index, isLast) {
  let out = `<div class="section" id="${slugify(sec.heading, index)}">`;
  out += `<div class="section-band">${esc(sec.heading)}</div>`;
  if (sec.intro) out += `<div class="section-intro">${inl(sec.intro)}</div>`;
  if (sec.diagram) out += diagramFlowable(sec.diagram, MAX_DIAGRAM_WIDTH);
  if (sec.photo) out += photoBlock(sec.photo);
  (sec.subsections || []).forEach(sub => { out += renderSubsection(sub); });
  if (sec.key_terms && sec.key_terms.length) {
    out += `<div class="summary-title">KEY TERMS</div>${keyTermsTable(sec.key_terms)}`;
  }
  if (sec.summary_points && sec.summary_points.length) {
    out += `<div class="summary-title">SECTION SUMMARY</div>${bulletList(sec.summary_points)}`;
  }
  out += `</div>`;
  if (!isLast) out += `<hr class="section-rule"/>`;
  return out;
}

// revision_questions items may be a plain string, or {question, answer} to
// also populate the answer-key appendix below — main list never shows the
// answer inline, so it stays usable as an actual self-test.
function renderRevisionQuestions(questions) {
  if (!questions || !questions.length) return '';
  const items = questions.map(q => `<li>${inl(typeof q === 'string' ? q : q.question)}</li>`).join('');
  return `<div class="section" id="revision-questions"><div class="section-band">REVISION QUESTIONS</div><ol class="revision-list">${items}</ol></div>`;
}

function renderAnswerKey(questions) {
  const withAnswers = (questions || [])
    .map((q, i) => ({ n: i + 1, a: typeof q === 'object' ? q.answer : null }))
    .filter(x => x.a);
  if (!withAnswers.length) return '';
  const rows = withAnswers.map(x => `<tr><td class="ak-num">${x.n}.</td><td>${inl(x.a)}</td></tr>`).join('');
  return `<div class="section" id="answer-key"><div class="section-band">ANSWER KEY</div><table class="answer-key"><tbody>${rows}</tbody></table></div>`;
}

function buildNotesHtml(d) {
  resetFigureCounter();
  const sections = d.sections || [];
  const glossaryTerms = aggregateGlossary(sections);
  const body = tocBlock(sections) +
    sections.map((sec, i) => renderSection(sec, i, i === sections.length - 1)).join('') +
    glossaryBlock(glossaryTerms) +
    renderRevisionQuestions(d.revision_questions) +
    renderAnswerKey(d.revision_questions);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.subject || 'Notes')} \u2014 ${esc(d.grade || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bitter:ital,wght@0,500;0,600;0,700;0,800;1,600&display=swap">
<style>
:root {
  --ink: #241417;
  --maroon: #a3123f;
  --maroon-ink: #5c1026;
  --maroon-50: #fbeaf0;
  --brass: #a9772c;
  --brass-10: #f7efe0;
  --paper: #f6f1e6;
  --line: rgba(36,20,23,0.16);
}
@page { size: A4; margin: 20mm 16mm 18mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 9.3pt; line-height: 1.45; color: var(--ink); }

.header { border-bottom: 2px solid var(--maroon); padding-bottom: 8px; margin-bottom: 4px; position: relative; }
.eyebrow { font-size: 7pt; font-weight: 700; color: var(--brass); letter-spacing: 0.5px; text-transform: uppercase; }
.title-row { display: flex; justify-content: space-between; align-items: flex-end; }
.title { font-family: 'Bitter', Georgia, serif; font-size: 15pt; font-weight: 700; color: var(--maroon-ink); margin-top: 2px; }
.subtitle { font-size: 8pt; color: var(--ink); opacity: 0.65; margin-top: 2px; }
.topic-code-block { text-align: right; }
.topic-code-label { font-size: 6.5pt; font-weight: 700; color: var(--brass); letter-spacing: 0.5px; }
.topic-code { font-family: 'Bitter', Georgia, serif; font-size: 8pt; font-weight: 700; color: var(--maroon-ink); }
.school-name { font-size: 7pt; color: var(--ink); opacity: 0.6; margin-top: 1px; }

.section { margin-top: 12px; }
.section-band { background: var(--maroon); color: #fdf6f0; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 10.3pt; padding: 7px 10px; border-radius: 3px; }
.section-intro { font-style: italic; font-size: 8.3pt; color: var(--ink); opacity: 0.7; margin: 8px 0 4px; }
.section-rule { border: none; border-top: 0.6px solid var(--line); margin: 10px 0; }

.subsection { margin: 10px 0; }
.sub-heading { font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 9.8pt; color: var(--brass); margin-bottom: 4px; }
.bullets { margin: 2px 0 4px 0; padding-left: 14px; }
.bullets li { margin-bottom: 3px; }

.diagram-block { text-align: center; margin: 6px 0; break-inside: avoid; }
.diagram-figure { display: inline-block; }
.diagram-caption { font-style: italic; font-size: 7.6pt; color: var(--ink); opacity: 0.65; margin-top: 3px; }

.box { border: 0.6px solid var(--line); border-left: 3px solid var(--brass); border-radius: 2px; padding: 7px 10px; margin: 6px 0; break-inside: avoid; }
.box-label { font-weight: 700; font-size: 7.2pt; color: var(--maroon-ink); letter-spacing: 0.3px; margin-bottom: 2px; }
.box-body { font-size: 8.6pt; }
.box-def { background: var(--maroon-50); }
.box-ex { background: var(--paper); }
.box-act { background: var(--brass-10); }

.summary-title { font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 9pt; color: var(--maroon-ink); margin: 10px 0 4px; }
.key-terms { border-collapse: collapse; width: 100%; margin-bottom: 6px; }
.key-terms td { border: 0.4px solid var(--line); padding: 5px 8px; font-size: 8.6pt; vertical-align: top; background: var(--paper); }
.kt-term { font-weight: 700; color: var(--maroon-ink); width: 32%; }

.revision-list { margin: 6px 0 0 18px; padding: 0; }
.revision-list li { margin-bottom: 6px; font-size: 8.8pt; }

.frac { display: inline-flex; flex-direction: column; text-align: center; vertical-align: middle; line-height: 1; margin: 0 3px; font-size: 0.92em; }
.fnum { border-bottom: 1.2px solid var(--ink); padding: 0 4px 1px; }
.fden { padding-top: 1px; }

.sqrt { white-space: nowrap; }
.sqrt-index { font-size: 0.62em; vertical-align: 0.9em; margin-right: -0.35em; position: relative; }
.sqrt-radicand { border-top: 1.2px solid var(--ink); padding: 0 3px 0 1px; margin-left: 1px; }

.box-worked { background: var(--brass-10); border-left-color: var(--maroon); }
.worked-problem { font-weight: 700; margin-bottom: 4px; }
.worked-steps { margin: 2px 0 0 16px; padding: 0; }
.worked-steps li { margin-bottom: 3px; font-size: 8.6pt; }

.toc { border: 0.6px solid var(--line); border-radius: 3px; padding: 8px 12px; margin: 8px 0 4px; background: var(--paper); }
.toc-title { font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 8pt; color: var(--maroon-ink); letter-spacing: 0.4px; margin-bottom: 4px; }
.toc-list { margin: 0 0 0 16px; padding: 0; }
.toc-list li { font-size: 8.6pt; margin-bottom: 2px; }
.toc-list a { color: var(--ink); text-decoration: none; }

.answer-key { border-collapse: collapse; width: 100%; margin-bottom: 6px; }
.answer-key td { border: 0.4px solid var(--line); padding: 4px 8px; font-size: 8.6pt; vertical-align: top; }
.ak-num { font-weight: 700; color: var(--maroon-ink); width: 8%; }

.crest-watermark { position: fixed; top: 50%; left: 50%; width: 62%; padding-bottom: 62%; transform: translate(-50%, -50%); background-image: var(--crest-url); background-size: contain; background-repeat: no-repeat; background-position: center; opacity: 0.045; z-index: -2; pointer-events: none; }
.watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-family: 'Bitter', Georgia, serif; font-size: 60pt; font-weight: 700; color: rgba(163,18,63,0.06); transform: rotate(-30deg); z-index: -1; pointer-events: none; }
.logo { height: 38px; width: auto; }
</style></head><body>

${d.crest_data_uri ? `<div class="crest-watermark" style="--crest-url:url('${esc(d.crest_data_uri)}')"></div>` : ''}
${d.watermark ? `<div class="watermark">${esc(d.watermark)}</div>` : ''}
<div class="header">
  <div class="eyebrow">${esc(d.grade || '')} \u2022 ${esc(d.subject || '')}</div>
  <div class="title-row">
    <div>
      ${d.logo_data_uri ? `<img class="logo" src="${esc(d.logo_data_uri)}"/>` : ''}
      <div class="title">${esc(d.title || d.subject || 'Learning Notes')}</div>
      <div class="subtitle">${esc(d.subtitle || '')}</div>
    </div>
    <div class="topic-code-block">
      ${d.topic_code ? `<div class="topic-code-label">TOPIC CODE</div><div class="topic-code">${esc(d.topic_code)}</div>` : ''}
      ${d.school ? `<div class="school-name">${esc(d.school)}</div>` : ''}
    </div>
  </div>
</div>

${body}

</body></html>`;
}

module.exports = { buildNotesHtml };
