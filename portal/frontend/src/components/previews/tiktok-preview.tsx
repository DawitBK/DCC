import { NETWORK_RULES } from '@/lib/networks';
import {
  PREVIEW_TEXT,
  PreviewFrame,
  PreviewText,
  atHandle,
  type NetworkPreviewProps,
} from './preview-parts';

const TEXT = { actions: ['Like', 'Comment', 'Save', 'Share'] };

/** TikTok layout: a 9:16 video frame with the actions at its side, then the handle and caption. */
export function TikTokPreview({ account, body, media }: NetworkPreviewProps) {
  const rule = NETWORK_RULES.tiktok;
  const video = media.find((item) => item.kind === 'video');
  return (
    <article className="np-post np-tiktok">
      <div className="np-tiktok-stage">
        <PreviewFrame shape="tall" item={video} empty={PREVIEW_TEXT.noVideo} />
        <div className="np-tiktok-side" aria-hidden="true">
          {TEXT.actions.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
      <div className="np-caption">
        <strong>{atHandle(account)}</strong>
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
