'use client';

import { useId, useRef, useState } from 'react';
import {
  MAX_IMAGE_BYTES,
  MAX_MEDIA_PER_POST,
  MAX_VIDEO_BYTES,
  type ContentMediaDto,
} from '@dcc/contracts';
import { apiUpload, queryString } from '@/lib/browser-api';
import { formatBytes, MEDIA_ACCEPT, mediaFileProblem, mediaUrl } from '@/lib/media';
import { toApiError } from '@/lib/use-api';

const TEXT = {
  legend: 'Pictures and videos',
  add: 'Add pictures or videos',
  hint: (count: number) =>
    `Up to ${count} files. Pictures up to ${formatBytes(MAX_IMAGE_BYTES)} (JPEG, PNG, WebP, GIF); videos up to ${formatBytes(MAX_VIDEO_BYTES)} (MP4, MOV, WebM).`,
  count: (used: number, max: number) => `${used} of ${max} attached`,
  noCompany: 'Choose a company first.',
  tooMany: (max: number) =>
    `A post can carry at most ${max} files. The extra files were not added.`,
  uploading: (name: string, percent: number) => `Uploading ${name}: ${percent}%`,
  notAvailable: 'Uploading pictures and videos is not available on this server yet.',
  failed: (name: string, reason: string) => `“${name}” could not be uploaded. ${reason}`,
  image: 'Picture',
  video: 'Video',
  position: (index: number, total: number) => `${index} of ${total}`,
  up: (name: string) => `Move ${name} earlier`,
  down: (name: string) => `Move ${name} later`,
  remove: (name: string) => `Remove ${name}`,
  removeShort: 'Remove',
  order: 'The order here is the order on the post.',
};

/**
 * The files of one post: `POST /api/media?companyId=` (multipart, field `file`) for each new file,
 * then the caller names them by id (`mediaIds`) when it saves the post. Type, size and count are
 * checked here with the contract's own limits before anything is sent; the API checks again.
 */
export function MediaPicker({
  companyId,
  media,
  onChange,
  disabled = false,
  error,
}: {
  companyId: string;
  media: ContentMediaDto[];
  onChange: (media: ContentMediaDto[]) => void;
  disabled?: boolean;
  /** The API's own complaint about `mediaIds`, if any. */
  error?: string;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; fraction: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const busy = progress !== null;
  const full = media.length >= MAX_MEDIA_PER_POST;

  const addFiles = async (files: File[]) => {
    const found: string[] = [];
    const room = MAX_MEDIA_PER_POST - media.length;
    if (files.length > room) found.push(TEXT.tooMany(MAX_MEDIA_PER_POST));
    let next = media;
    for (const file of files.slice(0, Math.max(room, 0))) {
      const problem = mediaFileProblem(file);
      if (problem) {
        found.push(problem);
        continue;
      }
      setProgress({ name: file.name, fraction: 0 });
      try {
        const uploaded = await apiUpload<ContentMediaDto>(
          `/media${queryString({ companyId })}`,
          file,
          (fraction) => setProgress({ name: file.name, fraction }),
        );
        next = [...next, uploaded];
        onChange(next);
      } catch (failure) {
        const refused = toApiError(failure);
        if (refused.status === 404) {
          found.push(TEXT.notAvailable);
          break;
        }
        found.push(TEXT.failed(file.name, refused.message));
      }
    }
    setProgress(null);
    setProblems(found);
  };

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= media.length) return;
    const next = [...media];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <fieldset className="field-group media-picker">
      <legend className="label">{TEXT.legend}</legend>
      {media.length > 0 && (
        <ol className="media-list">
          {media.map((item, index) => (
            <li key={item.id} className="media-item">
              <span className="media-thumb">
                {item.kind === 'image' ? (
                  <img src={mediaUrl(item)} alt="" />
                ) : (
                  <video src={mediaUrl(item)} preload="metadata" muted aria-hidden="true" />
                )}
              </span>
              <span className="media-copy">
                <strong>{item.fileName}</strong>
                <small>
                  {item.kind === 'image' ? TEXT.image : TEXT.video} · {formatBytes(item.sizeBytes)}{' '}
                  · {TEXT.position(index + 1, media.length)}
                </small>
              </span>
              <span className="media-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-icon"
                  aria-label={TEXT.up(item.fileName)}
                  disabled={disabled || busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-icon"
                  aria-label={TEXT.down(item.fileName)}
                  disabled={disabled || busy || index === media.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  aria-label={TEXT.remove(item.fileName)}
                  disabled={disabled || busy}
                  onClick={() => onChange(media.filter((entry) => entry.id !== item.id))}
                >
                  {TEXT.removeShort}
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="upload-zone">
        <label htmlFor={inputId}>{TEXT.add}</label>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          accept={MEDIA_ACCEPT}
          aria-describedby={hintId}
          disabled={disabled || busy || full || !companyId}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // Empty the box so the same file can be chosen again after a problem.
            event.target.value = '';
            if (files.length > 0) void addFiles(files);
          }}
        />
      </div>
      <div role="status" aria-live="polite">
        {progress && (
          <div className="media-progress">
            <span>{TEXT.uploading(progress.name, Math.round(progress.fraction * 100))}</span>
            <progress value={progress.fraction} max={1} aria-label={progress.name} />
          </div>
        )}
      </div>
      <small className="hint" id={hintId}>
        {!companyId ? TEXT.noCompany : TEXT.hint(MAX_MEDIA_PER_POST)}{' '}
        {TEXT.count(media.length, MAX_MEDIA_PER_POST)}
        {media.length > 1 ? `. ${TEXT.order}` : ''}
      </small>
      {[...problems, ...(error ? [error] : [])].map((problem) => (
        <small key={problem} className="field-error" role="alert">
          {problem}
        </small>
      ))}
    </fieldset>
  );
}
