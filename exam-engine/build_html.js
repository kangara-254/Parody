// build_html.js — turns a content JSON object into the KCSE-style exam HTML.
// Shared by generate.js (renders to PDF via Chromium) and preview.js
// (dumps the same HTML to disk for a quick look, no Chromium needed).

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline math: [[frac:3|4]] -> stacked fraction, [[sqrt:x]] -> square root,
// [[nthroot:3|x]] -> nth root, ^{2} -> superscript, _{2} -> subscript.
// Kept from the earlier HTML/Chromium prototype.
function inl(s) {
  return esc(s)
    .replace(/\[\[frac:([^|]+)\|([^\]]+)\]\]/g, '<span class="frac"><span class="fnum">$1</span><span class="fden">$2</span></span>')
    .replace(/\[\[nthroot:([^|]+)\|([^\]]+)\]\]/g, '<span class="sqrt"><sup class="sqrt-index">$1</sup>&radic;<span class="sqrt-radicand">$2</span></span>')
    .replace(/\[\[sqrt:([^\]]+)\]\]/g, '<span class="sqrt">&radic;<span class="sqrt-radicand">$1</span></span>')
    .replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
}

// Real diagram vocabulary — see diagrams.js. Replaces the old placeholder
// that ignored the question's actual diagram data and always drew one of
// three hardcoded shapes regardless of "type".
const { renderDiagram } = require('./diagrams');

function svg(d) {
  return renderDiagram(d);
}

// KCSE marking-scheme style answer ruling: N faint dotted lines sized to
// the marks available, so Section B looks like a real script, not a gap.
function answerLines(marks) {
  const n = Math.max(2, marks);
  let out = '<div class="ans">';
  for (let i = 0; i < n; i++) out += '<div class="ansline"></div>';
  out += '</div>';
  return out;
}

// "Complete the table below" style questions — a plain headers+rows grid,
// distinct from a diagram since it's real tabular data, not a figure.
function table(t) {
  if (!t) return '';
  const head = t.headers ? '<tr>' + t.headers.map(h => '<th>' + inl(h) + '</th>').join('') + '</tr>' : '';
  const rows = (t.rows || []).map(r => '<tr>' + r.map(c => '<td>' + inl(String(c)) + '</td>').join('') + '</tr>').join('');
  return '<table class="qtable">' + head + rows + '</table>';
}

// A real raster image (specimen photo, map, scanned figure) — for content
// that genuinely can't be a redrawn vector diagram.
function photo(p) {
  if (!p) return '';
  return '<div class="photo-block"><img class="photo" src="' + esc(p.data_uri) + '" style="width:' + (p.width || 160) + 'px"/>' +
    (p.caption ? '<div class="photo-caption">' + inl(p.caption) + '</div>' : '') + '</div>';
}

// A shared comprehension/stimulus passage, referenced by several questions
// in a row via question.passage_ref. Rendered once, right before the first
// question that references it.
function passageBlock(p) {
  return '<div class="passage">' +
    (p.title ? '<div class="passage-title">' + inl(p.title) + '</div>' : '') +
    '<div class="passage-text">' + inl(p.text).replace(/\n/g, '<br/>') + '</div>' +
    svg(p.diagram) +
    '</div>';
}

function withPassages(questions, renderFn, passagesById) {
  let out = '';
  let lastRef = null;
  for (const q of questions) {
    if (q.passage_ref && q.passage_ref !== lastRef) {
      const p = passagesById[q.passage_ref];
      if (p) out += passageBlock(p);
    }
    lastRef = q.passage_ref || null;
    out += renderFn(q);
  }
  return out;
}

// The corner "seal" — a hand-gradeable score circle, like where an
// invigilator would stamp a total. Outer solid ring is the badge; inner
// dashed ring is the blank the teacher actually writes the mark inside,
// so it reads as "write here" rather than decoration.
function scoreBadge(maxMarks) {
  return `<div class="score-badge"><svg viewBox="0 0 100 100" width="68" height="68">
    <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <circle class="ring-inner" cx="50" cy="50" r="36" fill="none" stroke-width="1" stroke-dasharray="2.5,3"/>
    <text x="50" y="30" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="1">SCORE</text>
    <text x="50" y="58" text-anchor="middle" font-size="15" font-weight="700"> </text>
    <text x="50" y="80" text-anchor="middle" font-size="9">out of ${esc(maxMarks)}</text>
  </svg></div>`;
}

function mcq(x) {
  return (
    '<div class="q">' +
    '<div class="qhead"><span class="qnum">' + x.number + '.</span> ' + inl(x.text) +
    ' <span class="mk">(' + x.marks + (x.marks === 1 ? ' mk)' : ' mks)') + '</span></div>' +
    svg(x.diagram) + table(x.table) + photo(x.photo) +
    '<div class="opts">' +
    x.options.map((o, i) => '<div class="opt"><b>' + String.fromCharCode(65 + i) + '.</b> ' + inl(o) + '</div>').join('') +
    '</div></div>'
  );
}

function structured(x) {
  return (
    '<div class="q">' +
    '<div class="qhead"><span class="qnum">' + x.number + '.</span> <span class="substrand">' + inl(x.text) + '</span></div>' +
    (x.parts || []).map(p =>
      '<div class="part">' +
      '<span class="plabel">' + p.label + '</span> ' + inl(p.text) +
      ' <span class="mk">(' + p.marks + (p.marks === 1 ? ' mk)' : ' mks)') + '</span>' +
      svg(p.diagram) + table(p.table) + photo(p.photo) +
      answerLines(p.marks) +
      '</div>'
    ).join('') +
    '</div>'
  );
}

function buildHtml(d) {
  const MANY_QUESTIONS_THRESHOLD = 12;
  const secAMany = d.section_a.questions.length > MANY_QUESTIONS_THRESHOLD;
  const secAWrapOpen = secAMany ? '<div class="secA-columns">' : '';
  const secAWrapClose = secAMany ? '</div>' : '';
  const passagesById = {};
  (d.passages || []).forEach(p => { passagesById[p.id] = p; });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.subject)} — ${esc(d.grade)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bitter:ital,wght@0,500;0,600;0,700;0,800;1,600&display=swap">
<style>
/* Brand tokens — mirrors tailwind.config.js so a printed paper reads as
   the same product as the web app, not a generic black/white handout. */
:root {
  --ink: #241417;
  --paper: #fbf8f1;
  --maroon: #a3123f;
  --maroon-ink: #5c1026;
  --maroon-deep: #7a0f30;
  --maroon-50: #fbeaf0;
  --brass: #a9772c;
  --line: rgba(36,20,23,0.32);
  --line-soft: rgba(36,20,23,0.14);
}
@page { size: A4; margin: 13mm 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 13pt; line-height: 1.4; color: var(--ink); }

.school { text-align: center; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 13.5pt; margin-top: 0; color: var(--maroon-ink); }
.rule { border-top: 2px solid var(--maroon); margin: 3px 0 0; }
.rule-accent { border-top: 1px solid var(--brass); margin: 0 0 5px; }
.title { text-align: center; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 14.5pt; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink); }
.subtitle { text-align: center; font-size: 10pt; font-style: italic; margin-top: 0; color: var(--maroon-ink); }

.candidate { border: 1.2px solid var(--line); border-radius: 2px; padding: 3px 12px; margin: 6px 0 6px; display: grid; grid-template-columns: 1.4fr 0.8fr 1fr; align-items: baseline; }
.candidate .field { font-size: 9.5pt; }
.candidate .field b { text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.5px; color: var(--brass); display: block; margin-bottom: 0; }
.candidate .value { font-size: 11pt; font-weight: 700; color: var(--ink); }

.instructions { font-size: 9.5pt; font-style: italic; margin: 0 0 6px; text-align: center; color: var(--maroon-ink); }

.sechead { background: var(--maroon); color: #fdf6f0; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 12pt; text-transform: uppercase; padding: 5px 12px; margin: 6px 0 0; letter-spacing: 0.4px; border-radius: 2px 2px 0 0; }
.sechead.pagebreak { break-before: page; page-break-before: always; margin-top: 0; }
.secmarks { float: right; font-weight: 500; }
.secinst { font-size: 9.5pt; font-style: italic; margin: 0 0 7px; padding: 3px 12px 6px; border-bottom: 1px solid var(--brass); background: var(--maroon-50); }

.q { break-inside: avoid; margin-bottom: 5px; }
.secA-columns { column-count: 2; column-gap: 28px; column-rule: 1.5px solid var(--line); }
.secA-columns .q { break-inside: avoid-column; }
.qhead { margin-bottom: 2px; }
.qnum { font-weight: 700; color: var(--maroon-ink); }
.substrand { font-weight: 700; }
.mk { float: right; font-weight: 400; font-style: italic; color: var(--brass); }

.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 20px; margin: 3px 0 0 20px; line-height: 1.25; }
.opt { font-size: 12pt; }
.opt b { color: var(--maroon-ink); }

.part { margin: 5px 0 7px 20px; }
.plabel { font-weight: 700; color: var(--maroon-ink); }

.frac { display: inline-flex; flex-direction: column; text-align: center; vertical-align: middle; line-height: 1; margin: 0 3px; font-size: 0.92em; }
.fnum { border-bottom: 1.2px solid var(--ink); padding: 0 4px 1px; }
.fden { padding-top: 1px; }

.sqrt { white-space: nowrap; }
.sqrt-index { font-size: 0.62em; vertical-align: 0.9em; margin-right: -0.35em; position: relative; }
.sqrt-radicand { border-top: 1.2px solid currentColor; padding: 0 3px 0 1px; margin-left: 1px; }

.diagram { display: block; width: 190px; height: 95px; margin: 4px 0 4px 2px; color: var(--ink); }

.qtable { border-collapse: collapse; margin: 5px 0 5px 2px; font-size: 11pt; }
.qtable th, .qtable td { border: 1px solid var(--line); padding: 3px 8px; text-align: center; }
.qtable th { font-weight: 700; background: var(--maroon-50); }

.photo-block { margin: 5px 0 5px 2px; }
.photo { display: block; border: 1px solid var(--line); }
.photo-caption { font-size: 8.5pt; font-style: italic; color: var(--maroon-ink); margin-top: 2px; }

.passage { border: 1px solid var(--line); border-left: 3px solid var(--brass); padding: 8px 10px; margin: 6px 0 8px; break-inside: avoid; background: var(--maroon-50); }
.passage-title { font-family: 'Bitter', Georgia, serif; font-weight: 700; text-align: center; font-size: 11.5pt; margin-bottom: 4px; text-transform: uppercase; color: var(--maroon-ink); }
.passage-text { font-size: 11.5pt; line-height: 1.35; }

/* Two watermark layers, both position:fixed so they repeat on every
   printed page: the crest is the quiet brand mark (always on unless
   disabled), the text stamp is an optional functional label (DRAFT,
   SPECIMEN, etc) that sits above it. */
.crest-watermark { position: fixed; top: 50%; left: 50%; width: 68%; padding-bottom: 68%; transform: translate(-50%, -50%); background-image: var(--crest-url); background-size: contain; background-repeat: no-repeat; background-position: center; opacity: 0.05; z-index: -2; pointer-events: none; }
.watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-family: 'Bitter', Georgia, serif; font-size: 66pt; font-weight: 700; color: rgba(163,18,63,0.07); transform: rotate(-30deg); z-index: -1; pointer-events: none; }

.header-row { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 42px; }
.logo { position: absolute; left: 0; top: 50%; transform: translateY(-50%); height: 42px; width: auto; }

/* Score badge — a wax-seal medallion rather than a plain black circle:
   maroon outer ring, brass dashed inner ring (where the mark is written),
   sitting opposite the logo like an embossed stamp on a certificate. */
.score-badge { position: absolute; right: 0; top: 50%; transform: translateY(-50%); color: var(--maroon); }
.score-badge .ring-inner { stroke: var(--brass); }
.score-badge text { fill: var(--maroon-ink); font-family: 'Bitter', Georgia, serif; }

.ans { margin: 5px 0 2px 2px; }
.ansline { border-bottom: 1px dotted var(--line); height: 15px; }

.footnote { margin-top: 14px; text-align: center; font-size: 8.5pt; color: var(--maroon-ink); border-top: 1px solid var(--line-soft); padding-top: 3px; }
</style></head><body>

${d.crest_data_uri ? `<div class="crest-watermark" style="--crest-url:url('${esc(d.crest_data_uri)}')"></div>` : ''}
${d.watermark ? '<div class="watermark">' + esc(d.watermark) + '</div>' : ''}
<div class="header-row">
  ${d.logo_data_uri ? '<img class="logo" src="' + esc(d.logo_data_uri) + '"/>' : ''}
  <div class="school">${esc(d.school)}</div>
  ${d.maximum_marks ? scoreBadge(d.maximum_marks) : ''}
</div>
<div class="rule"></div>
<div class="rule-accent"></div>
<div class="title">${esc(d.subject)} — ${esc(d.grade)}</div>
<div class="subtitle">${esc(d.strand)}</div>

<div class="candidate">
  <span class="field"><b>Name</b><span class="value">${esc(d.student_name || '')}</span></span>
  <span class="field"><b>Class</b><span class="value">${esc(d.student_class || '')}</span></span>
  <span class="field"><b>Teacher</b><span class="value">${esc(d.teacher || '')}</span></span>
</div>

<div class="instructions">Answer all questions in the spaces provided.</div>

<div class="sechead">Section A — Multiple Choice Questions<span class="secmarks">${d.section_a.marks} marks</span></div>
<div class="secinst">${esc(d.section_a.instructions)}</div>
${secAWrapOpen}${withPassages(d.section_a.questions, mcq, passagesById)}${secAWrapClose}

<div class="sechead pagebreak">Section B — Structured Questions<span class="secmarks">${d.section_b.marks} marks</span></div>
<div class="secinst">${esc(d.section_b.instructions)}</div>
${withPassages(d.section_b.questions, structured, passagesById)}

</body></html>`;
}

module.exports = { buildHtml };
