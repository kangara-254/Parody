// build_html.js — turns a content JSON object into the KCSE-style exam HTML.
// Shared by generate.js (renders to PDF via Chromium) and preview.js
// (dumps the same HTML to disk for a quick look, no Chromium needed).

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline math: [[frac:3|4]] -> stacked fraction, ^{2} -> superscript,
// _{2} -> subscript. Kept from the earlier HTML/Chromium prototype.
function inl(s) {
  return esc(s)
    .replace(/\[\[frac:([^|]+)\|([^\]]+)\]\]/g, '<span class="frac"><span class="fnum">$1</span><span class="fden">$2</span></span>')
    .replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
}

function svg(d) {
  if (!d) return '';
  if (d.type === 'triangle') {
    return '<svg class="diagram" viewBox="0 0 220 105"><polygon points="110,8 18,90 202,90" fill="none" stroke="currentColor" stroke-width="2"/><text x="110" y="8" text-anchor="middle" font-size="12">A</text><text x="6" y="101" font-size="12">B</text><text x="206" y="101" font-size="12">C</text><text x="110" y="103" text-anchor="middle" font-size="11">12 cm</text></svg>';
  }
  if (d.type === 'angle') {
    return '<svg class="diagram" viewBox="0 0 220 105"><line x1="30" y1="85" x2="195" y2="85" stroke="currentColor" stroke-width="2"/><line x1="30" y1="85" x2="105" y2="18" stroke="currentColor" stroke-width="2"/><path d="M58 85 A28 28 0 0 0 51 61" fill="none" stroke="currentColor"/><text x="70" y="63" font-size="13">60°</text></svg>';
  }
  // coordinate / default
  return '<svg class="diagram" viewBox="0 0 220 125"><line x1="25" y1="105" x2="205" y2="105" stroke="currentColor"/><line x1="40" y1="115" x2="40" y2="15" stroke="currentColor"/><polyline points="70,85 105,55 140,85 175,25" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="70" cy="85" r="3" fill="currentColor"/><circle cx="105" cy="55" r="3" fill="currentColor"/><text x="198" y="101" font-size="12">x</text><text x="45" y="22" font-size="12">y</text></svg>';
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

function mcq(x) {
  return (
    '<div class="q">' +
    '<div class="qhead"><span class="qnum">' + x.number + '.</span> ' + inl(x.text) +
    ' <span class="mk">(' + x.marks + (x.marks === 1 ? ' mk)' : ' mks)') + '</span></div>' +
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
      svg(p.diagram) +
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.subject)} — ${esc(d.grade)}</title><style>
@page { size: A4; margin: 13mm 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Times New Roman', Times, 'Liberation Serif', serif; font-size: 13pt; line-height: 1.4; color: #111; }

.school { text-align: center; font-weight: bold; font-size: 13.5pt; margin-top: 0; }
.rule { border-top: 1.5px solid #111; margin: 3px 0 4px; }
.title { text-align: center; font-weight: bold; font-size: 14.5pt; letter-spacing: 0.5px; text-transform: uppercase; }
.subtitle { text-align: center; font-size: 10pt; font-style: italic; margin-top: 0; }

.candidate { border: 1.4px solid #111; padding: 3px 12px; margin: 6px 0 6px; display: grid; grid-template-columns: 1.4fr 0.8fr 1fr; align-items: baseline; }
.candidate .field { font-size: 9.5pt; }
.candidate .field b { text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.5px; color: #333; display: block; margin-bottom: 0; }
.candidate .value { font-size: 11pt; font-weight: bold; }

.instructions { font-size: 9.5pt; font-style: italic; margin: 0 0 6px; text-align: center; }

.sechead { background: #111; color: #fff; font-weight: bold; font-size: 12pt; text-transform: uppercase; padding: 4px 12px; margin: 6px 0 2px; letter-spacing: 0.4px; }
.sechead.pagebreak { break-before: page; page-break-before: always; margin-top: 0; }
.secmarks { float: right; font-weight: normal; }
.secinst { font-size: 9.5pt; font-style: italic; margin: 2px 0 7px; }

.q { break-inside: avoid; margin-bottom: 5px; }
.secA-columns { column-count: 2; column-gap: 28px; column-rule: 2.5px solid #111; }
.secA-columns .q { break-inside: avoid-column; }
.qhead { margin-bottom: 2px; }
.qnum { font-weight: bold; }
.substrand { font-weight: bold; }
.mk { float: right; font-weight: normal; font-style: italic; color: #333; }

.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 20px; margin: 3px 0 0 20px; line-height: 1.25; }
.opt { font-size: 12pt; }

.part { margin: 5px 0 7px 20px; }
.plabel { font-weight: bold; }

.frac { display: inline-flex; flex-direction: column; text-align: center; vertical-align: middle; line-height: 1; margin: 0 3px; font-size: 0.92em; }
.fnum { border-bottom: 1.2px solid #111; padding: 0 4px 1px; }
.fden { padding-top: 1px; }

.diagram { display: block; width: 130px; height: 62px; margin: 4px 0 4px 2px; }

.ans { margin: 5px 0 2px 2px; }
.ansline { border-bottom: 1px dotted #555; height: 15px; }

.footnote { margin-top: 14px; text-align: center; font-size: 8.5pt; color: #333; border-top: 1px solid #999; padding-top: 3px; }
</style></head><body>

<div class="school">${esc(d.school)}</div>
<div class="rule"></div>
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
${secAWrapOpen}${d.section_a.questions.map(mcq).join('')}${secAWrapClose}

<div class="sechead pagebreak">Section B — Structured Questions<span class="secmarks">${d.section_b.marks} marks</span></div>
<div class="secinst">${esc(d.section_b.instructions)}</div>
${d.section_b.questions.map(structured).join('')}

</body></html>`;
}

module.exports = { buildHtml };
