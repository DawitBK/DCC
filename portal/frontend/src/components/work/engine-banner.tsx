'use client';

import type { EngineStatusDto, SocialAccountDto } from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { StatusChip } from '@/components/status-chip';
import { PLATFORM_LABELS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { accountReadiness } from '@/lib/work';
import '@/app/screens/work-shared.css';

const TEXT = {
  title: 'Publishing engine',
  verified: 'Tested against a live engine',
  unverified: 'Not yet tested against a live engine',
  verifiedBody: 'The engine was tested against a live service.',
  unverifiedBody:
    'DCC governs and records every send, but a real post on a real network is not proven yet. Treat a first real send with care.',
  canPublish: 'Can publish',
  cannotPublish: 'Cannot publish',
  cannotPublishBody:
    'The engine cannot publish right now, so every publish will fail until that is fixed.',
  inbox: 'Inbox connected',
  noInbox: 'Inbox not connected',
  console: 'Where an engine administrator connects networks',
  loadError: 'The state of the publishing engine could not be read',
  accounts: (ready: number, total: number) => `${ready} of ${total} accounts ready`,
  accountsNone: 'No registered accounts in view',
  needAction: (n: number) => `${n} need action`,
  show: 'Details',
  notes: 'What the engine says about itself',
  accountsTitle: 'Each account',
  provider: (name: string) => `Engine: ${name}`,
};

/**
 * What is behind DCC for publishing (`GET /api/engine/status`, needs `account.read`) and whether each account in
 * view can receive a post (from the register: status and engine channel). One line, open for the detail. It only
 * reports; linking an account to the engine is done on the Social accounts screen.
 */
export function EngineBanner({
  accounts,
  compact = false,
}: {
  accounts: readonly SocialAccountDto[];
  /** One account's page: no list of accounts. */
  compact?: boolean;
}) {
  const { can } = useWorkspace();
  const mayRead = can('account.read');
  const status = useApiData<EngineStatusDto>(mayRead ? '/engine/status' : null);
  const ready = accounts.filter((account) => accountReadiness(account).usable);
  const problems = accounts.filter((account) => !accountReadiness(account).usable);
  const data = status.data;

  if (!mayRead) return <p className="wk-hint">{needsRoleHint('account.read')}</p>;
  return (
    <div>
      <ErrorBox error={status.error} title={TEXT.loadError} loading />
      <details
        className="wk-engine"
        data-tone={
          !data
            ? 'info'
            : !data.canPublish
              ? 'bad'
              : data.verification === 'verified'
                ? 'ok'
                : 'warn'
        }
      >
        <summary>
          <strong>{TEXT.title}</strong>
          {data && (
            <>
              <span className="wk-muted">{TEXT.provider(data.provider)}</span>
              <StatusChip
                label={data.verification === 'verified' ? TEXT.verified : TEXT.unverified}
                tone={data.verification === 'verified' ? 'green' : 'amber'}
              />
              <StatusChip
                label={data.canPublish ? TEXT.canPublish : TEXT.cannotPublish}
                tone={data.canPublish ? 'green' : 'red'}
              />
              <StatusChip
                label={data.inbox ? TEXT.inbox : TEXT.noInbox}
                tone={data.inbox ? 'green' : 'gray'}
              />
            </>
          )}
          {!compact && (
            <>
              <span className="wk-muted">
                {accounts.length === 0
                  ? TEXT.accountsNone
                  : TEXT.accounts(ready.length, accounts.length)}
              </span>
              {problems.length > 0 && (
                <StatusChip label={TEXT.needAction(problems.length)} tone="amber" />
              )}
            </>
          )}
          <span className="wk-engine-more">{TEXT.show}</span>
        </summary>
        <div className="wk-engine-body">
          {data && (
            <>
              <p className="wk-hint">
                {data.verification === 'verified' ? TEXT.verifiedBody : TEXT.unverifiedBody}{' '}
                {!data.canPublish && TEXT.cannotPublishBody}
              </p>
              {data.notes.length > 0 && (
                <div>
                  <span className="label">{TEXT.notes}</span>
                  <ul className="wk-changes">
                    {data.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.consoleUrl && (
                <a
                  className="wk-link"
                  href={data.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {TEXT.console}
                </a>
              )}
            </>
          )}
          {!compact && accounts.length > 0 && (
            <div>
              <span className="label">{TEXT.accountsTitle}</span>
              <ul className="wk-readiness-list">
                {[...problems, ...ready].map((account) => {
                  const readiness = accountReadiness(account);
                  return (
                    <li key={account.id}>
                      <span>
                        <strong>
                          {PLATFORM_LABELS[account.platform]} · {account.displayName}
                        </strong>
                        <small className="wk-sub">{readiness.detail}</small>
                      </span>
                      <StatusChip label={readiness.label} tone={readiness.tone} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
