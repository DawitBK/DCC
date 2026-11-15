import type { StatusLabel, Tone } from '@/lib/labels';

/**
 * A status as a coloured chip. The words are always there: colour is never the only signal.
 * Give it an entry from `@/lib/labels` (`status={CONTENT_STATUS[item.status]}`) or a label and a tone.
 */
export function StatusChip({
  status,
  label,
  tone,
}: {
  status?: StatusLabel;
  label?: string;
  tone?: Tone;
}) {
  const text = status?.label ?? label ?? '';
  const colour = status?.tone ?? tone ?? 'gray';
  return <span className={`status status-${colour}`}>{text}</span>;
}
