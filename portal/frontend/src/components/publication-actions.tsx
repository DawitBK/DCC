'use client';

import { useState } from 'react';
import type { PublicationDto, ReconcileResultDto, SettleStuckKeyResultDto } from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import { formatDateTime, shortId } from '@/lib/format';
import { UNRESOLVED_REASON, UNRESOLVED_STATE } from '@/lib/labels';
import { useAction } from '@/lib/use-api';
import { DataTable } from './data-table';
import { Dialog, DialogActions } from './dialog';
import { ErrorBox } from './error-box';
import { SectionPanel } from './section-panel';
import {
  SETTLE_TEXT,
  SettleStuckKeyDialog,
  type SettleOutcome,
  type UnresolvedKey,
} from './settle-stuck-key-dialog';
import { StatusChip } from './status-chip';
import { useToast } from './toast';

const TEXT = {
  cancelTitle: 'Cancel this scheduled post?',
  cancelBody: (account: string, when: string) =>
    `The post for ${account}, planned for ${when}, will not go out. The post itself stays approved and can be scheduled again.`,
  keep: 'Keep it scheduled',
  confirm: 'Cancel the scheduled post',
  working: 'Working…',
  cancelled: 'The scheduled post was cancelled.',
  reconcile: 'Check with the engine',
  reconcileHint: 'Asks the publishing engine what happened to posts that are still waiting.',
  reconciled: (result: ReconcileResultDto) =>
    (result.checked === 0
      ? 'Nothing was waiting for an answer from the engine.'
      : `Checked ${result.checked}: ${result.published} published, ${result.failed} failed, ${result.stillWaiting} still waiting.`) +
    (unresolvedOf(result).length > 0
      ? ` ${unresolvedOf(result).length} could not be settled: see the Publishing screen.`
      : ''),
  unresolvedTitle: 'Sends that could not be settled',
  unresolvedSubtitle: (count: number) =>
    count === 1
      ? '1 send is still blocked. DCC sent nothing new and will not send it again until it is settled.'
      : `${count} sends are still blocked. DCC sent nothing new and will not send them again until they are settled.`,
  unresolvedNone: 'Every send that was checked has been settled.',
  unresolvedCaption: 'Sends that could not be settled after asking the engine',
  account: 'Account',
  state: 'State',
  why: 'Why',
  key: 'Send reference',
  publication: 'Publication',
  noPublication: 'No publication recorded',
  hide: 'Hide this result',
  actions: 'What to do',
  allSettled: 'Every blocked send has now been settled by hand.',
  checkedAt: (when: string, summary: string) => `${when}. ${summary}`,
};

function unresolvedOf(result: ReconcileResultDto): ReconcileResultDto['unresolvedKeys'] {
  return result.unresolvedKeys ?? [];
}

/** Confirm, then `POST /api/publications/:id/cancel`. Only a scheduled publication can be cancelled. */
export function CancelPublicationDialog({
  publication,
  accountName,
  onClose,
  onDone,
}: {
  publication: PublicationDto;
  accountName: string;
  onClose: () => void;
  /** The API cancelled it: read the lists again. */
  onDone: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  return (
    <Dialog
      title={TEXT.cancelTitle}
      description={TEXT.cancelBody(accountName, formatDateTime(publication.scheduledAt))}
      onClose={onClose}
    >
      <ErrorBox error={action.error} />
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {TEXT.keep}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={action.busy}
          onClick={async () => {
            const failure = await action.run(() =>
              apiSend<PublicationDto>('POST', `/publications/${publication.id}/cancel`),
            );
            if (failure) return;
            showToast(TEXT.cancelled);
            onDone();
          }}
        >
          {action.busy ? TEXT.working : TEXT.confirm}
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** `POST /api/publications/reconcile`: the result is said in a toast, then the caller reads its list again. */
export function ReconcileButton({
  onDone,
  onResult,
}: {
  onDone: () => void;
  /** The whole answer, for a screen that wants to show the sends that could not be settled. */
  onResult?: (result: ReconcileResultDto) => void;
}) {
  const showToast = useToast();
  const action = useAction();
  return (
    <span>
      <button
        type="button"
        className="btn btn-outline"
        title={TEXT.reconcileHint}
        disabled={action.busy}
        onClick={async () => {
          let result: ReconcileResultDto | undefined;
          const failure = await action.run(async () => {
            result = await apiSend<ReconcileResultDto>('POST', '/publications/reconcile');
          });
          if (failure) return showToast(failure.message);
          if (result) {
            showToast(TEXT.reconciled(result));
            onResult?.(result);
          }
          onDone();
        }}
      >
        {action.busy ? TEXT.working : TEXT.reconcile}
      </button>
    </span>
  );
}

/**
 * What the last "Check with the engine" could not settle: each send DCC is not sure about, and why, in plain
 * words. It is a record of what the engine answered at that moment, kept on screen until the next check.
 * `accountOf` names the account of a publication this screen already knows. A person who may publish
 * (`canSettle`, from `GET /api/me`; the API decides) can settle a send by hand: `settled` holds the answers
 * received so far, so a settled send shows what was recorded instead of the buttons.
 */
export function UnresolvedKeysPanel({
  result,
  checkedAt,
  accountOf,
  onHide,
  canSettle = false,
  settled = {},
  onSettled,
}: {
  result: ReconcileResultDto;
  checkedAt: Date;
  accountOf: (publicationId: string) => string | null;
  onHide: () => void;
  canSettle?: boolean;
  settled?: Record<string, SettleStuckKeyResultDto>;
  /** The API settled a key: the screen keeps the answer and reads its lists again. */
  onSettled?: (answer: SettleStuckKeyResultDto) => void;
}) {
  const keys = unresolvedOf(result);
  const open = keys.filter((row) => !settled[row.key]).length;
  const [settling, setSettling] = useState<{ row: UnresolvedKey; outcome: SettleOutcome } | null>(
    null,
  );
  return (
    <div style={{ marginBottom: 18 }}>
      <SectionPanel
        title={TEXT.unresolvedTitle}
        subtitle={TEXT.checkedAt(
          formatDateTime(checkedAt.toISOString()),
          keys.length === 0
            ? TEXT.unresolvedNone
            : open === 0
              ? TEXT.allSettled
              : TEXT.unresolvedSubtitle(open),
        )}
        action={
          <button type="button" className="btn btn-outline" onClick={onHide}>
            {TEXT.hide}
          </button>
        }
      >
        <div role="status" aria-live="polite">
          {keys.length > 0 && (
            <DataTable
              caption={TEXT.unresolvedCaption}
              rows={keys}
              rowKey={(row) => row.key}
              columns={[
                {
                  header: TEXT.account,
                  cell: (row) => {
                    const account = row.publicationId ? accountOf(row.publicationId) : null;
                    return (
                      <>
                        <span className="post-title">{account ?? TEXT.noPublication}</span>
                        {row.publicationId && (
                          <span className="subline">
                            {TEXT.publication} {shortId(row.publicationId)}
                          </span>
                        )}
                      </>
                    );
                  },
                },
                {
                  header: TEXT.state,
                  cell: (row) => <StatusChip status={UNRESOLVED_STATE[row.state]} />,
                },
                { header: TEXT.why, cell: (row) => UNRESOLVED_REASON[row.reason] },
                {
                  header: TEXT.key,
                  cell: (row) => <code>{row.key}</code>,
                },
                ...(canSettle
                  ? [
                      {
                        header: TEXT.actions,
                        cell: (row: UnresolvedKey) => {
                          const done = settled[row.key];
                          if (done) {
                            return (
                              <>
                                <StatusChip label={SETTLE_TEXT.settled} tone="green" />
                                <span className="subline">{SETTLE_TEXT.outcome[done.outcome]}</span>
                              </>
                            );
                          }
                          return (
                            <span className="row-actions">
                              <button
                                type="button"
                                className="text-link"
                                aria-label={SETTLE_TEXT.publishedLabel(row.key)}
                                onClick={() => setSettling({ row, outcome: 'published' })}
                              >
                                {SETTLE_TEXT.published}
                              </button>
                              <button
                                type="button"
                                className="text-link"
                                aria-label={SETTLE_TEXT.notPublishedLabel(row.key)}
                                onClick={() => setSettling({ row, outcome: 'not_published' })}
                              >
                                {SETTLE_TEXT.notPublished}
                              </button>
                            </span>
                          );
                        },
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </SectionPanel>
      {settling && (
        <SettleStuckKeyDialog
          row={settling.row}
          outcome={settling.outcome}
          accountName={settling.row.publicationId ? accountOf(settling.row.publicationId) : null}
          onClose={() => setSettling(null)}
          onDone={(answer) => {
            setSettling(null);
            onSettled?.(answer);
          }}
        />
      )}
    </div>
  );
}
