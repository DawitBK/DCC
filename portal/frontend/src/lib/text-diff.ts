/**
 * A readable difference between two versions of a post, word by word. Nothing here talks to the API: it
 * only compares two strings (and two lists of ids) the screen already holds.
 */
export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

/** Above this many words on either side the exact comparison is skipped (it grows with the product of both). */
const MAX_WORDS = 3000;

function tokens(text: string): string[] {
  // Words and the white space between them, so the result can be joined back into the original text.
  return text.split(/(\s+)/).filter((part) => part !== '');
}

function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.kind === part.kind) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

/** Longest common subsequence of words; what is left over on each side is "removed" and "added". */
export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
    return merge([
      ...(before ? [{ kind: 'removed' as const, text: before }] : []),
      ...(after ? [{ kind: 'added' as const, text: after }] : []),
    ]);
  }
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      parts.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      parts.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) parts.push({ kind: 'removed', text: a[i++]! });
  while (j < b.length) parts.push({ kind: 'added', text: b[j++]! });
  return merge(parts);
}

/** What changed between two lists of ids (accounts, files): what is new, what is gone, what stayed. */
export function diffIds(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[]; kept: string[] } {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
    kept: after.filter((id) => before.includes(id)),
  };
}
