// notes_diagrams.js — renders the notes engine's diagram mini-language:
// small vector drawings built from primitive shapes (line, arrow, rect,
// circle, ellipse, polygon, polyline, arc, text), so the engine stays
// subject-agnostic.
// Ported from notes_engine.py's build_diagram_drawing(). Coordinate origin
// is the TOP-LEFT of the canvas (matches SVG natively — no y-flip needed,
// unlike the exam engine's diagrams.js which ports from PDF/canvas coords).

const PALETTE = {
  navy: '#1B3A63', maroon: '#8B1538', gold: '#C69A2E', text: '#1C1C1C',
  muted: '#5B6672', line: '#B9C2CE', rule: '#D9DEE5', faint: '#EEF1F5',
  band: '#F6F7F9', white: '#FFFFFF', none: 'none',
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dcolor(name, fallback = PALETTE.text) {
  if (name == null) return fallback;
  const key = String(name).toLowerCase();
  if (key in PALETTE) return PALETTE[key];
  if (/^#[0-9a-f]{3,8}$/i.test(name)) return name;
  return fallback;
}

let figureCounter = 0;
function resetFigureCounter() { figureCounter = 0; }

function renderShape(shp) {
  const t = shp.type;
  const stroke = dcolor(shp.stroke || 'text');
  const fill = shp.fill ? dcolor(shp.fill, 'none') : 'none';
  const sw = shp.stroke_width || 1.1;

  if (t === 'line') {
    return `<line x1="${shp.x1}" y1="${shp.y1}" x2="${shp.x2}" y2="${shp.y2}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (t === 'arrow') {
    const { x1, y1, x2, y2 } = shp;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 7, spread = Math.PI * (25 / 180);
    const hx1 = x2 - head * Math.cos(angle - spread), hy1 = y2 - head * Math.sin(angle - spread);
    const hx2 = x2 - head * Math.cos(angle + spread), hy2 = y2 - head * Math.sin(angle + spread);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>` +
      `<polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${stroke}"/>`;
  }
  if (t === 'rect') {
    return `<rect x="${shp.x}" y="${shp.y}" width="${shp.w}" height="${shp.h}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`;
  }
  if (t === 'circle') {
    return `<circle cx="${shp.cx}" cy="${shp.cy}" r="${shp.r}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`;
  }
  if (t === 'ellipse') {
    return `<ellipse cx="${shp.cx}" cy="${shp.cy}" rx="${shp.rx}" ry="${shp.ry}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`;
  }
  if (t === 'polygon') {
    const pts = (shp.points || []).map(p => p.join(',')).join(' ');
    return `<polygon points="${pts}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`;
  }
  if (t === 'polyline') {
    const pts = (shp.points || []).map(p => p.join(',')).join(' ');
    return `<polyline points="${pts}" stroke="${stroke}" fill="none" stroke-width="${sw}"/>`;
  }
  if (t === 'arc') {
    // Circular sector (pie-chart slice) or bare arc when fill is omitted.
    // angles in degrees, 0 = up, clockwise — matches the exam engine's
    // bearing/clock conventions so authors don't have to think in radians.
    const { cx, cy, r, startAngle = 0, endAngle = 90 } = shp;
    const toXY = (deg) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    const [x1, y1] = toXY(startAngle), [x2, y2] = toXY(endAngle);
    const largeArc = ((endAngle - startAngle + 360) % 360) > 180 ? 1 : 0;
    const asSector = shp.sector !== false;
    const d = asSector
      ? `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
      : `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    return `<path d="${d}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`;
  }
  if (t === 'text') {
    const anchor = { left: 'start', center: 'middle', right: 'end' }[shp.align || 'left'] || 'start';
    const color = dcolor(shp.color || 'text');
    const size = shp.size || 8;
    return `<text x="${shp.x}" y="${shp.y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif">${esc(shp.text)}</text>`;
  }
  return '';
}

// buildDiagramSvg(spec, maxWidth) -> SVG markup, scaled down to fit
// maxWidth if the requested width is wider than the text column.
function buildDiagramSvg(spec, maxWidth) {
  const reqW = spec.width || 260;
  const reqH = spec.height || 150;
  const scale = reqW > maxWidth ? maxWidth / reqW : 1;
  const width = reqW * scale, height = reqH * scale;
  const shapesSvg = (spec.shapes || []).map(shp => {
    if (scale === 1) return renderShape(shp);
    return renderShape(scaleShape(shp, scale));
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapesSvg}</svg>`;
}

function scaleShape(shp, scale) {
  const scaled = { ...shp };
  ['x1', 'y1', 'x2', 'y2', 'x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'rx', 'ry'].forEach(k => {
    if (typeof scaled[k] === 'number') scaled[k] = scaled[k] * scale;
  });
  if (shp.stroke_width) scaled.stroke_width = shp.stroke_width * scale;
  if (shp.size) scaled.size = shp.size * scale;
  if (shp.points) scaled.points = shp.points.map(([x, y]) => [x * scale, y * scale]);
  return scaled;
}

// diagramFlowable(spec, maxWidth) -> HTML block: centred figure + an
// auto-numbered caption ("Figure N."), incrementing a module-level counter
// so numbering runs in document order — call resetFigureCounter() once per
// document render before the first diagram.
function diagramFlowable(spec, maxWidth) {
  figureCounter += 1;
  const svg = buildDiagramSvg(spec, maxWidth);
  const captionText = spec.caption || '';
  const label = captionText
    ? `<b>Figure ${figureCounter}.</b> ${esc(captionText)}`
    : `<b>Figure ${figureCounter}.</b>`;
  return `<div class="diagram-block"><div class="diagram-figure">${svg}</div><div class="diagram-caption">${label}</div></div>`;
}

module.exports = { buildDiagramSvg, diagramFlowable, resetFigureCounter };
