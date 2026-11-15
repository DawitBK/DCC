import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_TYPES,
  type ContentMediaDto,
} from '@dcc/contracts';
import { withBasePath } from './base-path';

/** The address for `<img>`/`<video>`: the API's own path, behind the same base path as every API call. */
export function mediaUrl(media: ContentMediaDto): string {
  return withBasePath(media.url);
}

/** For the file picker's `accept`: exactly the types the contract allows. */
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(',');

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const TEXT = {
  type: (name: string) =>
    `“${name}” is not a type DCC accepts. Use a JPEG, PNG, WebP or GIF picture, or an MP4, MOV or WebM video.`,
  tooBig: (name: string, max: string) => `“${name}” is too large. The limit is ${max}.`,
  empty: (name: string) => `“${name}” is empty.`,
};

/** The contract's own limits, checked before anything is sent. Returns the problem, or null when the file is fine. */
export function mediaFileProblem(file: File): string | null {
  const kind = MEDIA_TYPES[file.type];
  if (!kind) return TEXT.type(file.name);
  if (file.size === 0) return TEXT.empty(file.name);
  const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > max) return TEXT.tooBig(file.name, formatBytes(max));
  return null;
}
