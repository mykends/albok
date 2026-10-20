// Dates and times in hr-HR formats; weeks start on Monday.

const WEEKDAYS_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
const WEEKDAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

/** "2026-10-21" -> Date at local midnight (no timezone shift). */
export function parseDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "21. 10. 2026." */
export function formatDate(iso: string) {
  const date = parseDate(iso);
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}.`;
}

/** "uto 21. 10. 2026." */
export function formatDateShort(iso: string) {
  return `${WEEKDAYS_SHORT[parseDate(iso).getDay()]} ${formatDate(iso)}`;
}

/** "utorak, 21. listopada" */
export function formatDateLong(date: Date) {
  return date.toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** ISO weekday (1 = Monday) -> "ponedjeljak" */
export function weekdayName(isoWeekday: number) {
  return WEEKDAYS[isoWeekday % 7];
}

/** "08:00:00" -> "08:00" */
export function formatTime(time: string) {
  return time.slice(0, 5);
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('hr-HR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('hr-HR', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export function todayIso(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
