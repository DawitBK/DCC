'use client';

import type { PublicationDto, ReconcileResultDto } from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import { formatDateTime } from '@/lib/format';
import { useAction } from '@/lib/use-api';
import { Dialog, DialogActions } from './dialog';
import { ErrorBox } from './error-box';
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
    result.checked === 0
      ? 'Nothing was waiting for an answer from the engine.'
      : `Checked ${result.checked}: ${result.published} published, ${result.failed} failed, ${result.stillWaiting} still waiting.`,
};

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
export function ReconcileButton({ onDone }: { onDone: () => void }) {
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
          if (result) showToast(TEXT.reconciled(result));
          onDone();
        }}
      >
        {action.busy ? TEXT.working : TEXT.reconcile}
      </button>
    </span>
  );
}
