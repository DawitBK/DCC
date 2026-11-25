'use client';

import type { ReactNode } from 'react';
import type { ContentMediaDto, SocialAccountDto, SocialPlatform } from '@dcc/contracts';
import { PLATFORM_LABELS } from '@/lib/labels';
import { formatBytes, mediaUrl } from '@/lib/media';
import { shortId } from '@/lib/format';
import '@/app/screens/work-shared.css';

const TEXT = {
  unknownAccount: (id: string) => `Account ${shortId(id)}`,
  progress: (done: number, needed: number) => `${done} of ${needed} approvals`,
  why: 'Why you cannot do this',
  noMedia: 'No pictures or videos are attached.',
  image: 'Picture',
  video: 'Video',
  openFile: (name: string) => `Open ${name} in a new tab`,
};

/** "Facebook": the network in words. */
export function PlatformChip({ platform }: { platform: SocialPlatform }) {
  return <span className="wk-chip">{PLATFORM_LABELS[platform]}</span>;
}

/** One account as a chip: the network and the name, nothing else. */
export function AccountChip({
  account,
  id,
  warn = false,
}: {
  account: SocialAccountDto | undefined;
  /** The id to show when the account is not on the list the person may read. */
  id?: string;
  warn?: boolean;
}) {
  return (
    <span className={`wk-chip ${warn ? 'wk-chip-warn' : ''}`}>
      {account ? (
        <>
          {PLATFORM_LABELS[account.platform]}
          <small>{account.displayName}</small>
        </>
      ) : (
        TEXT.unknownAccount(id ?? '')
      )}
    </span>
  );
}

/** The accounts a post is for, as chips. */
export function TargetChips({
  ids,
  accounts,
}: {
  ids: readonly string[];
  accounts: readonly SocialAccountDto[];
}) {
  return (
    <span className="wk-chips">
      {ids.map((id) => (
        <AccountChip key={id} id={id} account={accounts.find((account) => account.id === id)} />
      ))}
    </span>
  );
}

/** Only the networks, once each: for a table cell where the account names would not fit. */
export function PlatformChips({
  ids,
  accounts,
}: {
  ids: readonly string[];
  accounts: readonly SocialAccountDto[];
}) {
  const platforms = [
    ...new Set(
      ids.flatMap((id) => {
        const platform = accounts.find((account) => account.id === id)?.platform;
        return platform ? [platform] : [];
      }),
    ),
  ];
  return (
    <span className="wk-chips">
      {platforms.map((platform) => (
        <PlatformChip key={platform} platform={platform} />
      ))}
    </span>
  );
}

/** Why a control is not available to this person, in plain words. Never a silent hole. */
export function WhyBox({
  reasons,
  title = TEXT.why,
}: {
  reasons: readonly string[];
  title?: string;
}) {
  if (reasons.length === 0) return null;
  return (
    <div className="wk-why" role="note">
      <strong>{title}</strong>
      {reasons.length === 1 ? (
        reasons[0]
      ) : (
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "2 of 3 approvals" with a bar. The words carry the meaning; the bar only helps the eye. */
export function ApprovalProgress({ done, needed }: { done: number; needed: number }) {
  const percent = needed > 0 ? Math.min(100, Math.round((done / needed) * 100)) : 0;
  return (
    <span className="wk-progress">
      <span>{TEXT.progress(done, needed)}</span>
      <span
        className="wk-progress-track wk-progress-mini"
        role="progressbar"
        aria-label={TEXT.progress(done, needed)}
        aria-valuemin={0}
        aria-valuemax={needed}
        aria-valuenow={Math.min(done, needed)}
      >
        <span className="wk-progress-fill" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

/** Grey bars while the first answer is on its way. */
export function Skeletons({ rows = 4, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="wk-skeletons" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <span
          key={index}
          className="kit-skeleton"
          style={{ width: index === 0 ? '40%' : undefined }}
        />
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

/** "Nothing here" with what to do next. */
export function EmptyBlock({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="wk-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** The pictures and videos of a version, with their names and sizes. Files load through the API with the session cookie. */
export function MediaGallery({ media }: { media: readonly ContentMediaDto[] }) {
  if (media.length === 0) return <p className="wk-hint">{TEXT.noMedia}</p>;
  return (
    <ul className="wk-gallery">
      {media.map((item) => (
        <li key={item.id}>
          <figure>
            <a
              className="wk-thumb"
              href={mediaUrl(item)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={TEXT.openFile(item.fileName)}
            >
              {item.kind === 'image' ? (
                <img src={mediaUrl(item)} alt="" loading="lazy" />
              ) : (
                <video src={mediaUrl(item)} preload="metadata" muted aria-hidden="true" />
              )}
            </a>
            <figcaption>
              {item.fileName}
              <br />
              {item.kind === 'image' ? TEXT.image : TEXT.video} · {formatBytes(item.sizeBytes)}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
