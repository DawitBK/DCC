'use client';

import { useState, type ReactNode } from 'react';
import type { ContentMediaDto, SocialAccountDto } from '@dcc/contracts';
import { initials } from '@/lib/format';
import { mediaUrl } from '@/lib/media';

export const PREVIEW_TEXT = {
  seeMore: 'See more',
  seeLess: 'See less',
  more: 'more',
  emptyText: 'Your text will appear here.',
  noMedia: 'No picture or video yet',
  noVideo: 'No video yet',
  extra: (count: number) => `+${count}`,
  slide: (index: number, total: number) => `${index} / ${total}`,
  now: 'Just now',
  overflow: 'Text beyond the limit',
};

/** What every network preview receives: the account it is for, the text and the files in order. */
export type NetworkPreviewProps = {
  account: SocialAccountDto;
  body: string;
  media: ContentMediaDto[];
};

/** `@handle`, whether the register holds the handle with or without the sign. */
export function atHandle(account: SocialAccountDto): string {
  return account.handle.startsWith('@') ? account.handle : `@${account.handle}`;
}

/** A neutral circle with the account initials. No network artwork is used anywhere in a preview. */
export function PreviewAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`np-avatar ${small ? 'np-avatar-small' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * The text of the post, cut where the network would cut it, with a working "see more".
 * Text beyond `limit` (the longest the network takes) is marked, so it is clear what would not fit.
 */
export function PreviewText({
  body,
  cutoff,
  limit,
  moreLabel = PREVIEW_TEXT.seeMore,
  className = '',
}: {
  body: string;
  cutoff: number | null;
  limit?: number;
  moreLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const text = body.trim();
  if (!text) {
    return <p className={`np-text np-text-empty ${className}`}>{PREVIEW_TEXT.emptyText}</p>;
  }
  const cut = cutoff !== null && text.length > cutoff;
  const shown = cut && !open ? `${text.slice(0, cutoff).trimEnd()}…` : text;
  const fits = limit === undefined ? shown : shown.slice(0, limit);
  const over = limit === undefined ? '' : shown.slice(limit);
  return (
    <p className={`np-text ${className}`}>
      {fits}
      {over && (
        <mark className="np-over" title={PREVIEW_TEXT.overflow}>
          {over}
        </mark>
      )}
      {cut && (
        <>
          {' '}
          <button
            type="button"
            className="np-more"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? PREVIEW_TEXT.seeLess : moreLabel}
          </button>
        </>
      )}
    </p>
  );
}

/** One picture or video, filling its frame. */
export function PreviewMedia({ item }: { item: ContentMediaDto }) {
  return item.kind === 'image' ? (
    <img src={mediaUrl(item)} alt={item.fileName} loading="lazy" />
  ) : (
    <video src={mediaUrl(item)} controls preload="metadata" aria-label={item.fileName} />
  );
}

/** A frame with a fixed shape (`square`, `portrait` 4:5, `tall` 9:16, `wide` 16:9) and what goes in it. */
export function PreviewFrame({
  shape,
  item,
  empty,
  children,
}: {
  shape: 'square' | 'portrait' | 'tall' | 'wide';
  item: ContentMediaDto | undefined;
  /** Shown when there is nothing to put in the frame. */
  empty: string;
  children?: ReactNode;
}) {
  return (
    <div className={`np-frame np-frame-${shape}`}>
      {item ? <PreviewMedia item={item} /> : <span className="np-frame-empty">{empty}</span>}
      {children}
    </div>
  );
}

/** The feed-style grid: one file fills the width, two sit side by side, more show the first four. */
export function PreviewMediaGrid({ media, max = 4 }: { media: ContentMediaDto[]; max?: number }) {
  if (media.length === 0) return null;
  const shown = media.slice(0, max);
  const extra = media.length - shown.length;
  return (
    <div className={`np-grid np-grid-${Math.min(shown.length, 4)}`}>
      {shown.map((item, index) => (
        <div key={item.id} className="np-grid-cell">
          <PreviewMedia item={item} />
          {extra > 0 && index === shown.length - 1 && (
            <span className="np-grid-extra">{PREVIEW_TEXT.extra(extra)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The row of actions under a post. Words only, not buttons: nothing here can be pressed. */
export function PreviewActions({ labels }: { labels: string[] }) {
  return (
    <div className="np-actions" aria-hidden="true">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}
