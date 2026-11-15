import { NETWORK_RULES } from '@/lib/networks';
import {
  PREVIEW_TEXT,
  PreviewAvatar,
  PreviewFrame,
  PreviewText,
  atHandle,
  type NetworkPreviewProps,
} from './preview-parts';

const TEXT = { description: 'Description' };

/** YouTube watch layout: a 16:9 video frame, the channel under it, then the description box. */
export function YouTubePreview({ account, body, media }: NetworkPreviewProps) {
  const rule = NETWORK_RULES.youtube;
  const video = media.find((item) => item.kind === 'video');
  return (
    <article className="np-post np-youtube">
      <PreviewFrame shape="wide" item={video} empty={PREVIEW_TEXT.noVideo} />
      <header className="np-head">
        <PreviewAvatar name={account.displayName} />
        <div>
          <strong>{account.displayName}</strong>
          <small>{atHandle(account)}</small>
        </div>
      </header>
      <div className="np-youtube-description">
        <small>
          {TEXT.description} · {PREVIEW_TEXT.now}
        </small>
        <PreviewText
          body={body}
          cutoff={rule.cutoff}
          limit={rule.limit}
          moreLabel={`…${PREVIEW_TEXT.more}`}
        />
      </div>
    </article>
  );
}
