// build_scheme_html.js — renders the actual question paper with model answers filled in.
// This is the teacher-facing answer copy, not the blank student paper.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline math: [[frac:3|4]] -> stacked fraction, [[sqrt:x]] -> square root,
// [[nthroot:3|x]] -> nth root, ^{2} -> superscript, _{2} -> subscript.
function inl(s) {
  return esc(s)
    .replace(/\[\[frac:([^|]+)\|([^\]]+)\]\]/g, '<span class="frac"><span class="fnum">$1</span><span class="fden">$2</span></span>')
    .replace(/\[\[nthroot:([^|]+)\|([^\]]+)\]\]/g, '<span class="sqrt"><sup class="sqrt-index">$1</sup>&radic;<span class="sqrt-radicand">$2</span></span>')
    .replace(/\[\[sqrt:([^\]]+)\]\]/g, '<span class="sqrt">&radic;<span class="sqrt-radicand">$1</span></span>')
    .replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
}

function compactAnswer(s) {
  return String(s || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*[-—]\s*.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function answerLinesWithText(marks, text) {
  const n = Math.max(2, marks);
  const answer = compactAnswer(text || '');
  let out = '<div class="ans-filled">';
  for (let i = 0; i < n; i++) {
    out += '<div class="ansline' + (i === 0 && answer ? ' has-answer' : '') + '">' + (i === 0 && answer ? '<span class="filled-answer">' + inl(answer) + '</span>' : '') + '</div>';
  }
  out += '</div>';
  return out;
}

// Real diagram vocabulary — see diagrams.js (shared with build_html.js so
// the question paper and its marking scheme always render the same figure).
const { renderDiagram } = require('./diagrams');

function svg(d) {
  return renderDiagram(d);
}

// "Complete the table below" style questions — a plain headers+rows grid.
function table(t) {
  if (!t) return '';
  const head = t.headers ? '<tr>' + t.headers.map(h => '<th>' + inl(h) + '</th>').join('') + '</tr>' : '';
  const rows = (t.rows || []).map(r => '<tr>' + r.map(c => '<td>' + inl(String(c)) + '</td>').join('') + '</tr>').join('');
  return '<table class="qtable">' + head + rows + '</table>';
}

// A real raster image (specimen photo, map, scanned figure).
function photo(p) {
  if (!p) return '';
  return '<div class="photo-block"><img class="photo" src="' + esc(p.data_uri) + '" style="width:' + (p.width || 160) + 'px"/>' +
    (p.caption ? '<div class="photo-caption">' + inl(p.caption) + '</div>' : '') + '</div>';
}

// A shared comprehension/stimulus passage, referenced by several questions
// in a row via question.passage_ref — mirrors build_html.js so the scheme
// shows the same passage as the paper it's marking.
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

// Same score-circle badge as the student paper (build_html.js), so a
// teacher glancing at the scheme sees the same total-marks seal.
function scoreBadge(maxMarks) {
  return `<div class="score-badge"><svg viewBox="0 0 100 100" width="60" height="60">
    <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <circle class="ring-inner" cx="50" cy="50" r="36" fill="none" stroke-width="1" stroke-dasharray="2.5,3"/>
    <text x="50" y="30" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="1">SCORE</text>
    <text x="50" y="80" text-anchor="middle" font-size="9">out of ${esc(maxMarks)}</text>
  </svg></div>`;
}

function mcqAnswered(x) {
  const correctLetter = x.answer || '';
  return (
    '<div class="q">' +
    '<div class="qhead"><span class="qnum">' + x.number + '.</span> ' + inl(x.text) +
    ' <span class="mk">(' + x.marks + (x.marks === 1 ? ' mk)' : ' mks)') + '</span></div>' +
    svg(x.diagram) + table(x.table) + photo(x.photo) +
    '<div class="opts">' +
    x.options.map((o, i) => {
      const letter = String.fromCharCode(65 + i);
      const isCorrect = letter === correctLetter;
      return '<div class="opt' + (isCorrect ? ' correct' : '') + '"><span class="option-label' + (isCorrect ? ' selected' : '') + '">' + letter + '</span><span class="option-text">' + inl(o) + '</span></div>';
    }).join('') +
    '</div>' +
    '</div>'
  );
}

function structuredAnswered(x) {
  return (
    '<div class="q">' +
    '<div class="qhead"><span class="qnum">' + x.number + '.</span> <span class="substrand">' + inl(x.text) + '</span></div>' +
    (x.parts || []).map(p =>
      '<div class="part">' +
      '<span class="plabel">' + p.label + '</span> ' + inl(p.text) +
      ' <span class="mk">(' + p.marks + (p.marks === 1 ? ' mk)' : ' mks)') + '</span>' +
      svg(p.diagram) + table(p.table) + photo(p.photo) +
      answerLinesWithText(p.marks, p.answer || '') +
      '</div>'
    ).join('') +
    '</div>'
  );
}

function buildSchemeHtml(d) {
  const MANY_QUESTIONS_THRESHOLD = 12;
  const secAMany = d.section_a.questions.length > MANY_QUESTIONS_THRESHOLD;
  const secAWrapOpen = secAMany ? '<div class="secA-columns">' : '';
  const secAWrapClose = secAMany ? '</div>' : '';
  const passagesById = {};
  (d.passages || []).forEach(p => { passagesById[p.id] = p; });
  // Schemes get a default confidentiality stamp so a scheme can't be
  // visually mistaken for a live paper at a glance. Pass watermark: '' to
  // turn it off, or a custom string to override it.
  const watermark = d.watermark === undefined ? 'MARKING SCHEME — CONFIDENTIAL' : d.watermark;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.subject)} — ${esc(d.grade)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bitter:ital,wght@0,500;0,600;0,700;0,800;1,600&display=swap">
<style>
:root {
  --ink: #241417;
  --maroon: #a3123f;
  --maroon-ink: #5c1026;
  --maroon-50: #fbeaf0;
  --brass: #a9772c;
  --line: rgba(36,20,23,0.32);
  --line-soft: rgba(36,20,23,0.14);
  --success: #1a7a4c;
}
@page { size: A4; margin: 13mm 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 12.6pt; line-height: 1.3; color: var(--ink); }

.school { text-align: center; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 13.2pt; margin-top: 0; color: var(--maroon-ink); }
.rule { border-top: 2px solid var(--maroon); margin: 3px 0 0; }
.rule-accent { border-top: 1px solid var(--brass); margin: 0 0 4px; }
.title { text-align: center; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 14.2pt; letter-spacing: 0.4px; text-transform: uppercase; }
.subtitle { text-align: center; font-size: 9.8pt; font-style: italic; margin-top: 0; color: var(--maroon-ink); }

.candidate {
  border: 1.2px solid var(--line);
  border-radius: 2px;
  padding: 3px 10px;
  margin: 5px 0 5px;
  text-align: center;
  display: block;
  background: var(--maroon-50);
}
.candidate .field { font-size: 9.2pt; }
.candidate .field b {
  text-transform: uppercase;
  font-size: 7.2pt;
  letter-spacing: 0.4px;
  color: var(--maroon-ink);
  display: block;
  margin-bottom: 0;
}
.candidate .value { font-size: 10.8pt; font-weight: 700; }

.instructions { font-size: 9.2pt; font-style: italic; margin: 0 0 5px; text-align: center; color: var(--maroon-ink); }

.sechead { background: var(--maroon); color: #fdf6f0; font-family: 'Bitter', Georgia, serif; font-weight: 700; font-size: 11.6pt; text-transform: uppercase; padding: 4px 10px; margin: 5px 0 0; letter-spacing: 0.3px; border-radius: 2px 2px 0 0; }
.sechead.pagebreak { break-before: page; page-break-before: always; margin-top: 0; }
.secmarks { float: right; font-weight: 400; }
.secinst { font-size: 9.2pt; font-style: italic; margin: 0 0 7px; padding: 3px 10px 5px; border-bottom: 1px solid var(--brass); background: var(--maroon-50); }

.q { break-inside: avoid; margin-bottom: 3px; }
.secA-columns { column-count: 2; column-gap: 28px; column-rule: 1.5px solid var(--line); }
.secA-columns .q { break-inside: avoid-column; }
.qhead { margin-bottom: 2px; }
.qnum { font-weight: 700; color: var(--maroon-ink); }
.substrand { font-weight: 700; }
.mk { float: right; font-weight: 400; font-style: italic; color: var(--brass); }

.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 14px; margin: 2px 0 0 18px; line-height: 1.2; }
.opt { font-size: 11.6pt; display: flex; align-items: center; gap: 5px; margin: 0; color: inherit; }
.opt.correct { color: inherit; font-weight: 400; }
.option-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25em;
  height: 1.25em;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink);
  font-weight: 700;
  flex-shrink: 0;
}
.option-label.selected {
  border-color: var(--success);
  background: #fff;
  color: var(--success);
  box-shadow: 0 0 0 1.5px rgba(26,122,76,0.15);
}
.option-text { line-height: 1.15; }

.part { margin: 4px 0 5px 20px; }
.plabel { font-weight: 700; color: var(--maroon-ink); }

.frac { display: inline-flex; flex-direction: column; text-align: center; vertical-align: middle; line-height: 1; margin: 0 3px; font-size: 0.92em; }
.fnum { border-bottom: 1.2px solid var(--ink); padding: 0 4px 1px; }
.fden { padding-top: 1px; }

.sqrt { white-space: nowrap; }
.sqrt-index { font-size: 0.62em; vertical-align: 0.9em; margin-right: -0.35em; position: relative; }
.sqrt-radicand { border-top: 1.2px solid currentColor; padding: 0 3px 0 1px; margin-left: 1px; }

.diagram { display: block; width: 170px; height: 85px; margin: 3px 0 3px 2px; color: var(--ink); }

.qtable { border-collapse: collapse; margin: 4px 0 4px 2px; font-size: 10.6pt; }
.qtable th, .qtable td { border: 1px solid var(--line); padding: 2px 7px; text-align: center; }
.qtable th { font-weight: 700; background: var(--maroon-50); }

.photo-block { margin: 4px 0 4px 2px; }
.photo { display: block; border: 1px solid var(--line); }
.photo-caption { font-size: 8pt; font-style: italic; color: var(--maroon-ink); margin-top: 2px; }

.passage { border: 1px solid var(--line); border-left: 3px solid var(--brass); padding: 7px 9px; margin: 5px 0 7px; break-inside: avoid; background: var(--maroon-50); }
.passage-title { font-family: 'Bitter', Georgia, serif; font-weight: 700; text-align: center; font-size: 11pt; margin-bottom: 3px; text-transform: uppercase; color: var(--maroon-ink); }
.passage-text { font-size: 11pt; line-height: 1.3; }

.crest-watermark { position: fixed; top: 50%; left: 50%; width: 68%; padding-bottom: 68%; transform: translate(-50%, -50%); background-image: var(--crest-url); background-size: contain; background-repeat: no-repeat; background-position: center; opacity: 0.045; z-index: -2; pointer-events: none; }
.watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-family: 'Bitter', Georgia, serif; font-size: 60pt; font-weight: 700; color: rgba(163,18,63,0.09); transform: rotate(-30deg); z-index: -1; pointer-events: none; }

.header-row { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 40px; }
.logo { position: absolute; left: 0; top: 50%; transform: translateY(-50%); height: 40px; width: auto; }
.score-badge { position: absolute; right: 0; top: 50%; transform: translateY(-50%); color: var(--maroon); }
.score-badge .ring-inner { stroke: var(--brass); }
.score-badge text { fill: var(--maroon-ink); font-family: 'Bitter', Georgia, serif; }

.ans-filled { margin: 3px 0 0 0; }
.ansline {
  border-bottom: 1px dotted var(--line);
  min-height: 15px;
  line-height: 15px;
  position: relative;
}
.ansline.has-answer { border-bottom: 1px solid var(--line); }
.filled-answer { display: inline-block; font-size: 9.8pt; color: var(--success); font-weight: 700; white-space: nowrap; }

.q { break-inside: avoid; margin-bottom: 3px; }
.part { margin: 4px 0 4px 20px; }

.footnote { display: none; }
</style></head><body>

${d.crest_data_uri ? `<div class="crest-watermark" style="--crest-url:url('${esc(d.crest_data_uri)}')"></div>` : ''}
${watermark ? '<div class="watermark">' + esc(watermark) + '</div>' : ''}
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
  <span class="field"><b>MARKING SCHEME</b></span>
</div>

<div class="instructions">Teacher copy: answers shown in the actual paper layout.</div>

<div class="sechead">Section A — Multiple Choice Questions<span class="secmarks">${d.section_a.marks} marks</span></div>
<div class="secinst">${esc(d.section_a.instructions)}</div>
${secAWrapOpen}${withPassages(d.section_a.questions, mcqAnswered, passagesById)}${secAWrapClose}

<div class="sechead pagebreak">Section B — Structured Questions<span class="secmarks">${d.section_b.marks} marks</span></div>
<div class="secinst">${esc(d.section_b.instructions)}</div>
${withPassages(d.section_b.questions, structuredAnswered, passagesById)}

</body></html>`;
}

module.exports = { buildSchemeHtml };
