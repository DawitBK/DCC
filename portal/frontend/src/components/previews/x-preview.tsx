import { NETWORK_RULES } from '@/lib/networks';
import {
  PREVIEW_TEXT,
  PreviewActions,
  PreviewAvatar,
  PreviewMediaGrid,
  PreviewText,
  atHandle,
  type NetworkPreviewProps,
} from './preview-parts';

const TEXT = { actions: ['Reply', 'Repost', 'Like', 'Share'] };

/** X layout: avatar at the left, name and handle on one line, the whole text, rounded media grid. */
export function XPreview({ account, body, media }: NetworkPreviewProps) {
  const rule = NETWORK_RULES.x;
  return (
    <article className="np-post np-x">
      <PreviewAvatar name={account.displayName} />
      <div className="np-x-main">
        <header className="np-x-head">
          <strong>{account.displayName}</strong>{' '}
          <small>
            {atHandle(account)} · {PREVIEW_TEXT.now}
          </small>
        </header>
        <PreviewText body={body} cutoff={rule.cutoff} limit={rule.limit} />
        <PreviewMediaGrid media={media} />
        <PreviewActions labels={TEXT.actions} />
      </div>
    </article>
  );
}
