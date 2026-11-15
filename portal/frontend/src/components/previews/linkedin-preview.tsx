import { NETWORK_RULES } from '@/lib/networks';
import {
  PREVIEW_TEXT,
  PreviewActions,
  PreviewAvatar,
  PreviewMediaGrid,
  PreviewText,
  type NetworkPreviewProps,
} from './preview-parts';

const TEXT = { page: 'Company page', actions: ['Like', 'Comment', 'Repost', 'Send'] };

/** LinkedIn feed layout: page name with a line under it, text (cut early), media, action row. */
export function LinkedInPreview({ account, body, media }: NetworkPreviewProps) {
  const rule = NETWORK_RULES.linkedin;
  return (
    <article className="np-post np-linkedin">
      <header className="np-head">
        <PreviewAvatar name={account.displayName} />
        <div>
          <strong>{account.displayName}</strong>
          <small>{TEXT.page}</small>
          <small>{PREVIEW_TEXT.now}</small>
        </div>
      </header>
      <PreviewText
        body={body}
        cutoff={rule.cutoff}
        limit={rule.limit}
        moreLabel={`…${PREVIEW_TEXT.more}`}
      />
      <PreviewMediaGrid media={media} />
      <PreviewActions labels={TEXT.actions} />
    </article>
  );
}
