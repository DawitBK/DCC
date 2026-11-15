import { NETWORK_RULES } from '@/lib/networks';
import {
  PREVIEW_TEXT,
  PreviewActions,
  PreviewAvatar,
  PreviewFrame,
  PreviewText,
  type NetworkPreviewProps,
} from './preview-parts';

const TEXT = { actions: ['Like', 'Comment', 'Share', 'Save'] };

/** Instagram feed layout: handle on top, the media first (square; 4:5 for a video), caption below. */
export function InstagramPreview({ account, body, media }: NetworkPreviewProps) {
  const rule = NETWORK_RULES.instagram;
  const first = media[0];
  const handle = account.handle.replace(/^@/, '');
  return (
    <article className="np-post np-instagram">
      <header className="np-head">
        <PreviewAvatar name={account.displayName} small />
        <div>
          <strong>{handle}</strong>
        </div>
      </header>
      <PreviewFrame
        shape={first?.kind === 'video' ? 'portrait' : 'square'}
        item={first}
        empty={PREVIEW_TEXT.noMedia}
      >
        {media.length > 1 && (
          <span className="np-badge">{PREVIEW_TEXT.slide(1, media.length)}</span>
        )}
      </PreviewFrame>
      <PreviewActions labels={TEXT.actions} />
      <div className="np-caption">
        <strong>{handle}</strong>
        <PreviewText
          body={body}
          cutoff={rule.cutoff}
          limit={rule.limit}
          moreLabel={PREVIEW_TEXT.more}
        />
      </div>
    </article>
  );
}
