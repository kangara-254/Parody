// build_scheme_html.js — renders the actual question paper with model answers filled in.
// This is the teacher-facing answer copy, not the blank student paper.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inl(s) {
  return esc(s)
    .replace(/\[\[frac:([^|]+)\|([^\]]+)\]\]/g, '<span class="frac"><span class="fnum">$1</span><span class="fden">$2</span></span>')
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

function svg(d) {
  if (!d) return '';
  if (d.type === 'triangle') {
    return '<svg class="diagram" viewBox="0 0 220 105"><polygon points="110,8 18,90 202,90" fill="none" stroke="currentColor" stroke-width="2"/><text x="110" y="8" text-anchor="middle" font-size="12">A</text><text x="6" y="101" font-size="12">B</text><text x="206" y="101" font-size="12">C</text><text x="110" y="103" text-anchor="middle" font-size="11">12 cm</text></svg>';
  }
  if (d.type === 'angle') {
    return '<svg class="diagram" viewBox="0 0 220 105"><line x1="30" y1="85" x2="195" y2="85" stroke="currentColor" stroke-width="2"/><line x1="30" y1="85" x2="105" y2="18" stroke="currentColor" stroke-width="2"/><path d="M58 85 A28 28 0 0 0 51 61" fill="none" stroke="currentColor"/><text x="70" y="63" font-size="13">60°</text></svg>';
  }
  return '<svg class="diagram" viewBox="0 0 220 125"><line x1="25" y1="105" x2="205" y2="105" stroke="currentColor"/><line x1="40" y1="115" x2="40" y2="15" stroke="currentColor"/><polyline points="70,85 105,55 140,85 175,25" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="70" cy="85" r="3" fill="currentColor"/><circle cx="105" cy="55" r="3" fill="currentColor"/><text x="198" y="101" font-size="12">x</text><text x="45" y="22" font-size="12">y</text></svg>';
}

function mcqAnswered(x) {
  const correctLetter = x.answer || '';
  return (
    '<div class="q">' +
    '<div class="qhead"><span class="qnum">' + x.number + '.</span> ' + inl(x.text) +
    ' <span class="mk">(' + x.marks + (x.marks === 1 ? ' mk)' : ' mks)') + '</span></div>' +
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
      svg(p.diagram) +
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.subject)} — ${esc(d.grade)}</title><style>
@page { size: A4; margin: 13mm 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Times New Roman', Times, 'Liberation Serif', serif; font-size: 12.6pt; line-height: 1.3; color: #111; }

.school { text-align: center; font-weight: bold; font-size: 13.2pt; margin-top: 0; }
.rule { border-top: 1.5px solid #111; margin: 3px 0 4px; }
.title { text-align: center; font-weight: bold; font-size: 14.2pt; letter-spacing: 0.4px; text-transform: uppercase; }
.subtitle { text-align: center; font-size: 9.8pt; font-style: italic; margin-top: 0; }

.candidate {
  border: 1.4px solid #111;
  padding: 3px 10px;
  margin: 5px 0 5px;
  text-align: center;
  display: block;
}
.candidate .field { font-size: 9.2pt; }
.candidate .field b {
  text-transform: uppercase;
  font-size: 7.2pt;
  letter-spacing: 0.4px;
  color: #333;
  display: block;
  margin-bottom: 0;
}
.candidate .value { font-size: 10.8pt; font-weight: bold; }

.instructions { font-size: 9.2pt; font-style: italic; margin: 0 0 5px; text-align: center; }

.sechead { background: #111; color: #fff; font-weight: bold; font-size: 11.6pt; text-transform: uppercase; padding: 3px 10px; margin: 5px 0 2px; letter-spacing: 0.3px; }
.sechead.pagebreak { break-before: page; page-break-before: always; margin-top: 0; }
.secmarks { float: right; font-weight: normal; }
.secinst { font-size: 9.2pt; font-style: italic; margin: 2px 0 7px; }

.q { break-inside: avoid; margin-bottom: 3px; }
.secA-columns { column-count: 2; column-gap: 28px; column-rule: 2.5px solid #111; }
.secA-columns .q { break-inside: avoid-column; }
.qhead { margin-bottom: 2px; }
.qnum { font-weight: bold; }
.substrand { font-weight: bold; }
.mk { float: right; font-weight: normal; font-style: italic; color: #333; }

.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 14px; margin: 2px 0 0 18px; line-height: 1.2; }
.opt { font-size: 11.6pt; display: flex; align-items: center; gap: 5px; margin: 0; color: inherit; }
.opt.correct { color: inherit; font-weight: normal; }
.option-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25em;
  height: 1.25em;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: #111;
  font-weight: bold;
  flex-shrink: 0;
}
.option-label.selected {
  border-color: #111;
  background: #fff;
  color: #111;
  box-shadow: 0 0 0 1.5px rgba(17,17,17,0.1);
}
.option-text { line-height: 1.15; }

.part { margin: 4px 0 5px 20px; }
.plabel { font-weight: bold; }

.frac { display: inline-flex; flex-direction: column; text-align: center; vertical-align: middle; line-height: 1; margin: 0 3px; font-size: 0.92em; }
.fnum { border-bottom: 1.2px solid #111; padding: 0 4px 1px; }
.fden { padding-top: 1px; }

.diagram { display: block; width: 110px; height: 52px; margin: 3px 0 3px 2px; }

.ans-filled { margin: 3px 0 0 0; }
.ansline {
  border-bottom: 1px dotted #3d3d3d;
  min-height: 15px;
  line-height: 15px;
  position: relative;
}
.ansline.has-answer { border-bottom: 1px solid #555; }
.filled-answer { display: inline-block; font-size: 9.8pt; color: #183d22; font-weight: bold; white-space: nowrap; }

.q { break-inside: avoid; margin-bottom: 3px; }
.part { margin: 4px 0 4px 20px; }

.footnote { display: none; }
</style></head><body>

<div class="school">${esc(d.school)}</div>
<div class="rule"></div>
<div class="title">${esc(d.subject)} — ${esc(d.grade)}</div>
<div class="subtitle">${esc(d.strand)}</div>

<div class="candidate">
  <span class="field"><b>MARKING SCHEME</b></span>
</div>

<div class="instructions">Teacher copy: answers shown in the actual paper layout.</div>

<div class="sechead">Section A — Multiple Choice Questions<span class="secmarks">${d.section_a.marks} marks</span></div>
<div class="secinst">${esc(d.section_a.instructions)}</div>
${secAWrapOpen}${d.section_a.questions.map(mcqAnswered).join('')}${secAWrapClose}

<div class="sechead pagebreak">Section B — Structured Questions<span class="secmarks">${d.section_b.marks} marks</span></div>
<div class="secinst">${esc(d.section_b.instructions)}</div>
${d.section_b.questions.map(structuredAnswered).join('')}

</body></html>`;
}

module.exports = { buildSchemeHtml };
