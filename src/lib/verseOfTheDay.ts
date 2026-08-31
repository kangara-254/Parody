// Verse of the day for the login page.
//
// Design note: this is intentionally simple and self-contained.
// - No network calls, no database — everything lives in this one array.
// - The verse changes once per calendar day (same verse for everyone,
//   all day), then moves to the next one in the list, looping back to
//   the start after the last verse.
// - If you ever edit VERSES below, keep each entry as a plain string
//   with matched quote marks. A broken quote/comma here is the only
//   realistic way this feature could break the login page, so take
//   care when editing.

export const VERSES: { text: string; ref: string }[] = [
  {
    text: "I can do all this through him who gives me strength.",
    ref: "Philippians 4:13",
  },
  {
    text: "Trust in the LORD with all your heart and lean not on your own understanding.",
    ref: "Proverbs 3:5",
  },
  {
    text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.",
    ref: "Joshua 1:9",
  },
  {
    text: "Start children off on the way they should go, and even when they are old they will not turn from it.",
    ref: "Proverbs 22:6",
  },
  {
    text: "Your word is a lamp for my feet, a light on my path.",
    ref: "Psalm 119:105",
  },
];

// Picks a verse based on today's date, so it's stable all day and the
// same for every visitor, then rotates to the next one tomorrow.
export function verseOfTheDay(): { text: string; ref: string } {
  const now = new Date();
  // Days since epoch, in the visitor's local timezone.
  const dayNumber = Math.floor(now.getTime() / 86400000);
  const index = ((dayNumber % VERSES.length) + VERSES.length) % VERSES.length;
  return VERSES[index];
}
