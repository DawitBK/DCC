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
