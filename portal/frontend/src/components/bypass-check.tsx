'use client';

import type { BypassCheckResultDto } from '@dcc/contracts';
import { apiSend, type ApiRequestError } from '@/lib/browser-api';
import { formatDateTime } from '@/lib/format';
import { useAction } from '@/lib/use-api';
import { ErrorBox } from './error-box';
import { SectionPanel } from './section-panel';

const BYPASS_HINT_ID = 'bypass-check-hint';

/** What the screen keeps of the last check: its answer, or the reason it did not run. Never both. */
export type BypassCheckState =
  | { kind: 'done'; result: BypassCheckResultDto; at: Date }
  | { kind: 'failed'; error: ApiRequestError };

const TEXT = {
  button: 'Check for posts DCC did not send',
  working: 'Checking…',
  hint: 'Reads the engine’s recent posts and opens an incident for each one DCC did not send. It sends and deletes nothing.',
  scope:
    'It covers every company where you manage incidents, whichever company is chosen above. It sees posts the engine knows about: a post made directly on a network is not covered.',
  failedTitle: 'The check did not run, so nothing is known',
  failedNote:
    'This is not a clean result. No post was looked at. Try again when the engine can be reached.',
  resultTitle: 'Result of the check',
  resultSubtitle: (when: string) => `Done ${when}`,
  checked: 'Engine posts checked',
  suspected: 'Suspected',
  created: 'New incidents',
  updated: 'Incidents updated',
  none: (checked: number) =>
    checked === 0
      ? 'The engine returned no posts for the last 30 days, so there was nothing to check.'
      : 'None of the recent posts on your accounts was found to be outside DCC.',
  found: (suspected: number) =>
    suspected === 1
      ? '1 post was not sent by DCC. It is on the incident register.'
      : `${suspected} posts were not sent by DCC. They are on the incident register.`,
  alreadyKnown:
    'Some suspected posts need no new entry: their incident already holds the same evidence, or a person has resolved or closed it.',
};

/**
 * `POST /api/publications/reconcile-bypass` (needs `incident.manage`). The screen owns the state so the
 * result can be shown away from the button; `onChange` gets each answer or refusal.
 */
export function BypassCheckButton({
  onChange,
  onDone,
}: {
  onChange: (state: BypassCheckState | null) => void;
  /** The check ran: read the register again. */
  onDone: () => void;
}) {
  const action = useAction();
  return (
    <button
      type="button"
      className="btn btn-outline"
      title={TEXT.hint}
      aria-describedby={BYPASS_HINT_ID}
      disabled={action.busy}
      onClick={async () => {
        // A new check starts from nothing: an old answer must never stand in for a failed one.
        onChange(null);
        let result: BypassCheckResultDto | undefined;
        const failure = await action.run(async () => {
          result = await apiSend<BypassCheckResultDto>('POST', '/publications/reconcile-bypass');
        });
        if (failure) return onChange({ kind: 'failed', error: failure });
        if (!result) return;
        onChange({ kind: 'done', result, at: new Date() });
        onDone();
      }}
    >
      {action.busy ? TEXT.working : TEXT.button}
    </button>
  );
}

/** One line saying what the check does; the button points to it. */
export function BypassCheckHint() {
  return (
    <small className="hint" id={BYPASS_HINT_ID}>
      {TEXT.hint}
    </small>
  );
}

/** The last check, said plainly. A failed check is a warning, never an empty "all clear". */
export function BypassCheckResult({ state }: { state: BypassCheckState | null }) {
  if (!state) return null;
  if (state.kind === 'failed') {
    return (
      <div style={{ marginBottom: 18 }}>
        <ErrorBox error={state.error} title={TEXT.failedTitle} />
        <small className="hint">{TEXT.failedNote}</small>
      </div>
    );
  }
  const { result } = state;
  return (
    <div style={{ marginBottom: 18 }}>
      <SectionPanel
        title={TEXT.resultTitle}
        subtitle={TEXT.resultSubtitle(formatDateTime(state.at.toISOString()))}
      >
        <div role="status" aria-live="polite">
          <dl className="definition-grid">
            <div>
              <dt>{TEXT.checked}</dt>
              <dd>{result.checked}</dd>
            </div>
            <div>
              <dt>{TEXT.suspected}</dt>
              <dd>{result.suspected}</dd>
            </div>
            <div>
              <dt>{TEXT.created}</dt>
              <dd>{result.incidentsCreated}</dd>
            </div>
            <div>
              <dt>{TEXT.updated}</dt>
              <dd>{result.incidentsUpdated}</dd>
            </div>
          </dl>
          <p style={{ margin: 0 }}>
            {result.suspected === 0 ? TEXT.none(result.checked) : TEXT.found(result.suspected)}
          </p>
          {result.suspected > result.incidentsCreated + result.incidentsUpdated && (
            <small className="hint">{TEXT.alreadyKnown}</small>
          )}
          <small className="hint">{TEXT.scope}</small>
        </div>
      </SectionPanel>
    </div>
  );
}
