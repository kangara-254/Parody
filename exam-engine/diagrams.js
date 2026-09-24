// diagrams.js — renders the exam engine's diagram mini-language as inline SVG.
// Ported from the Python engine.py `draw_diagram()` (canvas/y-up) to SVG
// (natural y-down), so all geometry below is written directly in SVG's
// top-left-origin coordinate system rather than flipped from PDF coords.
//
// Supported "type" values (unknown types throw, matching engine.py's
// "fail loudly rather than silently drop a diagram" rule):
//   rectangle, triangle, circle, angle, coordinate_grid,
//   rhythm_pattern, solfa_sequence, block_diagram, simple_circuit,
//   particle_diagram, lever, oblique_cuboid, number_line, venn,
//   bar_chart, line_chart, pie_chart, bearing, clock, balance_scale,
//   blank_grid
//
// Every function returns a self-contained <svg class="diagram">...</svg>
// string sized to `spec.height` (default 64) tall, using the caller's
// currentColor (see .diagram { color:#111 } in the exam CSS) so it always
// matches the surrounding black/white KCSE paper style.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// crude but adequate text-width estimate for wrapping short labels inside
// diagrams (no canvas measurement available at HTML-build time)
function approxWidth(text, size) {
  return String(text).length * size * 0.52;
}

function wrapText(text, maxWidth, size) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    const test = current ? current + ' ' + w : w;
    if (approxWidth(test, size) <= maxWidth || !current) {
      current = test;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textEl(x, y, text, opts = {}) {
  const { size = 11, anchor = 'start', weight = 'normal', dy } = opts;
  return `<text x="${x}" y="${y}"${dy ? ` dy="${dy}"` : ''} font-size="${size}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif"${weight === 'bold' ? ' font-weight="bold"' : ''}>${esc(text)}</text>`;
}

function multilineText(x, y, text, maxWidth, opts = {}) {
  const { size = 9, anchor = 'middle', leading = size * 1.15 } = opts;
  const lines = wrapText(text, maxWidth, size);
  return lines.map((line, i) => textEl(x, y + i * leading, line, { ...opts, size })).join('');
}

function arrowMarker(id) {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>`;
}

function wrapSvg(W, H, inner, defs = '') {
  return `<svg class="diagram" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${defs ? `<defs>${defs}</defs>` : ''}${inner}</svg>`;
}

// ---------------------------------------------------------------------
// Individual renderers. Each receives (spec, W, H) and returns inner SVG.
// ---------------------------------------------------------------------

function dRectangle(spec, W, H) {
  const rw = Math.min(W * 0.5, H * 1.6);
  const rh = H * 0.55;
  const cx = W / 2, bottomY = H - 14;
  const rx = cx - rw / 2, ry = bottomY - rh;
  let s = `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
  if (spec.width_label) s += textEl(rx + rw / 2, ry + rh + 12, spec.width_label, { anchor: 'middle', size: 9 });
  if (spec.height_label) s += textEl(rx - 8, ry + rh / 2, spec.height_label, { anchor: 'middle', size: 9, dy: '0.3em' }).replace('<text ', `<text transform="rotate(-90 ${rx - 8} ${ry + rh / 2})" `);
  return s;
}

function dTriangle(spec, W, H) {
  const tw = Math.min(W * 0.5, H * 1.4);
  const th = H * 0.6;
  const cx = W / 2, bottomY = H - 14;
  const x0 = cx - tw / 2, y0 = bottomY;
  const p1 = [x0, y0 - th], p2 = [x0 + tw, y0], p3 = [x0, y0];
  let s = `<polygon points="${p1.join(',')} ${p2.join(',')} ${p3.join(',')}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
  if (spec.base_label) s += textEl((p2[0] + p3[0]) / 2, y0 + 12, spec.base_label, { anchor: 'middle', size: 9 });
  if (spec.height_label) s += textEl(x0 - 8, (p1[1] + p3[1]) / 2, spec.height_label, { anchor: 'middle', size: 9 }).replace('<text ', `<text transform="rotate(-90 ${x0 - 8} ${(p1[1] + p3[1]) / 2})" `);
  if (spec.hyp_label) s += textEl((p1[0] + p2[0]) / 2 + 10, (p1[1] + p2[1]) / 2 - 4, spec.hyp_label, { anchor: 'middle', size: 9 });
  return s;
}

function dCircle(spec, W, H) {
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W * 0.22, H * 0.4);
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="currentColor" stroke-width="1"/>`;
  if (spec.radius_label) s += textEl(cx + r / 2 - 4, cy - 4, spec.radius_label, { size: 9 });
  return s;
}

function dAngle(spec, W, H) {
  const degrees = spec.degrees != null ? spec.degrees : 60;
  const label = spec.label || `${degrees}\u00b0`;
  const vx = W * 0.28, vy = H * 0.8;
  const length = Math.min(W * 0.5, H * 0.85);
  const rad = (degrees * Math.PI) / 180;
  let s = `<line x1="${vx}" y1="${vy}" x2="${vx + length}" y2="${vy}" stroke="currentColor" stroke-width="1.4"/>`;
  s += `<line x1="${vx}" y1="${vy}" x2="${vx + length * Math.cos(rad)}" y2="${vy - length * Math.sin(rad)}" stroke="currentColor" stroke-width="1.4"/>`;
  const arcR = 18;
  const largeArc = degrees > 180 ? 1 : 0;
  s += `<path d="M ${vx + arcR} ${vy} A ${arcR} ${arcR} 0 ${largeArc} 0 ${vx + arcR * Math.cos(rad)} ${vy - arcR * Math.sin(rad)}" fill="none" stroke="currentColor" stroke-width="1"/>`;
  s += textEl(vx + arcR + 6, vy - 10, label, { size: 10 });
  return s;
}

function dCoordinateGrid(spec, W, H) {
  const points = spec.points || [];
  const grid = spec.grid_size || 6;
  const gw = Math.min(W * 0.55, H * 1.3);
  const gh = H * 0.75;
  const gx = W / 2 - gw / 2, gy = (H - gh) / 2;
  const stepX = gw / grid, stepY = gh / grid;
  let s = '';
  for (let i = 0; i <= grid; i++) {
    s += `<line x1="${gx + i * stepX}" y1="${gy}" x2="${gx + i * stepX}" y2="${gy + gh}" stroke="currentColor" stroke-width="0.3" opacity="0.6"/>`;
    s += `<line x1="${gx}" y1="${gy + i * stepY}" x2="${gx + gw}" y2="${gy + i * stepY}" stroke="currentColor" stroke-width="0.3" opacity="0.6"/>`;
  }
  s += `<line x1="${gx}" y1="${gy + gh}" x2="${gx + gw}" y2="${gy + gh}" stroke="currentColor" stroke-width="1"/>`;
  s += `<line x1="${gx}" y1="${gy}" x2="${gx}" y2="${gy + gh}" stroke="currentColor" stroke-width="1"/>`;
  const drawn = points.map(p => [gx + p.x * stepX, gy + gh - p.y * stepY]);
  if (spec.connect && drawn.length > 1) {
    const pts = drawn.map(p => p.join(',')).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
  }
  drawn.forEach((p, i) => {
    s += `<circle cx="${p[0]}" cy="${p[1]}" r="1.6" fill="currentColor"/>`;
    if (points[i].label) s += textEl(p[0] + 4, p[1] - 4, points[i].label, { size: 8 });
  });
  return s;
}

function dRhythmPattern(spec, W, H) {
  const notes = spec.notes || [];
  const n = notes.length || 1;
  const lineY = H * 0.55;
  const margin = 16;
  const step = (W - 2 * margin) / n;
  let s = `<line x1="${margin * 0.5}" y1="${lineY}" x2="${W - margin * 0.5}" y2="${lineY}" stroke="currentColor" stroke-width="0.7"/>`;
  const positions = [];
  notes.forEach((note, i) => {
    const nx = margin + step * i + step / 2;
    positions.push(nx);
    const hollow = note === 'half' || note === 'whole';
    s += `<ellipse cx="${nx}" cy="${lineY}" rx="3.4" ry="2.6" fill="${hollow ? 'white' : 'currentColor'}" stroke="currentColor" stroke-width="1"/>`;
    if (note !== 'whole') s += `<line x1="${nx + 3}" y1="${lineY}" x2="${nx + 3}" y2="${lineY - 16}" stroke="currentColor" stroke-width="1"/>`;
  });
  for (let i = 0; i < notes.length - 1; i++) {
    if (notes[i] === 'eighth' && notes[i + 1] === 'eighth') {
      s += `<line x1="${positions[i] + 3}" y1="${lineY - 16}" x2="${positions[i + 1] + 3}" y2="${lineY - 16}" stroke="currentColor" stroke-width="1.6"/>`;
    }
  }
  positions.forEach((nx, i) => { s += textEl(nx, lineY + 18, String(i + 1), { anchor: 'middle', size: 7 }); });
  return s;
}

function dSolfaSequence(spec, W, H) {
  const seq = spec.sequence || [];
  const durations = spec.durations || seq.map(() => 'crotchet');
  const n = seq.length || 1;
  const margin = 16;
  const step = (W - 2 * margin) / n;
  const baseY = H * 0.55;
  let s = '';
  seq.forEach((syll, i) => {
    const nx = margin + step * i + step / 2;
    s += textEl(nx, baseY, syll, { anchor: 'middle', size: 13, weight: 'bold' });
    const dur = durations[i] || 'crotchet';
    if (dur === 'quaver' || dur === 'semiquaver') {
      s += `<line x1="${nx - 7}" y1="${baseY + 6}" x2="${nx + 7}" y2="${baseY + 6}" stroke="currentColor" stroke-width="1.2"/>`;
      if (dur === 'semiquaver') s += `<line x1="${nx - 7}" y1="${baseY + 9}" x2="${nx + 7}" y2="${baseY + 9}" stroke="currentColor" stroke-width="1.2"/>`;
    } else if (dur === 'minim') {
      s += textEl(nx + 9, baseY, '\u2013', { size: 13 });
    }
  });
  return s;
}

function drawArrowLine(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 5;
  const p1 = [x2 - head * Math.cos(angle - Math.PI / 8), y2 - head * Math.sin(angle - Math.PI / 8)];
  const p2 = [x2 - head * Math.cos(angle + Math.PI / 8), y2 - head * Math.sin(angle + Math.PI / 8)];
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.2"/>` +
    `<polygon points="${x2},${y2} ${p1.join(',')} ${p2.join(',')}" fill="currentColor"/>`;
}

function dBlockDiagram(spec, W, H) {
  const boxes = spec.boxes || [];
  const cycle = !!spec.cycle;
  const n = boxes.length || 1;
  const margin = 18;
  const availW = W - 2 * margin;
  const boxW = Math.min(availW / n * 0.72, 78);
  const gap = n > 1 ? (availW - boxW * n) / (n - 1) : 0;
  const boxH = H * 0.36;
  const by = (H - boxH) / 2 + (cycle ? 6 : 0);
  let s = '';
  const rightEdges = [], leftEdges = [], midYs = [];
  let bx = margin;
  boxes.forEach(label => {
    s += `<rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" fill="none" stroke="currentColor" stroke-width="1.1"/>`;
    s += multilineText(bx + boxW / 2, by + boxH / 2 - 2, label, boxW - 6, { size: 7.5, anchor: 'middle' });
    rightEdges.push(bx + boxW); leftEdges.push(bx); midYs.push(by + boxH / 2);
    bx += boxW + gap;
  });
  for (let i = 0; i < boxes.length - 1; i++) s += drawArrowLine(rightEdges[i], midYs[i], leftEdges[i + 1], midYs[i + 1]);
  if (cycle && boxes.length > 1) {
    const loopY = by + boxH + 14;
    const lx1 = (leftEdges[leftEdges.length - 1] + rightEdges[rightEdges.length - 1]) / 2;
    const lx2 = (leftEdges[0] + rightEdges[0]) / 2;
    s += `<line x1="${lx1}" y1="${by + boxH}" x2="${lx1}" y2="${loopY}" stroke="currentColor" stroke-width="1.1"/>`;
    s += `<line x1="${lx1}" y1="${loopY}" x2="${lx2}" y2="${loopY}" stroke="currentColor" stroke-width="1.1"/>`;
    s += drawArrowLine(lx2, loopY, lx2, by + boxH);
  }
  return s;
}

function dSimpleCircuit(spec, W, H) {
  const state = spec.state || 'closed';
  const lw = Math.min(W * 0.6, H * 1.3);
  const lh = H * 0.5;
  const lx = W / 2 - lw / 2, ly = H * 0.75;
  let s = '';
  const bx1 = lx + lw * 0.4, bx2 = lx + lw * 0.6;
  s += `<line x1="${lx}" y1="${ly}" x2="${bx1}" y2="${ly}" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<line x1="${bx2}" y1="${ly}" x2="${lx + lw}" y2="${ly}" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<line x1="${bx1}" y1="${ly - 7}" x2="${bx1}" y2="${ly + 7}" stroke="currentColor" stroke-width="1.4"/>`;
  s += `<line x1="${bx2}" y1="${ly - 3.5}" x2="${bx2}" y2="${ly + 3.5}" stroke="currentColor" stroke-width="2.4"/>`;
  s += textEl((bx1 + bx2) / 2, ly + 16, 'battery', { anchor: 'middle', size: 7 });
  s += `<line x1="${lx + lw}" y1="${ly}" x2="${lx + lw}" y2="${ly - lh}" stroke="currentColor" stroke-width="1.2"/>`;
  const cx = W / 2;
  s += `<line x1="${lx + lw}" y1="${ly - lh}" x2="${cx + 7}" y2="${ly - lh}" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<circle cx="${cx}" cy="${ly - lh}" r="7" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<line x1="${cx - 5}" y1="${ly - lh - 5}" x2="${cx + 5}" y2="${ly - lh + 5}" stroke="currentColor" stroke-width="1"/>`;
  s += `<line x1="${cx - 5}" y1="${ly - lh + 5}" x2="${cx + 5}" y2="${ly - lh - 5}" stroke="currentColor" stroke-width="1"/>`;
  s += `<line x1="${cx - 7}" y1="${ly - lh}" x2="${lx}" y2="${ly - lh}" stroke="currentColor" stroke-width="1.2"/>`;
  s += textEl(cx, ly - lh - 12, 'bulb', { anchor: 'middle', size: 7 });
  const swY1 = ly - lh * 0.35, swY2 = ly - lh * 0.65;
  s += `<line x1="${lx}" y1="${ly}" x2="${lx}" y2="${swY1}" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<line x1="${lx}" y1="${swY2}" x2="${lx}" y2="${ly - lh}" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<circle cx="${lx}" cy="${swY1}" r="1.3" fill="currentColor"/><circle cx="${lx}" cy="${swY2}" r="1.3" fill="currentColor"/>`;
  if (state === 'open') s += `<line x1="${lx}" y1="${swY1}" x2="${lx + 10}" y2="${swY2 - 5}" stroke="currentColor" stroke-width="1.2"/>`;
  else s += `<line x1="${lx}" y1="${swY1}" x2="${lx}" y2="${swY2}" stroke="currentColor" stroke-width="1.2"/>`;
  s += textEl(lx - 9, (swY1 + swY2) / 2, `switch (${state})`, { size: 6.5, anchor: 'middle' }).replace('<text ', `<text transform="rotate(-90 ${lx - 9} ${(swY1 + swY2) / 2})" `);
  return s;
}

function dParticleDiagram(spec, W, H) {
  const state = spec.state || 'solid';
  const bw = Math.min(W * 0.55, H * 1.3);
  const bh = H * 0.68;
  const bx = W / 2 - bw / 2, by = (H - bh) / 2;
  let s = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="currentColor" stroke-width="1.1"/>`;
  const r = 2.8;
  const dot = (fx, fy) => `<circle cx="${bx + fx * bw}" cy="${by + fy * bh}" r="${r}" fill="currentColor"/>`;
  if (state === 'solid') {
    const cols = 5, rows = 4;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) s += dot((col + 0.5) / cols, (row + 0.5) / rows);
  } else if (state === 'liquid') {
    [[0.1,.15],[0.3,.2],[0.5,.12],[0.7,.22],[0.9,.15],[0.2,.35],[0.4,.4],[0.6,.3],[0.8,.4],[0.95,.28],[0.05,.4],[0.15,.55],[0.35,.6],[0.55,.5],[0.75,.58]]
      .forEach(([fx,fy]) => { s += dot(fx, fy); });
  } else {
    [[0.1,.15],[0.4,.7],[0.8,.2],[0.25,.45],[0.65,.85],[0.9,.5],[0.15,.8],[0.55,.3],[0.75,.65],[0.35,.1]]
      .forEach(([fx,fy]) => { s += dot(fx, fy); });
  }
  s += textEl(W / 2, by + bh + 12, state.toUpperCase(), { anchor: 'middle', size: 7.5 });
  return s;
}

function dLever(spec, W, H) {
  const fulcrumPos = spec.fulcrum_position != null ? spec.fulcrum_position : 0.5;
  const loadLabel = spec.load_label || 'Load';
  const effortLabel = spec.effort_label || 'Effort';
  const bw = W * 0.7;
  const bx0 = W / 2 - bw / 2;
  const beamY = H * 0.6;
  const fx = bx0 + bw * fulcrumPos;
  let s = `<line x1="${bx0}" y1="${beamY}" x2="${bx0 + bw}" y2="${beamY}" stroke="currentColor" stroke-width="1.6"/>`;
  const triH = 14;
  s += `<polygon points="${fx},${beamY} ${fx - 8},${beamY + triH} ${fx + 8},${beamY + triH}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
  s += drawArrowLine(bx0, beamY - 20, bx0, beamY - 2);
  s += textEl(bx0, beamY - 25, loadLabel, { anchor: 'middle', size: 7.5 });
  s += drawArrowLine(bx0 + bw, beamY - 20, bx0 + bw, beamY - 2);
  s += textEl(bx0 + bw, beamY - 25, effortLabel, { anchor: 'middle', size: 7.5 });
  if (spec.load_arm) s += textEl((bx0 + fx) / 2, beamY + triH + 10, spec.load_arm, { anchor: 'middle', size: 7.5 });
  if (spec.effort_arm) s += textEl((fx + bx0 + bw) / 2, beamY + triH + 10, spec.effort_arm, { anchor: 'middle', size: 7.5 });
  return s;
}

function dObliqueCuboid(spec, W, H) {
  const style = spec.style || 'cabinet';
  const angle = ((spec.angle != null ? spec.angle : 45) * Math.PI) / 180;
  const fw = Math.min(W * 0.36, H * 0.95);
  const fh = H * 0.46;
  const depthScale = style === 'cabinet' ? 0.5 : 1.0;
  const depth = fw * 0.7 * depthScale;
  const dx = depth * Math.cos(angle), dy = -depth * Math.sin(angle);
  const fx = W / 2 - (fw + dx) / 2;
  const fy = H * 0.72 - fh;
  const p1 = [fx, fy], p2 = [fx + fw, fy], p3 = [fx + fw, fy + fh], p4 = [fx, fy + fh];
  const q1 = [p1[0] + dx, p1[1] + dy], q2 = [p2[0] + dx, p2[1] + dy], q3 = [p3[0] + dx, p3[1] + dy], q4 = [p4[0] + dx, p4[1] + dy];
  let s = '';
  [[p1,p2],[p2,p3],[p3,p4],[p4,p1]].forEach(([a,b]) => { s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="currentColor" stroke-width="1.2"/>`; });
  [[q1,q2],[q2,q3],[q3,q4],[q4,q1]].forEach(([a,b]) => { s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2"/>`; });
  [[p1,q1],[p2,q2],[p3,q3],[p4,q4]].forEach(([a,b]) => { s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="currentColor" stroke-width="1.2"/>`; });
  if (spec.width_label) s += textEl((p1[0] + p2[0]) / 2, p1[1] + 12, spec.width_label, { anchor: 'middle', size: 7.5 });
  if (spec.height_label) s += textEl(p1[0] - 8, (p1[1] + p4[1]) / 2, spec.height_label, { anchor: 'middle', size: 7.5 }).replace('<text ', `<text transform="rotate(-90 ${p1[0] - 8} ${(p1[1] + p4[1]) / 2})" `);
  if (spec.depth_label) s += textEl((p2[0] + q2[0]) / 2 + 5, (p2[1] + q2[1]) / 2 - 4, spec.depth_label, { size: 7.5 });
  return s;
}

function dNumberLine(spec, W, H) {
  const min = spec.min != null ? spec.min : 0;
  const max = spec.max != null ? spec.max : 10;
  const step = spec.step || 1;
  const points = spec.points || [];
  const margin = 18;
  const y = H * 0.55;
  const x0 = margin, x1 = W - margin;
  const scale = (val) => x0 + ((val - min) / (max - min)) * (x1 - x0);
  let s = '';
  if (spec.highlight_range) {
    const [a, b] = spec.highlight_range;
    s += `<line x1="${scale(a)}" y1="${y}" x2="${scale(b)}" y2="${y}" stroke="currentColor" stroke-width="4" opacity="0.35"/>`;
  }
  s += drawArrowLine(x0 - 6, y, x1 + 6, y);
  for (let v = min; v <= max + 1e-9; v += step) {
    const x = scale(v);
    s += `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="currentColor" stroke-width="1"/>`;
    s += textEl(x, y + 15, String(Math.round(v * 100) / 100), { anchor: 'middle', size: 7 });
  }
  points.forEach(p => {
    const x = scale(p.value);
    s += `<circle cx="${x}" cy="${y}" r="3.2" fill="currentColor"/>`;
    if (p.label) s += textEl(x, y - 9, p.label, { anchor: 'middle', size: 8 });
  });
  return s;
}

function dVenn(spec, W, H) {
  const sets = spec.sets || [{ label: 'A' }, { label: 'B' }];
  const cy = H / 2;
  const r = Math.min(W * 0.26, H * 0.42);
  let s = '';
  if (sets.length <= 2) {
    const overlap = spec.overlap_count != null ? spec.overlap_count : null;
    const c1x = W / 2 - r * 0.55, c2x = W / 2 + r * 0.55;
    s += `<circle cx="${c1x}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    s += `<circle cx="${c2x}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    s += textEl(c1x - r * 0.7, cy - r - 6, sets[0].label || 'A', { anchor: 'middle', size: 9, weight: 'bold' });
    s += textEl(c2x + r * 0.7, cy - r - 6, sets[1].label || 'B', { anchor: 'middle', size: 9, weight: 'bold' });
    if (sets[0].count != null) s += textEl(c1x - r * 0.45, cy, String(sets[0].count), { anchor: 'middle', size: 9 });
    if (sets[1].count != null) s += textEl(c2x + r * 0.45, cy, String(sets[1].count), { anchor: 'middle', size: 9 });
    if (overlap != null) s += textEl(W / 2, cy, String(overlap), { anchor: 'middle', size: 9 });
    if (spec.universe_label) s += textEl(10, 14, spec.universe_label, { size: 8, weight: 'bold' });
  } else {
    const r3 = r * 0.85;
    const centers = [[W / 2, cy - r3 * 0.55], [W / 2 - r3 * 0.65, cy + r3 * 0.4], [W / 2 + r3 * 0.65, cy + r3 * 0.4]];
    centers.forEach((c, i) => {
      s += `<circle cx="${c[0]}" cy="${c[1]}" r="${r3}" fill="none" stroke="currentColor" stroke-width="1.1"/>`;
      const labelPos = [[c[0], c[1] - r3 - 6], [c[0] - r3 - 4, c[1] + r3 * 0.3], [c[0] + r3 + 4, c[1] + r3 * 0.3]][i];
      s += textEl(labelPos[0], labelPos[1], (sets[i] && sets[i].label) || String.fromCharCode(65 + i), { anchor: 'middle', size: 8.5, weight: 'bold' });
    });
  }
  return s;
}

function dBarChart(spec, W, H) {
  const categories = spec.categories || [];
  const values = spec.values || [];
  const max = spec.max || Math.max(1, ...values);
  const margin = { l: 24, r: 8, t: 10, b: 20 };
  const plotW = W - margin.l - margin.r, plotH = H - margin.t - margin.b;
  const n = categories.length || 1;
  const gap = plotW / n * 0.28;
  const barW = plotW / n - gap;
  let s = `<line x1="${margin.l}" y1="${margin.t}" x2="${margin.l}" y2="${H - margin.b}" stroke="currentColor" stroke-width="1"/>`;
  s += `<line x1="${margin.l}" y1="${H - margin.b}" x2="${W - margin.r}" y2="${H - margin.b}" stroke="currentColor" stroke-width="1"/>`;
  categories.forEach((cat, i) => {
    const v = values[i] || 0;
    const bh = (v / max) * plotH;
    const bx = margin.l + i * (plotW / n) + gap / 2;
    const by = H - margin.b - bh;
    s += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    s += textEl(bx + barW / 2, H - margin.b + 11, String(cat), { anchor: 'middle', size: 6.5 });
    s += textEl(bx + barW / 2, by - 3, String(v), { anchor: 'middle', size: 6.5 });
  });
  if (spec.y_label) s += textEl(8, margin.t, spec.y_label, { size: 6.5 }).replace('<text ', `<text transform="rotate(-90 8 ${margin.t})" `);
  return s;
}

function dLineChart(spec, W, H) {
  const xLabels = spec.x_labels || [];
  const series = spec.series || [];
  const allVals = series.flatMap(s => s.values || []);
  const max = spec.max || Math.max(1, ...allVals);
  const min = spec.min != null ? spec.min : Math.min(0, ...allVals);
  const margin = { l: 24, r: 8, t: 10, b: 20 };
  const plotW = W - margin.l - margin.r, plotH = H - margin.t - margin.b;
  const n = xLabels.length || 1;
  const scaleX = (i) => margin.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const scaleY = (v) => H - margin.b - ((v - min) / (max - min || 1)) * plotH;
  let s = `<line x1="${margin.l}" y1="${margin.t}" x2="${margin.l}" y2="${H - margin.b}" stroke="currentColor" stroke-width="1"/>`;
  s += `<line x1="${margin.l}" y1="${H - margin.b}" x2="${W - margin.r}" y2="${H - margin.b}" stroke="currentColor" stroke-width="1"/>`;
  xLabels.forEach((lab, i) => { s += textEl(scaleX(i), H - margin.b + 11, String(lab), { anchor: 'middle', size: 6.5 }); });
  series.forEach(ser => {
    const pts = (ser.values || []).map((v, i) => [scaleX(i), scaleY(v)]);
    s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.3"/>`;
    pts.forEach(p => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="2" fill="currentColor"/>`; });
  });
  return s;
}

function dPieChart(spec, W, H) {
  const slices = spec.slices || [];
  const total = slices.reduce((sum, x) => sum + (x.value || 0), 0) || 1;
  const cx = W * 0.38, cy = H / 2, r = Math.min(W * 0.3, H * 0.42);
  let angle = -Math.PI / 2;
  let s = '';
  slices.forEach(sl => {
    const frac = (sl.value || 0) / total;
    const next = angle + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(next), y2 = cy + r * Math.sin(next);
    const largeArc = frac > 0.5 ? 1 : 0;
    s += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="none" stroke="currentColor" stroke-width="1"/>`;
    angle = next;
  });
  const legendX = W * 0.7;
  slices.forEach((sl, i) => {
    const ly = 12 + i * 12;
    s += `<rect x="${legendX}" y="${ly - 6}" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/>`;
    s += textEl(legendX + 11, ly, `${sl.label || ''} (${sl.value})`, { size: 6.5 });
  });
  return s;
}

function dBearing(spec, W, H) {
  const degrees = spec.angle_degrees != null ? spec.angle_degrees : 0;
  const label = spec.label || `${String(degrees).padStart(3, '0')}\u00b0`;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) * 0.38;
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1"/>`;
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([lab, deg]) => {
    const rad = (deg * Math.PI) / 180;
    const x = cx + (r + 9) * Math.sin(rad), y = cy - (r + 9) * Math.cos(rad);
    s += textEl(x, y + 3, lab, { anchor: 'middle', size: 8, weight: 'bold' });
  });
  s += `<line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>`;
  s += `<line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>`;
  const rad = (degrees * Math.PI) / 180;
  s += drawArrowLine(cx, cy, cx + r * 0.85 * Math.sin(rad), cy - r * 0.85 * Math.cos(rad));
  s += textEl(cx, cy + r + 14, label, { anchor: 'middle', size: 8 });
  return s;
}

function dClock(spec, W, H) {
  const hour = ((spec.hour != null ? spec.hour : 3) % 12);
  const minute = spec.minute || 0;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) * 0.38;
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
  for (let i = 1; i <= 12; i++) {
    const rad = (i * 30 * Math.PI) / 180;
    const x = cx + (r - 10) * Math.sin(rad), y = cy - (r - 10) * Math.cos(rad);
    s += textEl(x, y + 3, String(i), { anchor: 'middle', size: 7 });
  }
  const hourAngle = ((hour + minute / 60) * 30 * Math.PI) / 180;
  const minAngle = (minute * 6 * Math.PI) / 180;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + r * 0.5 * Math.sin(hourAngle)}" y2="${cy - r * 0.5 * Math.cos(hourAngle)}" stroke="currentColor" stroke-width="2.2"/>`;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + r * 0.75 * Math.sin(minAngle)}" y2="${cy - r * 0.75 * Math.cos(minAngle)}" stroke="currentColor" stroke-width="1.3"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="2" fill="currentColor"/>`;
  return s;
}

function dBalanceScale(spec, W, H) {
  const tilt = spec.tilt || 'level';
  const cx = W / 2, pivotY = H * 0.38;
  const tiltDeg = tilt === 'left' ? -12 : tilt === 'right' ? 12 : 0;
  const rad = (tiltDeg * Math.PI) / 180;
  const armLen = W * 0.32;
  const leftX = cx - armLen * Math.cos(rad), leftY = pivotY - armLen * Math.sin(rad);
  const rightX = cx + armLen * Math.cos(rad), rightY = pivotY + armLen * Math.sin(rad);
  let s = `<line x1="${cx}" y1="${pivotY}" x2="${cx}" y2="${H - 16}" stroke="currentColor" stroke-width="1.6"/>`;
  s += `<polygon points="${cx - 14},${H - 16} ${cx + 14},${H - 16} ${cx},${H - 30}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
  s += `<line x1="${leftX}" y1="${leftY}" x2="${rightX}" y2="${rightY}" stroke="currentColor" stroke-width="1.4"/>`;
  [[leftX, leftY, spec.left_label || 'A'], [rightX, rightY, spec.right_label || 'B']].forEach(([px, py, label]) => {
    s += `<line x1="${px}" y1="${py}" x2="${px}" y2="${py + 14}" stroke="currentColor" stroke-width="1"/>`;
    s += `<path d="M ${px - 12} ${py + 14} Q ${px} ${py + 26} ${px + 12} ${py + 14}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    s += textEl(px, py + 24, label, { anchor: 'middle', size: 7.5 });
  });
  return s;
}

function dBlankGrid(spec, W, H) {
  const cols = spec.cols || 10;
  const rows = spec.rows || 8;
  const margin = 8;
  const gw = W - 2 * margin, gh = H - 2 * margin;
  let s = '';
  for (let i = 0; i <= cols; i++) {
    const x = margin + (i / cols) * gw;
    s += `<line x1="${x}" y1="${margin}" x2="${x}" y2="${H - margin}" stroke="currentColor" stroke-width="0.3" opacity="0.6"/>`;
  }
  for (let i = 0; i <= rows; i++) {
    const y = margin + (i / rows) * gh;
    s += `<line x1="${margin}" y1="${y}" x2="${W - margin}" y2="${y}" stroke="currentColor" stroke-width="0.3" opacity="0.6"/>`;
  }
  s += `<rect x="${margin}" y="${margin}" width="${gw}" height="${gh}" fill="none" stroke="currentColor" stroke-width="1"/>`;
  return s;
}

const RENDERERS = {
  rectangle: dRectangle,
  triangle: dTriangle,
  circle: dCircle,
  angle: dAngle,
  coordinate_grid: dCoordinateGrid,
  rhythm_pattern: dRhythmPattern,
  solfa_sequence: dSolfaSequence,
  block_diagram: dBlockDiagram,
  simple_circuit: dSimpleCircuit,
  particle_diagram: dParticleDiagram,
  lever: dLever,
  oblique_cuboid: dObliqueCuboid,
  number_line: dNumberLine,
  venn: dVenn,
  bar_chart: dBarChart,
  line_chart: dLineChart,
  pie_chart: dPieChart,
  bearing: dBearing,
  clock: dClock,
  balance_scale: dBalanceScale,
  blank_grid: dBlankGrid,
};

// renderDiagram(spec) -> SVG markup string, or '' if spec is falsy.
// Throws on an unrecognised spec.type, matching engine.py's "fail loudly"
// rule — a missing diagram on a question that needs one is worse than a
// build error.
function renderDiagram(spec) {
  if (!spec) return '';
  const fn = RENDERERS[spec.type];
  if (!fn) {
    throw new Error(
      `Unknown diagram type: ${JSON.stringify(spec.type)}. Supported types: ` +
      Object.keys(RENDERERS).join(', ') + '.'
    );
  }
  const W = 220;
  const H = spec.height || 110;
  return wrapSvg(W, H, fn(spec, W, H));
}

module.exports = { renderDiagram };
