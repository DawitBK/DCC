'use client';

import { useMemo, useState } from 'react';
import type { ContentVersionDto, SocialAccountDto } from '@dcc/contracts';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/format';
import { diffIds, diffText } from '@/lib/text-diff';
import { useWorkspace } from '@/lib/workspace';
import { AccountChip, MediaGallery, TargetChips } from './parts';
import '@/app/screens/work-shared.css';

const TEXT = {
  version: (number: number) => `Version ${number}`,
  current: 'Current',
  older: 'Older',
  writtenBy: (name: string) => `written by ${name}`,
  first: 'The first version. There is nothing before it to compare with.',
  showChanges: 'Changes',
  showFull: 'Full text',
  switchLabel: 'How to show this version',
  legend: { added: 'Added in this version', removed: 'Removed from the version before' },
  added: 'added',
  removed: 'removed',
  noTextChange: 'The text did not change in this version.',
  words: (added: number, removed: number) =>
    `${added} ${added === 1 ? 'word' : 'words'} added, ${removed} ${removed === 1 ? 'word' : 'words'} removed`,
  accountsAdded: 'Accounts added',
  accountsRemoved: 'Accounts removed',
  accountsSame: 'Accounts',
  filesAdded: 'Files added',
  filesRemoved: 'Files removed',
  files: 'Pictures and videos',
  nothingElse: 'Accounts and files are the same as in the version before.',
  restore: 'Put this version in the editor',
  empty: 'No versions were found.',
  compared: (number: number) => `Compared with version ${number}`,
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Every version of a post, newest first: who wrote it, when, for which accounts, with which files, and what
 * changed since the version before, word by word. A removed word is struck through and an added word is
 * underlined, and both are also announced in words, so colour is never the only signal.
 */
export function VersionHistory({
  versions,
  accounts,
  currentVersionId,
  onRestore,
}: {
  versions: readonly ContentVersionDto[];
  accounts: readonly SocialAccountDto[];
  currentVersionId: string | null;
  /** Composer only: load an earlier version into the editor. */
  onRestore?: (version: ContentVersionDto) => void;
}) {
  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions],
  );
  if (sorted.length === 0) return <p className="wk-hint">{TEXT.empty}</p>;
  return (
    <ol className="wk-versions">
      {sorted.map((version, index) => (
        <VersionCard
          key={version.id}
          version={version}
          previous={sorted[index + 1]}
          accounts={accounts}
          isCurrent={version.id === currentVersionId}
          defaultOpen={index === 0}
          onRestore={onRestore}
        />
      ))}
    </ol>
  );
}

function VersionCard({
  version,
  previous,
  accounts,
  isCurrent,
  defaultOpen,
  onRestore,
}: {
  version: ContentVersionDto;
  previous: ContentVersionDto | undefined;
  accounts: readonly SocialAccountDto[];
  isCurrent: boolean;
  defaultOpen: boolean;
  onRestore?: (version: ContentVersionDto) => void;
}) {
  const { personName } = useWorkspace();
  const [mode, setMode] = useState<'changes' | 'full'>(previous ? 'changes' : 'full');
  const parts = useMemo(
    () => (previous ? diffText(previous.body, version.body) : []),
    [previous, version.body],
  );
  const added = parts
    .filter((part) => part.kind === 'added')
    .reduce((n, p) => n + wordCount(p.text), 0);
  const removed = parts
    .filter((part) => part.kind === 'removed')
    .reduce((n, p) => n + wordCount(p.text), 0);
  const targets = previous ? diffIds(previous.targetAccountIds, version.targetAccountIds) : null;
  const files = previous
    ? diffIds(
        previous.media.map((m) => m.id),
        version.media.map((m) => m.id),
      )
    : null;
  const unchangedElsewhere =
    targets &&
    files &&
    !targets.added.length &&
    !targets.removed.length &&
    !files.added.length &&
    !files.removed.length;
  const fileName = (id: string) =>
    [...version.media, ...(previous?.media ?? [])].find((m) => m.id === id)?.fileName ?? id;

  return (
    <li>
      <details className="wk-version" data-current={isCurrent} open={defaultOpen}>
        <summary>
          <span className="wk-version-title">{TEXT.version(version.versionNumber)}</span>
          <StatusChip
            label={isCurrent ? TEXT.current : TEXT.older}
            tone={isCurrent ? 'green' : 'gray'}
          />
          <span className="wk-muted">
            {TEXT.writtenBy(personName(version.createdBy))} · {formatDateTime(version.createdAt)}
          </span>
        </summary>
        <div className="wk-version-body">
          {previous ? (
            <div className="wk-row">
              <div className="wk-version-switch" role="group" aria-label={TEXT.switchLabel}>
                <button
                  type="button"
                  aria-pressed={mode === 'changes'}
                  onClick={() => setMode('changes')}
                >
                  {TEXT.showChanges}
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'full'}
                  onClick={() => setMode('full')}
                >
                  {TEXT.showFull}
                </button>
              </div>
              <span className="wk-muted">{TEXT.compared(previous.versionNumber)}</span>
              <span className="wk-muted">{TEXT.words(added, removed)}</span>
            </div>
          ) : (
            <p className="wk-hint">{TEXT.first}</p>
          )}

          {previous && mode === 'changes' ? (
            <>
              {added + removed === 0 ? (
                <p className="wk-hint">{TEXT.noTextChange}</p>
              ) : (
                <>
                  <p className="wk-diff">
                    {parts.map((part, i) =>
                      part.kind === 'added' ? (
                        <ins key={i}>
                          <span className="visually-hidden">[{TEXT.added}: </span>
                          {part.text}
                          <span className="visually-hidden">]</span>
                        </ins>
                      ) : part.kind === 'removed' ? (
                        <del key={i}>
                          <span className="visually-hidden">[{TEXT.removed}: </span>
                          {part.text}
                          <span className="visually-hidden">]</span>
                        </del>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </p>
                  <div className="wk-legend" aria-hidden="true">
                    <span>
                      <ins className="wk-diff-sample">abc</ins> {TEXT.legend.added}
                    </span>
                    <span>
                      <del className="wk-diff-sample">abc</del> {TEXT.legend.removed}
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="wk-text-box">
              <p className="wk-body-text">{version.body}</p>
            </div>
          )}

          {previous && unchangedElsewhere ? <p className="wk-hint">{TEXT.nothingElse}</p> : null}
          <ul className="wk-changes">
            {targets && targets.added.length > 0 && (
              <li>
                <strong>{TEXT.accountsAdded}: </strong>
                <TargetChips ids={targets.added} accounts={accounts} />
              </li>
            )}
            {targets && targets.removed.length > 0 && (
              <li>
                <strong>{TEXT.accountsRemoved}: </strong>
                <TargetChips ids={targets.removed} accounts={accounts} />
              </li>
            )}
            {files && files.added.length > 0 && (
              <li>
                <strong>{TEXT.filesAdded}: </strong>
                {files.added.map(fileName).join(', ')}
              </li>
            )}
            {files && files.removed.length > 0 && (
              <li>
                <strong>{TEXT.filesRemoved}: </strong>
                {files.removed.map(fileName).join(', ')}
              </li>
            )}
          </ul>

          <div>
            <span className="label">{TEXT.accountsSame}</span>
            <span className="wk-chips">
              {version.targetAccountIds.map((id) => (
                <AccountChip key={id} id={id} account={accounts.find((a) => a.id === id)} />
              ))}
            </span>
          </div>
          {version.media.length > 0 && (
            <div>
              <span className="label">{TEXT.files}</span>
              <MediaGallery media={version.media} />
            </div>
          )}
          {onRestore && !isCurrent && (
            <div>
              <button type="button" className="btn btn-outline" onClick={() => onRestore(version)}>
                {TEXT.restore}
              </button>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
