/**
 * Calendar date (YYYY-MM-DD) in the user's local time zone.
 * `toISOString()` is UTC, which in India is still "yesterday" until 05:30 IST.
 */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
