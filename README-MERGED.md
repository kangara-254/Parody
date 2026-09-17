# Parody + Exam Generator

This project merges the Parody school portal with the JSS exam PDF renderer.

## Architecture

- React/Vite: school portal and Exam & Notes Generator UI.
- Supabase: learners, classes, subjects, question bank and notes bank.
- `/api/generate-pdf.cjs`: Vercel serverless PDF endpoint.
- `exam-engine/`: the original HTML/CSS exam and marking-scheme renderers.
- JSON is generated in memory by the UI and sent to the PDF endpoint; teachers do not create JSON files.

## Supabase setup

Run the complete `supabase/schema.sql` in the Supabase SQL editor. The final section creates:

- `question_bank`
- `notes_bank`

Admins can then open **Content Bank** and paste/import JSON arrays for large datasets. Teachers can use **Exam & Notes Generator** to filter by grade, subject, strand, sub-strand and learning area.

## Learner-personalised papers

Choose a class and enable **Put learner names on papers**. The generator reads active learners for that class and creates a combined PDF with one personalised paper per learner. No `roster.txt` is required.

## Local development

```bash
npm install
npm run dev
```

For PDF generation locally, the Vercel API function is intended to run through Vercel's Node runtime. Use `vercel dev` if you want to exercise `/api/generate-pdf.cjs` locally.

## Vercel

Deploy this repository as a Vite project. `vercel.json` configures the PDF function with increased memory and execution time. Do not put Supabase service-role keys in client-side environment variables.
