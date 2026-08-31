import { useEffect, useState } from "react";

// Native <input type="date"> renders in whatever format the device/browser
// locale picks (often mm/dd/yyyy on phones), which is exactly the "bad"
// format the admin flagged. This component always shows dd/mm/yyyy —
// same on a Fedora desktop or a phone -- while still storing/returning a
// plain ISO yyyy-mm-dd string, which is what Postgres `date` columns and
// the rest of the app (term_calendar, report forms) expect.

function isoToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function displayToIso(display: string): string | null {
  const m = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;
  return `${y}-${mo}-${d}`;
}

// Auto-inserts the "/" separators as the admin types digits, e.g.
// "15062026" -> "15/06/2026", so no one has to type the slashes.
function formatAsTyped(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export default function DateField({
  value,
  onChange,
  label,
  className,
}: {
  value: string; // ISO yyyy-mm-dd, or "" if not set
  onChange: (iso: string) => void; // called with "" (cleared) or a complete, valid ISO date
  label?: string;
  className?: string;
}) {
  const [text, setText] = useState(isoToDisplay(value));

  // Keep the visible text in sync if the parent value changes from
  // elsewhere (e.g. switching which term/year is being edited).
  useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatAsTyped(e.target.value);
    setText(formatted);
    if (formatted === "") {
      onChange("");
      return;
    }
    const iso = displayToIso(formatted);
    if (iso) onChange(iso);
    // While the date is still incomplete/invalid we just update the
    // visible text and wait -- we don't push a bad value up to state.
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      maxLength={10}
      value={text}
      onChange={handleChange}
      aria-label={label}
      className={className}
    />
  );
}
