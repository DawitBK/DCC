'use client';

import { useState, type ComponentType } from 'react';
import type { ContentMediaDto, SocialAccountDto, SocialPlatform } from '@dcc/contracts';
import { PLATFORM_LABELS } from '@/lib/labels';
import { NETWORK_RULES, networkWarnings } from '@/lib/networks';
import { FacebookPreview } from './facebook-preview';
import { InstagramPreview } from './instagram-preview';
import { LinkedInPreview } from './linkedin-preview';
import type { NetworkPreviewProps } from './preview-parts';
import { TikTokPreview } from './tiktok-preview';
import { XPreview } from './x-preview';
import { YouTubePreview } from './youtube-preview';

const TEXT = {
  honest: 'Preview. The network may show it slightly differently.',
  choose: 'Preview for account',
  noAccounts: 'Choose at least one account to see how the post would look there.',
  counter: (used: number, limit: number) => `${used} / ${limit} characters`,
  hasWarning: 'needs attention',
  ok: 'Nothing found that this network would refuse.',
};

const PREVIEWS: Record<SocialPlatform, ComponentType<NetworkPreviewProps>> = {
  facebook: FacebookPreview,
  instagram: InstagramPreview,
  linkedin: LinkedInPreview,
  x: XPreview,
  tiktok: TikTokPreview,
  youtube: YouTubePreview,
};

/**
 * The post as the network of each target account would lay it out, one account at a time, with that
 * network character count and warnings. It only imitates the layout; it never calls a network.
 */
export function PostPreviews({
  accounts,
  body,
  media,
}: {
  /** The accounts the post is for. */
  accounts: SocialAccountDto[];
  body: string;
  media: ContentMediaDto[];
}) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  if (accounts.length === 0) return <p className="np-note">{TEXT.noAccounts}</p>;
  const account = accounts.find((item) => item.id === chosenId) ?? accounts[0]!;
  const rule = NETWORK_RULES[account.platform];
  const warnings = networkWarnings(account.platform, body, media);
  const used = body.trim().length;
  const Preview = PREVIEWS[account.platform];

  return (
    <div className="np-wrap">
      {accounts.length > 1 && (
        <div className="np-tabs" role="group" aria-label={TEXT.choose}>
          {accounts.map((item) => {
            const flagged = networkWarnings(item.platform, body, media).length > 0;
            return (
              <button
                key={item.id}
                type="button"
                className="np-tab"
                aria-pressed={item.id === account.id}
                onClick={() => setChosenId(item.id)}
              >
                {PLATFORM_LABELS[item.platform]}
                <span className="np-tab-sub">{item.displayName}</span>
                {flagged && (
                  <span className="np-tab-flag">
                    <span aria-hidden="true">!</span>
                    <span className="visually-hidden">{TEXT.hasWarning}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="np-meta">
        <strong>
          {PLATFORM_LABELS[account.platform]} · {account.displayName}
        </strong>
        <span className={`np-counter ${used > rule.limit ? 'np-counter-over' : ''}`}>
          {TEXT.counter(used, rule.limit)}
        </span>
      </div>
      <div role="status" aria-live="polite">
        {warnings.map((warning) => (
          <p key={warning} className="np-warning">
            <span aria-hidden="true">!</span> {warning}
          </p>
        ))}
      </div>
      {/* The key resets "see more" when another account is chosen. */}
      <Preview key={account.id} account={account} body={body} media={media} />
      <p className="np-note">
        {warnings.length === 0 ? `${TEXT.ok} ` : ''}
        {TEXT.honest}
      </p>
    </div>
  );
}
