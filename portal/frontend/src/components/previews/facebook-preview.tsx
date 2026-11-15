import { NETWORK_RULES } from '@/lib/networks';
import {
  PREVIEW_TEXT,
  PreviewActions,
  PreviewAvatar,
  PreviewMediaGrid,
  PreviewText,
  type NetworkPreviewProps,
} from './preview-parts';

const TEXT = { audience: 'Public', actions: ['Like', 'Comment', 'Share'] };

/** Facebook feed layout: page name and time, text above the media, media grid, action row. */
export function FacebookPreview({ account, body, media }: NetworkPreviewProps) {
  const rule = NETWORK_RULES.facebook;
  return (
    <article className="np-post np-facebook">
      <header className="np-head">
        <PreviewAvatar name={account.displayName} />
        <div>
          <strong>{account.displayName}</strong>
          <small>
            {PREVIEW_TEXT.now} · {TEXT.audience}
          </small>
        </div>
      </header>
      <PreviewText body={body} cutoff={rule.cutoff} limit={rule.limit} />
      <PreviewMediaGrid media={media} />
      <PreviewActions labels={TEXT.actions} />
    </article>
  );
}
