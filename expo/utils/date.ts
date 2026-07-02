/**
 * Date helpers that avoid the UTC-midnight pitfall.
 *
 * `new Date('2026-07-04')` parses as UTC midnight, so formatting it in any
 * timezone west of UTC yields the previous day (wrong weekday labels, panel
 * dates one day early, weekend detection shifted to Sun+Mon). Always parse
 * date-only strings with these helpers.
 */

/** Parse a YYYY-MM-DD (or full ISO) string as *local* time. */
export function parseLocalDate(dateStr: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(dateStr);
}

/** Local YYYY-MM-DD for a Date (today by default). */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD string, computed in local time. */
export function localDayOfWeek(dateStr: string): number {
  return parseLocalDate(dateStr).getDay();
}

/** True if a YYYY-MM-DD string falls on Saturday or Sunday (local). */
export function isWeekendDate(dateStr: string): boolean {
  const day = localDayOfWeek(dateStr);
  return day === 0 || day === 6;
}

/** Short weekday label ("Mon") for a YYYY-MM-DD string, local-safe. */
export function weekdayLabel(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
}

/** Locale date string ("7/4/2026") for a YYYY-MM-DD string, local-safe. */
export function formatLocalDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, options);
}

/**
 * Parse a bedtime/wake time that may be either "HH:MM" or a full ISO
 * datetime ("2026-07-01T23:45:00+00:00") into fractional hours [0, 24).
 * Returns null when unparseable.
 */
export function parseClockHour(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /T(\d{2}):(\d{2})/.exec(value);
  if (iso) {
    // ISO datetime: use the local clock time of that instant.
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.getHours() + d.getMinutes() / 60;
    return Number(iso[1]) + Number(iso[2]) / 60;
  }
  const hm = /^(\d{1,2}):(\d{2})/.exec(value);
  if (hm) {
    const hours = Number(hm[1]);
    const mins = Number(hm[2]);
    if (hours >= 0 && hours < 24 && mins >= 0 && mins < 60) return hours + mins / 60;
  }
  return null;
}

/** Format fractional hours as "HH:MM". */
export function formatClockHour(hours: number): string {
  const h = ((Math.floor(hours) % 24) + 24) % 24;
  const m = Math.round((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Absolute circular distance between two clock times in hours (max 12).
 * Fixes "00:30 vs 22:30 = 22h drift" — the real drift is 2h.
 */
export function clockDistanceHours(a: number, b: number): number {
  const diff = Math.abs(a - b) % 24;
  return diff > 12 ? 24 - diff : diff;
}
