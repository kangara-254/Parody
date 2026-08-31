// Dashboard greeting -- swaps the static "Good day" eyebrow for
// something with a bit more personality.
//
// Design note: unlike verseOfTheDay (which is date-based and stable
// all day for everyone), this one is randomized per page load, so it
// changes every time someone logs in / lands on the dashboard.

export const GREETINGS: string[] = [
  "Back again",
  "You survived another day",
  "Marks don't enter themselves",
  "Still here, huh",
  "The grind continues",
  "No rest for the graded",
  "Another day, another gradebook",
  "Reporting for duty",
  "The kids are counting on you",
  "Time to make it official",
];

export function randomGreeting(): string {
  const index = Math.floor(Math.random() * GREETINGS.length);
  return GREETINGS[index];
}
