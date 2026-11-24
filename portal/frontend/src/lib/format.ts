/** Small display helpers shared by the screens. */

export function initials(value: string): string {
  return (
    value
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || 'D'
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** The first characters of an id: enough to tell two records apart on screen and to quote. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

export function excerpt(text: string, length = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

/** A reading's date. A plain `YYYY-MM-DD` is a calendar day and is shown as that day in every time zone. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const plainDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return plainDay
    ? date.toLocaleDateString(undefined, { timeZone: 'UTC' })
    : date.toLocaleDateString();
}

/** A reading as the network sent it: grouped digits, no rounding to fewer than six decimals, null = no reading. */
export function formatReading(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : '—';
}

/** A length of time in plain words: "under a minute", "45 min", "2 h 5 min", "3 d 4 h". Negative or missing gives "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
