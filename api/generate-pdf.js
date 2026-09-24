const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { buildHtml } = require('../exam-engine/build_html');
const { buildSchemeHtml } = require('../exam-engine/build_scheme_html');
const { buildNotesHtml } = require('../exam-engine/build_notes_html');
const { shuffleContentForStudent } = require('../exam-engine/shuffle');
const { createClient } = require('@supabase/supabase-js');

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function launch() {
  return puppeteer.launch({args:chromium.args,defaultViewport:chromium.defaultViewport,executablePath:await chromium.executablePath(),headless:'shell'});
}
function footerTemplate(text){return `<div style="font-family:Georgia,'Bitter',serif;font-size:8.5pt;color:#5c1026;width:100%;text-align:center;border-top:1px solid rgba(36,20,23,0.15);margin:0 16mm;padding-top:3px;">${esc(text||'')} &nbsp;&bull;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`}

// The school crest, embedded once as a data URI and reused for every
// render in this warm function instance — so every generated document
// (exam, scheme, notes) can carry the same quiet full-bleed watermark the
// login page uses, without re-reading the file from disk on every request.
let cachedCrestDataUri = null;
function getCrestDataUri() {
  if (cachedCrestDataUri) return cachedCrestDataUri;
  try {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'exam-engine', 'assets', 'crest-maroon.png'));
    cachedCrestDataUri = 'data:image/png;base64,' + bytes.toString('base64');
  } catch (err) {
    console.error('crest asset missing, continuing without watermark:', err.message);
    cachedCrestDataUri = '';
  }
  return cachedCrestDataUri;
}

// Renders one student's HTML to a PDF buffer on its own page. Multiple
// calls can safely run concurrently against the same `browser` instance —
// Chromium renders separate pages/tabs in parallel; this is what turns a
// personalised batch from N sequential renders into N/CONCURRENCY.
async function renderOne(browser, html, footerText) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(footerText),
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await page.close();
  }
}

// Runs `fn` over `items` with at most `limit` in flight at once, returning
// results in the SAME order as `items` regardless of finish order — the
// roster order must survive concurrent rendering. Caps concurrency so a
// large class (100+ learners) doesn't open that many Chromium pages at
// once and exhaust the function's memory/CPU allotment.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// 5 concurrent Chromium pages fits comfortably inside the 2048MB / 60s
// budget in vercel.json for A4 text+SVG pages. Raise cautiously — each
// concurrent page costs real memory, and the function has a hard ceiling.
const RENDER_CONCURRENCY = 5;

module.exports = async function handler(req,res){
  if(req.method!=='POST'){res.statusCode=405;return res.end('Method not allowed');}
  let browser;
  try{
    const supabaseUrl=process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey=process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const auth=req.headers.authorization || '';
    if(!supabaseUrl || !supabaseKey || !auth.startsWith('Bearer ')){res.statusCode=401;return res.end('Authentication required');}
    const sb=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await sb.auth.getUser();
    if(userError || !user){res.statusCode=401;return res.end('Invalid session');}
    const d=req.body && typeof req.body==='object' ? req.body : JSON.parse(req.body||'{}');
    const kind=d.kind||'exam';
    const base=d.content||{};
    // Brand watermark on by default (matches the login page's quiet
    // full-bleed crest) — set content.crest_watermark: false to turn it
    // off for a given document.
    if (base.crest_watermark !== false && !base.crest_data_uri) base.crest_data_uri = getCrestDataUri();
    const students=Array.isArray(d.students)&&d.students.length?d.students:[null];
    const isBatch = students.length>1 || d.batch;

    browser=await launch();

    const buffers = await mapWithConcurrency(students, RENDER_CONCURRENCY, async (student) => {
      const content={...base};
      if(student){content.student_name=String(student.name||'').toUpperCase();content.student_class=student.cls||student.class_name||'';}
      // Per-student shuffle only applies to exam/scheme (not notes), and
      // only when there's an actual student identity to seed on — that's
      // what makes the exam and its scheme shuffle identically for the
      // same learner across two separate requests.
      const rendered = (d.shuffle && student && kind!=='notes')
        ? shuffleContentForStudent(content, `${student.name||''}|${student.cls||student.class_name||''}`)
        : content;
      const html=kind==='scheme'?buildSchemeHtml(rendered):kind==='notes'?buildNotesHtml(rendered):buildHtml(rendered);
      return renderOne(browser, html, rendered.footer);
    });

    if (!isBatch) {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename="'+(kind==='notes'?'notes':kind==='scheme'?'marking-scheme':'exam')+'.pdf"');
      return res.end(buffers[0]);
    }

    // Merging into the combined document is kept strictly sequential and
    // in roster order — `combined` is one shared PDFDocument, and
    // interleaving copyPages()/addPage() calls across concurrent promises
    // would race on its internal state (rendering above is what's
    // parallel; this merge step is cheap and doesn't need to be).
    const combined = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const pages = await combined.copyPages(doc, doc.getPageIndices());
      pages.forEach(p=>combined.addPage(p));
    }
    const out = await combined.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="personalised-exams.pdf"');
    return res.end(Buffer.from(out));
  }catch(err){
    console.error(err);
    res.statusCode=500;res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({error:err.message||String(err)}));
  } finally {
    // Always close the browser, including on error — the old code left
    // it running (and leaking memory in the container) if any render in
    // the loop threw partway through a batch.
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
};
