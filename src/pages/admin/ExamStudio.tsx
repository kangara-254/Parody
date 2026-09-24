import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { buildReportRoster } from "../../lib/reportRoster";
import { SUBJECT_GROUPS } from "../../types";

type Question = { id:string; grade:string; subject:string; strand:string|null; sub_strand:string|null; learning_area:string|null; question_type:string; question_text:string; options:any; correct_answer:string|null; marks:number; difficulty:string|null; parts:any; };
type Note = { id:string; grade:string; subject:string; strand:string|null; sub_strand:string|null; learning_area:string|null; title:string; content:string; structured_content:{content?:string[]; definition?:{term:string; meaning:string}; example?:string; activity?:string; diagram?:any; key_terms?:{term:string; meaning:string}[]; summary_points?:string[]}|null; };

type Student={id:string;name:string;class_id:string};

// Rough, clearly-labelled page estimates — mirrors the layout rules baked
// into exam-engine/build_html.js and build_notes_html.js closely enough to
// be useful for planning, not pixel-accurate.
const MCQ_TWO_COL_THRESHOLD = 12;
const MCQ_PER_PAGE_SINGLE_COL = 16;
const MCQ_PER_PAGE_TWO_COL = 30;
function estimateSectionAPages(count:number){if(!count)return 0;const perPage=count>MCQ_TWO_COL_THRESHOLD?MCQ_PER_PAGE_TWO_COL:MCQ_PER_PAGE_SINGLE_COL;return Math.ceil(count/perPage);}
function structuredUnits(q:Question){const parts=Array.isArray(q.parts)&&q.parts.length?q.parts:[{marks:q.marks||1,diagram:null}];return parts.reduce((sum:number,p:any)=>sum+1+Math.max(2,Number(p.marks||1))*0.4+(p.diagram?2.5:0),1);}
const STRUCTURED_UNITS_PER_PAGE = 12;
function estimateSectionBPages(qs:Question[]){if(!qs.length)return 0;const units=qs.reduce((s,q)=>s+structuredUnits(q),0);return Math.ceil(units/STRUCTURED_UNITS_PER_PAGE);}
function noteUnits(n:Note){const sc=n.structured_content||{};const bulletCount=(sc.content&&sc.content.length)||String(n.content||"").split(/\n+/).filter(Boolean).length;return 1+bulletCount*0.35+(sc.definition?1:0)+(sc.example?1:0)+(sc.activity?1:0)+(sc.diagram?2.5:0)+((sc.key_terms?.length||0)*0.3)+((sc.summary_points?.length||0)*0.3);}
const NOTE_UNITS_PER_PAGE = 9;
function estimateNotesPages(ns:Note[]){if(!ns.length)return 0;const units=ns.reduce((s,n)=>s+noteUnits(n),0);return Math.ceil(units/NOTE_UNITS_PER_PAGE);}

export default function ExamStudio(){
 const [mode,setMode]=useState<"exam"|"notes">("exam"); const [questions,setQuestions]=useState<Question[]>([]); const [notes,setNotes]=useState<Note[]>([]); const [classes,setClasses]=useState<any[]>([]); const [students,setStudents]=useState<Student[]>([]); const [subjects,setSubjects]=useState<any[]>([]); const [teachers,setTeachers]=useState<any[]>([]); const [assignments,setAssignments]=useState<any[]>([]); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 const [f,setF]=useState({classId:"",grade:"",subject:"",strand:"",subStrand:"",learningArea:"",countA:16,countB:6,difficulty:"mixed",personalised:true,shuffle:false});
 const [selectedA,setSelectedA]=useState<string[]>([]); const [selectedB,setSelectedB]=useState<string[]>([]); const [noteIds,setNoteIds]=useState<string[]>([]);
 const [qSearch,setQSearch]=useState(""); const [nSearch,setNSearch]=useState("");
 const [logoDataUri,setLogoDataUri]=useState("");
 const handleLogoUpload=(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>setLogoDataUri(String(reader.result||""));reader.readAsDataURL(file);};
 useEffect(()=>{(async()=>{if(!supabase)return;const [q,c,s,l,t,a]=await Promise.all([supabase.from("question_bank").select("*").eq("active",true).order("created_at",{ascending:false}),supabase.from("classes").select("*").order("name"),supabase.from("subjects").select("*").order("name"),supabase.from("notes_bank").select("*").eq("active",true).order("created_at",{ascending:false}),supabase.from("teachers").select("*"),supabase.from("teacher_assignments").select("*")]); if(q.error) setError(q.error.message); setQuestions(q.data||[]);setClasses(c.data||[]);setSubjects(s.data||[]);setNotes(l.data||[]);setTeachers(t.data||[]);setAssignments(a.data||[]);})();},[]);
 useEffect(()=>{(async()=>{if(!supabase||!f.classId)return;const {data,error}=await supabase.from("learners").select("id,name,class_id").eq("class_id",f.classId).eq("status","active").order("name");if(error)setError(error.message);setStudents(data||[]);})();},[f.classId]);
 const grades=useMemo(()=>Array.from(new Set([...questions.map(q=>q.grade),...notes.map(n=>n.grade)].filter(Boolean))).sort(),[questions,notes]);
 const strands=useMemo(()=>Array.from(new Set((mode==="exam"?questions:notes).filter(x=>(!f.grade||x.grade===f.grade)&&(!f.subject||x.subject===f.subject)).map(x=>x.strand).filter(Boolean))).sort(),[mode,questions,notes,f.grade,f.subject]);
 const filteredQ=useMemo(()=>questions.filter(q=>(!f.grade||q.grade===f.grade)&&(!f.subject||q.subject===f.subject)&&(!f.strand||q.strand===f.strand)&&(!f.subStrand||q.sub_strand===f.subStrand)&&(!f.learningArea||q.learning_area===f.learningArea)&&(f.difficulty==="mixed"||q.difficulty===f.difficulty)&&(!qSearch.trim()||q.question_text.toLowerCase().includes(qSearch.trim().toLowerCase()))),[questions,f,qSearch]);
 const filteredN=useMemo(()=>notes.filter(n=>(!f.grade||n.grade===f.grade)&&(!f.subject||n.subject===f.subject)&&(!f.strand||n.strand===f.strand)&&(!f.subStrand||n.sub_strand===f.subStrand)&&(!f.learningArea||n.learning_area===f.learningArea)&&(!nSearch.trim()||n.title.toLowerCase().includes(nSearch.trim().toLowerCase()))),[notes,f,nSearch]);
 // Section A / Section B are now split by actual question_type up front,
 // so what you tick is exactly what lands in each section — no re-slicing
 // a mixed list by index at generate time.
 const filteredQA=useMemo(()=>filteredQ.filter(q=>q.question_type==="mcq"),[filteredQ]);
 const filteredQB=useMemo(()=>filteredQ.filter(q=>q.question_type!=="mcq"),[filteredQ]);
 const pickedA=useMemo(()=>questions.filter(q=>selectedA.includes(q.id)),[questions,selectedA]);
 const pickedB=useMemo(()=>questions.filter(q=>selectedB.includes(q.id)),[questions,selectedB]);
 const marksA=useMemo(()=>pickedA.reduce((s,q)=>s+Number(q.marks||1),0),[pickedA]);
 const marksB=useMemo(()=>pickedB.reduce((s,q)=>s+Number(q.marks||1),0),[pickedB]);
 const pagesA=useMemo(()=>estimateSectionAPages(pickedA.length),[pickedA]);
 const pagesB=useMemo(()=>estimateSectionBPages(pickedB),[pickedB]);
 const pickedNotes=useMemo(()=>notes.filter(n=>noteIds.includes(n.id)),[notes,noteIds]);
 const notesPages=useMemo(()=>estimateNotesPages(pickedNotes),[pickedNotes]);
 const resolvedTeacherName=useMemo(()=>{if(!f.classId||!f.subject)return"";const group=SUBJECT_GROUPS.find(g=>g.subjectNames.includes(f.subject));if(!group)return"";const roster=buildReportRoster({classId:f.classId,subjects,assignments,classTeachers:[],teachers});return roster.subjectTeacherByGroupKey[group.key]||"";},[f.classId,f.subject,subjects,assignments,teachers]);
 const pickRandomA=()=>{setError("");const copy=[...filteredQA].sort(()=>Math.random()-.5);setSelectedA(copy.slice(0,Math.min(f.countA,copy.length)).map(q=>q.id));};
 const pickRandomB=()=>{setError("");const copy=[...filteredQB].sort(()=>Math.random()-.5);setSelectedB(copy.slice(0,Math.min(f.countB,copy.length)).map(q=>q.id));};
 const download=async(kind:string,content:any,studentsArg:any[]=[],shuffle:boolean=false)=>{setBusy(true);setError("");try{const {data:{session}}=await supabase!.auth.getSession(); if(!session) throw new Error("Your session has expired. Please sign in again."); const r=await fetch("/api/generate-pdf",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({kind,content,batch:studentsArg.length>1,students:studentsArg,shuffle})});if(!r.ok)throw new Error(await r.text());const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=kind==="notes"?"learning-notes.pdf":kind==="scheme"?"marking-scheme.pdf":"examination.pdf";a.click();URL.revokeObjectURL(url);}catch(e:any){setError(e.message||"Generation failed")}finally{setBusy(false)}};
 const generateExam=async(kind:"exam"|"scheme")=>{if(!pickedA.length&&!pickedB.length){setError("Select questions for Section A and/or Section B, or use Generate random questions first.");return;}const content={school:"KARIOBANGI SOUTH JUNIOR SCHOOL",subject:f.subject||pickedA[0]?.subject||pickedB[0]?.subject||"",grade:f.grade||pickedA[0]?.grade||pickedB[0]?.grade||"",strand:f.strand||pickedA[0]?.strand||pickedB[0]?.strand||"",duration:"1 Hour",maximum_marks:marksA+marksB,footer:"JUNIOR SCHOOL ASSESSMENT",student_name:"",student_class:classes.find(c=>c.id===f.classId)?.name||"",teacher:resolvedTeacherName,logo_data_uri:logoDataUri||undefined,section_a:{marks:marksA,instructions:"Answer all questions. Choose the correct answer from A, B, C or D.",questions:pickedA.map((q,i)=>({number:i+1,marks:Number(q.marks||1),text:q.question_text,options:Array.isArray(q.options)?q.options:[],answer:q.correct_answer||"A"}))},section_b:{marks:marksB,instructions:"Answer all questions in the spaces provided.",questions:pickedB.map((q,i)=>({number:pickedA.length+i+1,marks:Number(q.marks||1),text:q.question_text,parts:Array.isArray(q.parts)&&q.parts.length?q.parts:[{label:"a)",text:"",marks:Number(q.marks||1),answer:q.correct_answer||""}]}))}};const roster=f.personalised?students.map(s=>({name:s.name,cls:classes.find(c=>c.id===s.class_id)?.name||""})):[];await download(kind,content,roster,f.personalised&&f.shuffle)};
 const generateNotes=async()=>{const picked=notes.filter(n=>noteIds.includes(n.id));if(!picked.length){setError("Select at least one notes topic.");return;}const toBullets=(text:string)=>String(text||"").split(/\n+/).map(s=>s.trim()).filter(Boolean);await download("notes",{school:"KARIOBANGI SOUTH JUNIOR SCHOOL",title:`${f.subject||picked[0].subject} Learning Notes`,grade:f.grade||picked[0].grade,subject:f.subject||picked[0].subject,subtitle:[f.strand||picked[0].strand,f.subStrand||picked[0].sub_strand].filter(Boolean).join(" — "),topic_code:"",logo_data_uri:logoDataUri||undefined,sections:picked.map(n=>{const sc=n.structured_content||{};return{heading:n.title,subsections:[{heading:n.title,content:sc.content&&sc.content.length?sc.content:toBullets(n.content),definition:sc.definition,example:sc.example,activity:sc.activity,diagram:sc.diagram}],key_terms:sc.key_terms,summary_points:sc.summary_points};})},[])};
 return <div><header className="mb-6"><h1 className="font-display text-2xl text-ink">Exam & Notes Generator</h1><p className="text-sm text-ink/60 mt-1">Build material from the school's question and notes banks. JSON is created automatically for the PDF engine.</p></header>
 <div className="flex gap-2 mb-5"><button onClick={()=>setMode("exam")} className={`neu-btn ${mode!=="exam"?"opacity-50":""}`}>Examination</button><button onClick={()=>setMode("notes")} className={`neu-btn ${mode!=="notes"?"opacity-50":""}`}>Learning Notes</button></div>
 <div className="neu-card p-5 mb-5"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 <select className="neu-input" value={f.grade} onChange={e=>setF({...f,grade:e.target.value,strand:"",subStrand:"",learningArea:""})}><option value="">All grades</option>{grades.map(g=><option key={g}>{g}</option>)}</select>
 <select className="neu-input" value={f.subject} onChange={e=>setF({...f,subject:e.target.value,strand:"",subStrand:"",learningArea:""})}><option value="">All subjects</option>{subjects.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}</select>
 <select className="neu-input" value={f.classId} onChange={e=>setF({...f,classId:e.target.value})}><option value="">Select class (for learners)</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
 <select className="neu-input" value={f.strand} onChange={e=>setF({...f,strand:e.target.value,subStrand:"",learningArea:""})}><option value="">All strands</option>{strands.map(s=><option key={s}>{s}</option>)}</select>
 <input className="neu-input" placeholder="Sub-strand" value={f.subStrand} onChange={e=>setF({...f,subStrand:e.target.value})}/><input className="neu-input" placeholder="Learning area" value={f.learningArea} onChange={e=>setF({...f,learningArea:e.target.value})}/>
 <label className="flex items-center gap-2 text-sm"><span className="text-xs text-ink/50">School logo</span><input type="file" accept="image/*" className="neu-input text-xs" onChange={handleLogoUpload}/>{logoDataUri&&<button type="button" className="text-xs text-maroon" onClick={()=>setLogoDataUri("")}>Remove</button>}</label>
 {mode==="exam"&&<><select className="neu-input" value={f.difficulty} onChange={e=>setF({...f,difficulty:e.target.value})}><option value="mixed">Mixed difficulty</option><option>easy</option><option>medium</option><option>hard</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.personalised} onChange={e=>setF({...f,personalised:e.target.checked})}/> Put learner names on papers</label>{f.personalised&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.shuffle} onChange={e=>setF({...f,shuffle:e.target.checked})}/> Shuffle question/option order per learner</label>}</>}
 </div></div>
 {mode==="exam"?<>
 <div className="neu-card p-5 mb-5">
   <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
     <div><h2 className="font-display text-lg">Section A — Multiple Choice</h2><p className="text-xs text-ink/50">{filteredQA.length} matching MCQ(s). Selected: {selectedA.length} ({marksA} mark{marksA===1?"":"s"}). Est. ~{pagesA||0} page{pagesA===1?"":"s"}.</p></div>
     <div className="flex items-center gap-2"><input type="number" min="1" className="neu-input w-20" value={f.countA} onChange={e=>setF({...f,countA:Number(e.target.value)})}/><button className="neu-btn" onClick={pickRandomA}>Random pick</button><button className="neu-btn" onClick={()=>setSelectedA(filteredQA.map(q=>q.id))}>Select all</button><button className="neu-btn" onClick={()=>setSelectedA([])}>Clear</button></div>
   </div>
   <input className="neu-input w-full mb-3" placeholder="Search question text…" value={qSearch} onChange={e=>setQSearch(e.target.value)}/>
   <div className="max-h-72 overflow-auto space-y-2">{filteredQA.slice(0,200).map(q=><label key={q.id} className="block border border-line rounded p-3 text-sm"><input type="checkbox" className="mr-2" checked={selectedA.includes(q.id)} onChange={e=>setSelectedA(e.target.checked?[...selectedA,q.id]:selectedA.filter(id=>id!==q.id))}/><span className="text-[10px] uppercase tracking-wide bg-ink/10 rounded px-1.5 py-0.5 mr-2">MCQ</span><b>{q.subject} · {q.strand||""}</b> — {q.question_text}<span className="text-xs text-ink/40 ml-2">({q.marks} mark{q.marks===1?"":"s"})</span></label>)}{!filteredQA.length&&<p className="text-xs text-ink/40">No MCQs match the current filters.</p>}</div>
 </div>
 <div className="neu-card p-5 mb-5">
   <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
     <div><h2 className="font-display text-lg">Section B — Structured</h2><p className="text-xs text-ink/50">{filteredQB.length} matching structured question(s). Selected: {selectedB.length} ({marksB} mark{marksB===1?"":"s"}). Est. ~{pagesB||0} page{pagesB===1?"":"s"}.</p></div>
     <div className="flex items-center gap-2"><input type="number" min="1" className="neu-input w-20" value={f.countB} onChange={e=>setF({...f,countB:Number(e.target.value)})}/><button className="neu-btn" onClick={pickRandomB}>Random pick</button><button className="neu-btn" onClick={()=>setSelectedB(filteredQB.map(q=>q.id))}>Select all</button><button className="neu-btn" onClick={()=>setSelectedB([])}>Clear</button></div>
   </div>
   <div className="max-h-72 overflow-auto space-y-2">{filteredQB.slice(0,200).map(q=><label key={q.id} className="block border border-line rounded p-3 text-sm"><input type="checkbox" className="mr-2" checked={selectedB.includes(q.id)} onChange={e=>setSelectedB(e.target.checked?[...selectedB,q.id]:selectedB.filter(id=>id!==q.id))}/><span className="text-[10px] uppercase tracking-wide bg-ink/10 rounded px-1.5 py-0.5 mr-2">Structured</span><b>{q.subject} · {q.strand||""}</b> — {q.question_text}<span className="text-xs text-ink/40 ml-2">({q.marks} mark{q.marks===1?"":"s"})</span></label>)}{!filteredQB.length&&<p className="text-xs text-ink/40">No structured questions match the current filters.</p>}</div>
 </div>
 <p className="text-xs text-ink/50 mb-3">Estimated paper length: ~{(pagesA+pagesB)||0} page{(pagesA+pagesB)===1?"":"s"} total ({marksA+marksB} mark{(marksA+marksB)===1?"":"s"}). Estimate only — actual layout can vary slightly.</p>
 <div className="flex gap-2 flex-wrap"><button disabled={busy} className="neu-btn" onClick={()=>generateExam("exam")}>{busy?"Generating…":"Generate examination PDF"}</button><button disabled={busy} className="neu-btn" onClick={()=>generateExam("scheme")}>Generate marking scheme</button></div>
 </>:<>
 <div className="neu-card p-5 mb-5">
   <div className="flex items-center justify-between mb-3 flex-wrap gap-2"><div><h2 className="font-display text-lg">Notes Bank</h2><p className="text-xs text-ink/50">{filteredN.length} matching note topic(s). Selected: {noteIds.length}. Est. ~{notesPages||0} page{notesPages===1?"":"s"}.</p></div><div className="flex items-center gap-2"><button className="neu-btn" onClick={()=>setNoteIds(filteredN.map(n=>n.id))}>Select all</button><button className="neu-btn" onClick={()=>setNoteIds([])}>Clear</button></div></div>
   <input className="neu-input w-full mb-3" placeholder="Search note titles…" value={nSearch} onChange={e=>setNSearch(e.target.value)}/>
   <div className="space-y-2">{filteredN.map(n=><label key={n.id} className="block border border-line rounded p-3 text-sm"><input type="checkbox" className="mr-2" checked={noteIds.includes(n.id)} onChange={e=>setNoteIds(e.target.checked?[...noteIds,n.id]:noteIds.filter(id=>id!==n.id))}/>{n.structured_content&&<span className="text-[10px] uppercase tracking-wide bg-maroon/10 text-maroon rounded px-1.5 py-0.5 mr-2">Rich content</span>}<b>{n.title}</b><div className="text-xs text-ink/50 mt-1">{n.grade} · {n.subject} · {n.strand||""}</div></label>)}{!filteredN.length&&<p className="text-xs text-ink/40">No notes match the current filters.</p>}</div>
 </div>
 <button disabled={busy} className="neu-btn" onClick={generateNotes}>{busy?"Generating…":"Generate notes PDF"}</button>
 </>}
 {error&&<div className="text-sm text-maroon mt-4 bg-maroon/10 border border-maroon/20 rounded p-3">{error}</div>}
 {mode==="exam"&&f.personalised&&f.classId&&<p className="text-xs text-ink/50 mt-4">{students.length} active learner(s) found in the selected class. A personalised paper will be created for each learner in one combined PDF.{f.shuffle&&" Each learner's question and option order is shuffled; generate the exam and its marking scheme together so they stay in sync per learner."}</p>}
 {mode==="exam"&&f.classId&&f.subject&&<p className="text-xs text-ink/50 mt-1">Teacher printed on the paper: <b>{resolvedTeacherName||"— not assigned in Learning Areas / Teacher Assignments —"}</b></p>}
 </div>;
}
