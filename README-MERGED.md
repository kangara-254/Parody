# Parody + Exam Generator

This project merges the Parody school portal with the JSS exam/notes PDF renderer.

## Architecture

- React/Vite: school portal and Exam & Notes Generator UI (`src/pages/admin/ExamStudio.tsx`).
- Supabase: learners, classes, subjects, question bank and notes bank.
- `api/generate-pdf.js`: Vercel serverless PDF endpoint (Puppeteer/Chromium). Renders HTML built by `exam-engine/` to a PDF and streams it back. Also reads and caches the school crest once per warm instance and injects it into every document as `crest_data_uri` (see Branding below).
- `exam-engine/`: HTML/CSS renderers, one per document kind, all driven by a JSON content object built in-browser by `ExamStudio.tsx`. All three share the site's real design tokens (see Branding) — Bitter/Inter fonts, maroon/brass palette, the crest watermark — so a printed document reads as the same product as the web app, not a generic handout:
  - `build_html.js` — the question paper (KCSE-style layout: Section A MCQs, Section B structured, candidate box, a hand-gradeable score-circle badge when `maximum_marks` is set).
  - `build_scheme_html.js` — the same paper with model answers filled in (marking scheme, teacher copy); defaults to a "MARKING SCHEME — CONFIDENTIAL" watermark unless overridden.
  - `build_notes_html.js` — lesson notes: definition/example/"try this"/worked-example boxes, key-terms table, diagrams, summary points, an auto-generated table of contents (2+ sections), a consolidated glossary (2+ sections with key terms), and an answer-key appendix for any `revision_questions` given as `{question, answer}`.
  - `diagrams.js` — the exam paper's diagram vocabulary (20 types): `rectangle`, `triangle`, `circle`, `angle`, `coordinate_grid`, `rhythm_pattern`, `solfa_sequence`, `block_diagram`, `simple_circuit`, `particle_diagram`, `lever`, `oblique_cuboid`, `number_line`, `venn`, `bar_chart`, `line_chart`, `pie_chart`, `bearing`, `clock`, `balance_scale`, `blank_grid`. Any MCQ or structured-question part can carry a `diagram` field; the same renderer is shared by the paper and its marking scheme so both always show the same figure. Papers also support `table` (data tables), `photo` (embedded raster images), and `passages`/`passage_ref` (shared comprehension stimuli).
  - `notes_diagrams.js` — the notes engine's diagram vocabulary: a primitive-shape mini-language (`line`, `arrow`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `arc`, `text`) for subject-agnostic figures, auto-numbered as "Figure N." in document order.
  - `shuffle.js` — deterministic per-student shuffling of question and MCQ-option order (seeded by student name+class), used when a personalised batch requests `shuffle: true`; the exam and its scheme always shuffle identically for the same learner.
- JSON is generated in memory by the UI and sent to the PDF endpoint; nobody hand-writes or uploads JSON/roster files for a normal generation.

## Branding

Every generated document shares the web app's actual design tokens (from `tailwind.config.js`), not an invented palette:

- Fonts: Bitter (headings) + Inter (body), loaded the same way `index.html` loads them.
- Colours: maroon `#a3123f` / brass `#a9772c` / ink `#241417`, matching the site's real theme.
- Crest watermark: the same faint, centred `school-crest-maroon.png` treatment as the login page's `.crest-watermark`, embedded in every exam, scheme, and notes PDF via `exam-engine/assets/crest-maroon.png`. Set `content.crest_watermark: false` to omit it on a given document.
- A document can also carry `logo_data_uri` (a small header logo, distinct from the crest watermark) and `watermark` (an optional rotated text stamp, e.g. "DRAFT").

## Supabase setup

Run the complete `supabase/schema.sql` in the Supabase SQL editor (it's safe to re-run against an existing database — the `notes_bank.structured_content` column is added with `add column if not exists`). The relevant tables:

- `question_bank` — MCQ and structured questions, filterable by grade/subject/strand/sub-strand/learning area/difficulty.
- `notes_bank` — lesson notes. `content` is plain text (bullet lines); `structured_content` (jsonb, optional) can additionally carry `definition {term, meaning}`, `example`, `activity`, `diagram`, `key_terms [{term, meaning}]` and `summary_points []` — see `build_notes_html.js`'s schema comment for the exact shape. A note with no `structured_content` still renders fine (as plain bullets); it just won't have the boxed extras.

Admins use **Content Bank** to paste/import JSON arrays for both tables — the notes importer accepts the `structured_content` fields listed above alongside the plain `content` field. Teachers use **Exam & Notes Generator** to filter and build a document.

## Exam & Notes Generator UI notes

- Question selection is split into two independent lists, matching the two sections of the actual paper: **Section A** (MCQs only) and **Section B** (structured questions only), each with its own count target, random-pick, select-all/clear, and search box. What's ticked in each list is exactly what lands in that section — there's no re-slicing of a combined list at generate time.
- Each section, and the notes list, shows a live **estimated page count** next to the selection ("Selected: N (M marks). Est. ~X pages"). This is a heuristic based on the same column/threshold rules the renderers use (e.g. Section A switches to two-column layout past 12 MCQs) — treat it as a planning aid, not an exact page count.
- Notes rows show a **"Rich content"** badge when a note has `structured_content` set.

## Learner-personalised papers

Choose a class and enable **Put learner names on papers**. The generator reads active learners for that class and creates a combined PDF with one personalised paper per learner. No `roster.txt` is required.

## Local development

```bash
npm install
npm run dev
```

For PDF generation locally, the Vercel API function is intended to run through Vercel's Node runtime. Use `vercel dev` if you want to exercise `api/generate-pdf.js` locally.

## Vercel

Deploy this repository as a Vite project. `vercel.json` configures the PDF function with increased memory and execution time. Do not put Supabase service-role keys in client-side environment variables.

## Installing on Android without the Play Store

Two independent ways to get this onto an Android device without a Play Store listing:

### 1. PWA (works today, no build step)

The app is already a installable PWA: `public/manifest.webmanifest`, `public/sw.js`, and icons generated from the school crest (`public/icons/`) are wired into `index.html` and registered in `src/main.tsx`. Once deployed, open the site in Chrome on Android → menu → **Install app** (or **Add to Home Screen**). It installs with its own icon and launches standalone (no browser chrome), same as any installed app — just without a Play Store listing. Nothing further to run; this works as soon as the site is deployed.

### 2. Real native APK via Capacitor (sideloaded, no Play Console account needed)

`capacitor.config.ts` and the `@capacitor/core`/`@capacitor/android`/`@capacitor/cli` dependencies are already in `package.json`. Building the actual `.apk` needs Android Studio and the Android SDK, which only run on your own machine — this repo can't produce the binary by itself. Steps to run locally:

```bash
npm install
npx cap add android      # first time only — generates the android/ project folder
npm run android:sync     # builds the web app and copies it into the native project
npm run android:open     # opens the android/ folder in Android Studio
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The resulting `.apk` (under `android/app/build/outputs/apk/`) can be copied to a phone and installed directly — the phone will prompt to allow "install from this source" the first time, since it isn't from the Play Store. A debug-signed APK is fine for personal/internal sideloading; a release build needs your own signing keystore (Android Studio's Build → Generate Signed Bundle/APK walks through creating one).

Re-run `npm run android:sync` after any web app change and rebuild in Android Studio to update the installed app.
