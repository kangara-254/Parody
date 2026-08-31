// Login page quote -- replaces the old verse-of-the-day. Rotates on a
// timer while the login page is open (see Login.tsx), rather than
// being fixed for the whole day.

export const QUOTES: string[] = [
  "Discipline is doing it even when no one's grading your effort.",
  "The syllabus doesn't care about your feelings.",
  "Excuses don't fill in the marklist.",
  "Nobody remembers the deadline you almost met.",
  "Comfort zones don't produce report cards.",
  "Consistency beats motivation every single term.",
  "Half-done work is just a longer way to fail.",
  "The class is watching whether you show up or not.",
];

export function randomQuote(): string {
  const index = Math.floor(Math.random() * QUOTES.length);
  return QUOTES[index];
}
