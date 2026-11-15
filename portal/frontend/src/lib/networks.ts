import type { ContentMediaDto, SocialPlatform } from '@dcc/contracts';

/**
 * What each network accepts, as far as the preview needs it. These are the networks' own published
 * limits, not DCC rules: the API does not check them, so the preview warns and nothing is blocked.
 */
export type NetworkRule = {
  /** The longest text the network takes. */
  limit: number;
  /** Roughly where the network cuts the text and shows "see more". null = it shows all of it. */
  cutoff: number | null;
  needsMedia: boolean;
  needsVideo: boolean;
};

export const NETWORK_RULES: Record<SocialPlatform, NetworkRule> = {
  facebook: { limit: 63206, cutoff: 480, needsMedia: false, needsVideo: false },
  instagram: { limit: 2200, cutoff: 125, needsMedia: true, needsVideo: false },
  linkedin: { limit: 3000, cutoff: 210, needsMedia: false, needsVideo: false },
  x: { limit: 280, cutoff: null, needsMedia: false, needsVideo: false },
  tiktok: { limit: 2200, cutoff: 100, needsMedia: true, needsVideo: true },
  youtube: { limit: 5000, cutoff: 160, needsMedia: true, needsVideo: true },
};

export const NETWORK_TEXT = {
  overLimit: (over: number) =>
    over === 1 ? 'The text is 1 character too long.' : `The text is ${over} characters too long.`,
  needsMedia: 'This network needs a picture or a video. None is attached.',
  needsVideo: 'This network needs a video. None is attached.',
};

/** The problems this post would have on this network. Empty = none found. */
export function networkWarnings(
  platform: SocialPlatform,
  body: string,
  media: ContentMediaDto[],
): string[] {
  const rule = NETWORK_RULES[platform];
  const warnings: string[] = [];
  const length = body.trim().length;
  if (length > rule.limit) warnings.push(NETWORK_TEXT.overLimit(length - rule.limit));
  if (rule.needsVideo) {
    if (!media.some((item) => item.kind === 'video')) warnings.push(NETWORK_TEXT.needsVideo);
  } else if (rule.needsMedia && media.length === 0) {
    warnings.push(NETWORK_TEXT.needsMedia);
  }
  return warnings;
}
