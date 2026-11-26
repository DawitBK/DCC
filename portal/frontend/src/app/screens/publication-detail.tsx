'use client';

import { useMemo, useState } from 'react';
import type {
  ApprovalRequestFullDto,
  ContentItemDto,
  ContentVersionDto,
  FreezeDto,
  PublicationDto,
  ReconcileResultDto,
  SettleStuckKeyResultDto,
  SocialAccountDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { PostPreviews } from '@/components/previews/post-previews';
import {
  CancelPublicationDialog,
  ReconcileButton,
  UnresolvedKeysPanel,
} from '@/components/publication-actions';
import { StatusChip } from '@/components/status-chip';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, CopyId, Fact, Timeline } from '@/components/kit/parts';
import { EngineBanner } from '@/components/work/engine-banner';
import { AccountChip, EmptyBlock, MediaGallery, Skeletons, WhyBox } from '@/components/work/parts';
import { PublicationFacts, publicationTimeline } from '@/components/work/publication-parts';
import { PublishDialog } from '@/components/work/publish-dialog';
import { queryString } from '@/lib/browser-api';
import { formatDateTime, shortId } from '@/lib/format';
import { PLATFORM_LABELS, PUBLICATION_STATUS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { PUBLICATION_MEANING, accountReadiness, relativeAge } from '@/lib/work';
import './publishing-screen.css';
import './work-shared.css';

type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
};

const TEXT = {
  list: 'Publishing',
  loadError: 'This publication could not be opened',
  back: 'Back to publishing',
  notFound: 'This publication was not found',
  notFoundBody:
    'It may belong to a company you cannot see, or it may not exist. Publications are listed on the Publishing screen.',
  title: (account: string) => `Publication to ${account}`,
  description:
    'One send of one post to one account: what was sent, who asked for it, what the engine answered and what you can do next.',
  openPost: 'Open the post',
  cancelSchedule: 'Cancel the schedule',
  again: 'Publish again…',
  facts: {
    status: 'State',
    when: 'When it goes out',
    done: 'Finished',
    by: 'Requested by',
    account: 'Account',
    now: 'Sent right away',
    notYet: 'Not finished',
  },
  sent: 'What was sent',
  version: (n: number) => `Version ${n}`,
  previews: 'How it looked on this network',
  media: 'Pictures and videos',
  happened: 'What happened',
  error: 'What went wrong',
  errorHint:
    'This is the engine’s own message. Read it before you try again: sending again to an account where the first send went out would post twice.',
  related: 'Other sends of this post',
  relatedNone: 'This post has no other publications.',
  relatedOpen: 'Open',
  audit: 'Audit trail of this publication',
  auditNote: 'Kept by DCC, read-only.',
  auditEmpty: 'The audit trail holds nothing for this publication.',
  auditError: 'The audit trail could not be read',
  auditNeeds: 'The audit trail is read by people with the audit role.',
  system: 'System',
  readiness: 'The account',
  engineChannel: 'Engine channel',
  notLinked: 'Not linked to the engine',
  checkResult: 'Result of the check with the engine',
  mayNot: 'Why you cannot act on this publication',
  mayNotCancel: 'Only a scheduled publication can be cancelled.',
  mayNotAgain:
    'A send can be repeated only after a failure or a cancellation, and only while the post is approved.',
  mayNotCheck: 'Only a publication that is waiting for the engine can be checked.',
};

const AUDIT_ACTIONS: Record<string, string> = {
  'publication.published': 'Published',
  'publication.scheduled': 'Scheduled',
  'publication.cancelled': 'Schedule cancelled',
  'publication.failed': 'Failed',
  'publication.outcome_unknown': 'Outcome unknown',
};

/**
 * `GET /api/publications` (one row of it), `GET /content-items/:id` (+ `/versions`, `/approval`),
 * `POST /api/publications/:id/cancel`, `POST /api/publications/reconcile`, `POST /content-items/:id/publish`,
 * `GET /api/audit` with `audit.read`. Shown at `/publishing/<publicationId>`.
 */
export function PublicationDetail({ id }: { id: string }) {
  const { open, can, personName, companyName, refreshNotifications } = useWorkspace();
  const publications = useApiData<PublicationDto[]>('/publications');
  const publication = publications.data?.find((row) => row.id === id) ?? null;
  const itemId = publication?.contentItemId ?? null;
  const item = useApiData<ContentItemDto>(itemId ? `/content-items/${itemId}` : null);
  const versions = useApiData<ContentVersionDto[]>(
    itemId ? `/content-items/${itemId}/versions` : null,
  );
  const approval = useApiData<ApprovalRequestFullDto | null>(
    itemId ? `/content-items/${itemId}/approval` : null,
  );
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);
  const audit = useApiData<AuditEvent[]>(
    publication && can('audit.read', publication.companyId)
      ? `/audit${queryString({ targetType: 'publication', targetId: id, limit: 100 })}`
      : null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reconciled, setReconciled] = useState<{ result: ReconcileResultDto; at: Date } | null>(
    null,
  );
  const [settled, setSettled] = useState<Record<string, SettleStuckKeyResultDto>>({});

  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const account = accountList.find((entry) => entry.id === publication?.socialAccountId);
  const version = versions.data?.find((entry) => entry.id === publication?.contentVersionId);
  const siblings = (publications.data ?? []).filter(
    (row) => row.contentItemId === itemId && row.id !== id,
  );

  const reread = () => {
    publications.reload();
    item.reload();
    versions.reload();
    approval.reload();
    audit.reload();
    freezes.reload();
    refreshNotifications();
  };

  const crumbs = [{ label: TEXT.list, onClick: () => open('publishing') }, { label: shortId(id) }];
  if (publications.error)
    return (
      <>
        <PageHeader title={TEXT.loadError} crumbs={crumbs} />
        <ErrorBox error={publications.error} title={TEXT.loadError} loading />
      </>
    );
  if (!publications.data)
    return (
      <>
        <PageHeader title="…" crumbs={crumbs} />
        <Skeletons rows={6} />
      </>
    );
  if (!publication)
    return (
      <>
        <PageHeader
          title={TEXT.notFound}
          crumbs={crumbs}
          actions={
            <button type="button" className="btn btn-outline" onClick={() => open('publishing')}>
              {TEXT.back}
            </button>
          }
        />
        <EmptyBlock title={TEXT.notFound}>{TEXT.notFoundBody}</EmptyBlock>
      </>
    );

  const accountName = account
    ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
    : `Account ${shortId(publication.socialAccountId)}`;
  const mayPublish = can('content.publish', publication.companyId);
  const mayCancel = publication.status === 'scheduled' && mayPublish;
  const mayCheck =
    (publication.status === 'pending' || publication.status === 'scheduled') && mayPublish;
  const mayAgain =
    (publication.status === 'failed' || publication.status === 'cancelled') &&
    mayPublish &&
    item.data?.status === 'approved' &&
    item.data.currentVersionId === publication.contentVersionId;
  const approvedAt =
    approval.data && approval.data.contentVersionId === publication.contentVersionId
      ? approval.data.decisions.find(
          (decision) =>
            decision.decision === 'approved' && decision.decidedBy === publication.approvedBy,
        )?.decidedAt
      : undefined;
  const readiness = account ? accountReadiness(account) : null;
  const relevantKeys = reconciled
    ? {
        ...reconciled.result,
        unresolvedKeys: reconciled.result.unresolvedKeys.filter((key) => key.publicationId === id),
      }
    : null;
  const whyNot: string[] = [];
  if (!mayPublish) whyNot.push(needsRoleHint('content.publish'));
  else {
    if (publication.status !== 'scheduled') whyNot.push(TEXT.mayNotCancel);
    if (!mayAgain) whyNot.push(TEXT.mayNotAgain);
    if (!mayCheck) whyNot.push(TEXT.mayNotCheck);
  }

  return (
    <div className="wk-grid">
      <PageHeader
        eyebrow="Publishing"
        crumbs={crumbs}
        title={TEXT.title(accountName)}
        description={TEXT.description}
        meta={
          <>
            <StatusChip status={PUBLICATION_STATUS[publication.status]} />
            <span className="wk-chip">{companyName(publication.companyId)}</span>
            <CopyId value={publication.id} />
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => open('content', publication.contentItemId, { tab: 'publications' })}
            >
              {TEXT.openPost}
            </button>
            {publication.externalPostUrl && (
              <a
                className="btn btn-outline"
                href={publication.externalPostUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open on the network
              </a>
            )}
            <ReconcileButton
              onDone={reread}
              onResult={(result) => {
                setSettled({});
                setReconciled({ result, at: new Date() });
              }}
              disabled={!mayCheck}
              title={
                mayCheck
                  ? undefined
                  : mayPublish
                    ? TEXT.mayNotCheck
                    : needsRoleHint('content.publish')
              }
            />
            <button
              type="button"
              className="btn btn-outline"
              disabled={!mayAgain}
              title={
                mayAgain
                  ? undefined
                  : mayPublish
                    ? TEXT.mayNotAgain
                    : needsRoleHint('content.publish')
              }
              onClick={() => setPublishing(true)}
            >
              {TEXT.again}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!mayCancel}
              title={
                mayCancel
                  ? undefined
                  : mayPublish
                    ? TEXT.mayNotCancel
                    : needsRoleHint('content.publish')
              }
              onClick={() => setCancelling(true)}
            >
              {TEXT.cancelSchedule}
            </button>
          </>
        }
      />
      <div className="wk-facts">
        <Fact
          label={TEXT.facts.status}
          value={PUBLICATION_STATUS[publication.status].label}
          note={relativeAge(publication.requestedAt)}
        />
        <Fact
          label={TEXT.facts.when}
          value={
            <span className="wk-fact-text">
              {publication.scheduledAt ? formatDateTime(publication.scheduledAt) : TEXT.facts.now}
            </span>
          }
        />
        <Fact
          label={TEXT.facts.done}
          value={
            <span className="wk-fact-text">
              {publication.completedAt
                ? formatDateTime(publication.completedAt)
                : TEXT.facts.notYet}
            </span>
          }
        />
        <Fact
          label={TEXT.facts.by}
          value={<span className="wk-fact-text">{personName(publication.requestedBy)}</span>}
        />
      </div>
      <ErrorBox error={item.error ?? versions.error ?? accounts.error} loading />
      {reconciled && relevantKeys && (
        <div style={{ marginBottom: 18 }}>
          <UnresolvedKeysPanel
            result={relevantKeys}
            checkedAt={reconciled.at}
            accountOf={() => accountName}
            onHide={() => setReconciled(null)}
            canSettle={mayPublish}
            settled={settled}
            onSettled={(answer) => {
              setSettled((current) => ({ ...current, [answer.key]: answer }));
              reread();
            }}
          />
        </div>
      )}
      <Callout
        tone={
          publication.status === 'failed'
            ? 'danger'
            : publication.status === 'pending'
              ? 'warn'
              : 'info'
        }
      >
        {PUBLICATION_MEANING[publication.status]}
      </Callout>
      <div className="wk-pub-layout" style={{ marginTop: 18 }}>
        <div className="wk-stack">
          {publication.error && (
            <section className="wk-card">
              <div className="wk-card-head">
                <div>
                  <h2>{TEXT.error}</h2>
                  <p>{TEXT.errorHint}</p>
                </div>
              </div>
              <p className="wk-error-text">{publication.error}</p>
            </section>
          )}
          <section className="wk-card">
            <div className="wk-card-head">
              <div>
                <h2>{TEXT.sent}</h2>
                {version && (
                  <p>
                    {TEXT.version(version.versionNumber)} · {personName(version.createdBy)}
                  </p>
                )}
              </div>
            </div>
            {versions.loading && !version ? (
              <Skeletons rows={3} />
            ) : version ? (
              <div className="wk-stack">
                <div className="wk-text-box">
                  <p className="wk-body-text">{version.body}</p>
                </div>
                {account && (
                  <div>
                    <h3 className="label">{TEXT.previews}</h3>
                    <PostPreviews accounts={[account]} body={version.body} media={version.media} />
                  </div>
                )}
                {version.media.length > 0 && (
                  <div>
                    <h3 className="label">{TEXT.media}</h3>
                    <MediaGallery media={version.media} />
                  </div>
                )}
              </div>
            ) : null}
          </section>
          <section className="wk-card">
            <div className="wk-card-head">
              <h2>{TEXT.happened}</h2>
            </div>
            <Timeline items={publicationTimeline(publication, personName, approvedAt)} />
          </section>
        </div>
        <div className="wk-stack">
          <section className="wk-card">
            <div className="wk-card-head">
              <h2>{TEXT.readiness}</h2>
            </div>
            {readiness && account && (
              <div className="wk-stack">
                <div className="wk-row">
                  <StatusChip label={readiness.label} tone={readiness.tone} />
                  <span className="wk-hint">{readiness.detail}</span>
                </div>
                <p className="wk-hint">
                  {TEXT.engineChannel}:{' '}
                  {account.engineChannelId ? (
                    <code className="wk-code">{account.engineChannelId}</code>
                  ) : (
                    TEXT.notLinked
                  )}
                </p>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <EngineBanner accounts={account ? [account] : []} compact />
            </div>
          </section>
          <section className="wk-card">
            <div className="wk-card-head">
              <h2>Every field</h2>
            </div>
            <PublicationFacts
              publication={publication}
              account={account}
              versionNumber={version?.versionNumber}
              onOpenPost={() => open('content', publication.contentItemId)}
            />
          </section>
          <section className="wk-card">
            <div className="wk-card-head">
              <h2>{TEXT.related}</h2>
            </div>
            {siblings.length === 0 ? (
              <p className="wk-hint">{TEXT.relatedNone}</p>
            ) : (
              <ul className="wk-related">
                {siblings.map((row) => (
                  <li key={row.id}>
                    <span>
                      <AccountChip
                        account={accountList.find((entry) => entry.id === row.socialAccountId)}
                        id={row.socialAccountId}
                      />{' '}
                      <StatusChip status={PUBLICATION_STATUS[row.status]} />
                    </span>
                    <button
                      type="button"
                      className="wk-link"
                      onClick={() => open('publishing', row.id)}
                    >
                      {TEXT.relatedOpen}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {whyNot.length > 0 && publication.status !== 'published' && (
            <WhyBox reasons={whyNot} title={TEXT.mayNot} />
          )}
          <section className="wk-card">
            <div className="wk-card-head">
              <div>
                <h2>{TEXT.audit}</h2>
                <p>{TEXT.auditNote}</p>
              </div>
            </div>
            {!can('audit.read', publication.companyId) ? (
              <WhyBox
                reasons={[needsRoleHint('audit.read'), TEXT.auditNeeds]}
                title="Why you cannot see it"
              />
            ) : audit.error ? (
              <ErrorBox error={audit.error} title={TEXT.auditError} loading />
            ) : audit.loading && !audit.data ? (
              <Skeletons rows={3} />
            ) : (audit.data ?? []).length === 0 ? (
              <p className="wk-hint">{TEXT.auditEmpty}</p>
            ) : (
              <ol className="wk-audit-list">
                {(audit.data ?? []).map((event) => (
                  <li key={event.id}>
                    <strong>{AUDIT_ACTIONS[event.action] ?? event.action}</strong>
                    <span>
                      {event.actor_user_id ? personName(event.actor_user_id) : TEXT.system} ·{' '}
                      {formatDateTime(event.occurred_at)}
                    </span>
                    <code>{event.action}</code>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
      {cancelling && (
        <CancelPublicationDialog
          publication={publication}
          accountName={accountName}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            reread();
          }}
        />
      )}
      {publishing && item.data && (
        <PublishDialog
          item={item.data}
          accounts={accountList}
          publications={publications.data}
          freezes={can('publishing.freeze') && freezes.data ? freezes.data : null}
          initialAccountId={publication.socialAccountId}
          onClose={() => setPublishing(false)}
          onDone={(created) => {
            setPublishing(false);
            reread();
            open('publishing', created.id);
          }}
        />
      )}
    </div>
  );
}
