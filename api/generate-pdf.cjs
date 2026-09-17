const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { buildHtml } = require('../exam-engine/build_html');
const { buildSchemeHtml } = require('../exam-engine/build_scheme_html');
const { createClient } = require('@supabase/supabase-js');

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function notesHtml(d) {
  const sections = Array.isArray(d.sections) ? d.sections : [];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:15mm 16mm 16mm}*{box-sizing:border-box}body{font-family:'Times New Roman',Times,serif;color:#111;font-size:12.5pt;line-height:1.45}.school{text-align:center;font-weight:bold;font-size:15pt}.rule{border-top:1.5px solid #111;margin:4px 0 7px}.title{text-align:center;font-weight:bold;font-size:17pt;text-transform:uppercase}.subtitle{text-align:center;font-size:10.5pt;font-style:italic;margin:2px 0 10px}.section{break-inside:avoid;margin:0 0 13px}.head{font-size:14pt;font-weight:bold;border-bottom:1px solid #111;padding-bottom:3px;margin-bottom:6px}.body p{margin:5px 0}.body ul,.body ol{margin-top:4px}.box{border:1px solid #777;padding:8px 10px;margin:7px 0}.question{margin:7px 0}.answer{margin:3px 0 0 15px;font-style:italic}.footer{border-top:1px solid #999;margin-top:14px;padding-top:3px;text-align:center;font-size:8.5pt;color:#333}
</style></head><body><div class="school">${esc(d.school || '')}</div><div class="rule"></div><div class="title">${esc(d.title || d.subject || 'Learning Notes')}</div><div class="subtitle">${esc([d.grade,d.subject,d.strand,d.sub_strand].filter(Boolean).join(' • '))}</div>${sections.map(s=>`<section class="section"><div class="head">${esc(s.heading || '')}</div><div class="body">${s.html || esc(s.text || '').replace(/\n\n/g,'</p><p>').replace(/^/,'<p>').replace(/$/,'</p>')}</div></section>`).join('')}<div class="footer">${esc(d.footer || 'LEARNER NOTES')}</div></body></html>`;
}
async function launch() {
  return puppeteer.launch({args:chromium.args,defaultViewport:chromium.defaultViewport,executablePath:await chromium.executablePath(),headless:'shell'});
}
function footerTemplate(text){return `<div style="font-family:'Times New Roman',Times,serif;font-size:8.5pt;color:#333;width:100%;text-align:center;border-top:1px solid #999;margin:0 16mm;padding-top:3px;">${esc(text||'')} &nbsp;&bull;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`}
module.exports = async function handler(req,res){
  if(req.method!=='POST'){res.statusCode=405;return res.end('Method not allowed');}
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
    const students=Array.isArray(d.students)&&d.students.length?d.students:[null];
    const browser=await launch();
    const combined=students.length>1 || d.batch ? await require('pdf-lib').PDFDocument.create() : null;
    for(const student of students){
      const content={...base};
      if(student){content.student_name=String(student.name||'').toUpperCase();content.student_class=student.cls||student.class_name||'';}
      const html=kind==='scheme'?buildSchemeHtml(content):kind==='notes'?notesHtml(content):buildHtml(content);
      const page=await browser.newPage();
      await page.setContent(html,{waitUntil:'domcontentloaded'});
      const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:footerTemplate(content.footer),margin:{top:'18mm',bottom:'20mm',left:'16mm',right:'16mm'}});
      await page.close();
      if(combined){const doc=await require('pdf-lib').PDFDocument.load(pdf);const pages=await combined.copyPages(doc,doc.getPageIndices());pages.forEach(p=>combined.addPage(p));}
      else {await browser.close();res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="'+(kind==='notes'?'notes':kind==='scheme'?'marking-scheme':'exam')+'.pdf"');return res.end(pdf);}
    }
    const out=await combined.save();await browser.close();res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="personalised-exams.pdf"');return res.end(Buffer.from(out));
  }catch(err){console.error(err);res.statusCode=500;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:err.message||String(err)}));}
};
