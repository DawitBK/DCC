'use client';

import type { ContentVersionDto, PublicationDto, SocialAccountDto } from '@dcc/contracts';
import { StatusChip } from '@/components/status-chip';
import { ErrorBox } from '@/components/error-box';
import { Callout, DescriptionList, Timeline, type TimelineItem } from '@/components/kit/parts';
import { Drawer } from '@/components/kit/drawer';
import { formatDateTime, shortId } from '@/lib/format';
import { PLATFORM_LABELS, PUBLICATION_STATUS } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { isRemoved, recordOf } from '@/lib/removal';
import { PUBLICATION_MEANING } from '@/lib/work';
import { Skeletons } from './parts';
import '@/app/screens/work-shared.css';

const TEXT = {
  approved: (name: string) => `Approved by ${name}`,
  approvedUnknownTime: 'The time of the approval is on the post’s Approval tab.',
  requested: (name: string) => `Publish requested by ${name}`,
  requestedNow: 'To go out now.',
  requestedLater: (when: string) => `To go out at ${when}.`,
  waiting: 'Waiting for the engine’s answer',
  waitingDetail: 'DCC was not told whether it went out. It will not send it again by itself.',
  planned: 'Waiting for its planned time',
  plannedDetail: (when: string) => `The engine sends it on ${when}.`,
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
  publishedDetail: 'The post went out to the network.',
  cancelledDetail: 'Cancelled before its time. The post stays approved.',
  removed: (name: string) => `Removed by ${name}`,
  removedNoReason: 'No reason was recorded.',
  status: 'Status',
  company: 'Company',
  account: 'Account',
  post: 'Post',
  version: 'Version',
  requestedBy: 'Requested by',
  requestedAt: 'Requested at',
  approvedBy: 'Approved by',
  plannedFor: 'Planned for',
  completedAt: 'Finished at',
  engineRef: 'Engine reference',
  externalPost: 'Post on the network',
  openExternal: 'Open the post on the network',
  none: '—',
  error: 'What went wrong',
  openPost: 'Open the post',
  openPublication: 'Open the publication',
  cancel: 'Cancel the schedule',
  close: 'Close',
  title: (account: string) => `Publication · ${account}`,
  text: 'What was sent',
  textError: 'The text of this publication could not be read',
  publicationId: 'Publication id',
};

/** What happened to a publication, in order, newest first: the outcome, the request, the approval. */
export function publicationTimeline(
  publication: PublicationDto,
  personName: (id: string | null) => string,
  approvedAt?: string | null,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const { status } = publication;
  if (isRemoved(publication)) {
    const removal = recordOf(publication);
    items.push({
      id: 'removed',
      when: formatDateTime(removal.removedAt),
      tone: 'red',
      title: TEXT.removed(personName(removal.removedBy)),
      detail: removal.removalReason ?? TEXT.removedNoReason,
    });
    items.push({
      id: 'outcome',
      when: formatDateTime(publication.completedAt),
      tone: 'green',
      title: TEXT.published,
      detail: TEXT.publishedDetail,
    });
  } else if (status === 'published')
    items.push({
      id: 'outcome',
      when: formatDateTime(publication.completedAt),
      tone: 'green',
      title: TEXT.published,
      detail: TEXT.publishedDetail,
    });
  else if (status === 'failed')
    items.push({
      id: 'outcome',
      when: formatDateTime(publication.completedAt),
      tone: 'red',
      title: TEXT.failed,
      detail: publication.error ?? undefined,
    });
  else if (status === 'cancelled')
    items.push({
      id: 'outcome',
      when: formatDateTime(publication.completedAt),
      tone: 'gray',
      title: TEXT.cancelled,
      detail: TEXT.cancelledDetail,
    });
  else if (status === 'scheduled')
    items.push({
      id: 'outcome',
      when: formatDateTime(publication.scheduledAt),
      tone: 'blue',
      title: TEXT.planned,
      detail: TEXT.plannedDetail(formatDateTime(publication.scheduledAt)),
    });
  else
    items.push({
      id: 'outcome',
      when: formatDateTime(publication.requestedAt),
      tone: 'amber',
      title: TEXT.waiting,
      detail: TEXT.waitingDetail,
    });
  items.push({
    id: 'requested',
    when: formatDateTime(publication.requestedAt),
    tone: 'blue',
    title: TEXT.requested(personName(publication.requestedBy)),
    detail: publication.scheduledAt
      ? TEXT.requestedLater(formatDateTime(publication.scheduledAt))
      : TEXT.requestedNow,
  });
  if (publication.approvedBy)
    items.push({
      id: 'approved',
      when: approvedAt ? formatDateTime(approvedAt) : TEXT.approvedUnknownTime,
      tone: 'green',
      title: TEXT.approved(personName(publication.approvedBy)),
    });
  return items;
}

/** Every field of a publication, as the API holds it. */
export function PublicationFacts({
  publication,
  account,
  versionNumber,
  onOpenPost,
  onOpenAccount,
}: {
  publication: PublicationDto;
  account: SocialAccountDto | undefined;
  versionNumber?: number;
  onOpenPost?: () => void;
  onOpenAccount?: () => void;
}) {
  const { personName, companyName } = useWorkspace();
  const name = account
    ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
    : `Account ${shortId(publication.socialAccountId)}`;
  return (
    <DescriptionList
      columns={2}
      items={[
        {
          label: TEXT.status,
          value: <StatusChip status={PUBLICATION_STATUS[publication.status]} />,
          hint: PUBLICATION_MEANING[publication.status],
        },
        { label: TEXT.company, value: companyName(publication.companyId) },
        {
          label: TEXT.account,
          value: onOpenAccount ? (
            <button type="button" className="wk-link" onClick={onOpenAccount}>
              {name}
            </button>
          ) : (
            name
          ),
        },
        {
          label: TEXT.post,
          value: onOpenPost ? (
            <button type="button" className="wk-link" onClick={onOpenPost}>
              {TEXT.openPost}
              {versionNumber ? ` · ${TEXT.version} ${versionNumber}` : ''}
            </button>
          ) : (
            shortId(publication.contentItemId)
          ),
        },
        { label: TEXT.requestedBy, value: personName(publication.requestedBy) },
        { label: TEXT.requestedAt, value: formatDateTime(publication.requestedAt) },
        {
          label: TEXT.approvedBy,
          value: publication.approvedBy ? personName(publication.approvedBy) : TEXT.none,
        },
        {
          label: TEXT.plannedFor,
          value: publication.scheduledAt ? formatDateTime(publication.scheduledAt) : TEXT.none,
        },
        { label: TEXT.completedAt, value: formatDateTime(publication.completedAt) },
        {
          label: TEXT.engineRef,
          value: publication.engineOperationId ? (
            <code className="wk-code">{publication.engineOperationId}</code>
          ) : (
            TEXT.none
          ),
        },
        {
          label: TEXT.externalPost,
          value: publication.externalPostUrl ? (
            <a
              className="wk-link"
              href={publication.externalPostUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {TEXT.openExternal}
            </a>
          ) : (
            TEXT.none
          ),
        },
        { label: TEXT.publicationId, value: <code className="wk-code">{publication.id}</code> },
      ]}
    />
  );
}

/**
 * A quick look at one publication without leaving the list or the calendar: its facts, what happened to it, the
 * text that was sent, and the actions this person may take. The same facts, in full, are on the publication page.
 */
export function PublicationDrawer({
  publication,
  accounts,
  onClose,
  onCancel,
}: {
  publication: PublicationDto;
  accounts: readonly SocialAccountDto[];
  onClose: () => void;
  /** Ask to cancel a schedule. The screen closes this panel and opens its confirmation, so two layers never stack. */
  onCancel: (publication: PublicationDto) => void;
}) {
  const { open, can, personName, screenAllowed } = useWorkspace();
  const account = accounts.find((entry) => entry.id === publication.socialAccountId);
  const versions = useApiData<ContentVersionDto[]>(
    `/content-items/${publication.contentItemId}/versions`,
  );
  const version = versions.data?.find((entry) => entry.id === publication.contentVersionId);
  const mayCancel =
    publication.status === 'scheduled' && can('content.publish', publication.companyId);
  const name = account
    ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
    : `Account ${shortId(publication.socialAccountId)}`;

  return (
    <Drawer
      title={TEXT.title(name)}
      subtitle={PUBLICATION_STATUS[publication.status].label}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => open('content', publication.contentItemId)}
          >
            {TEXT.openPost}
          </button>
          {screenAllowed('publishing') && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => open('publishing', publication.id)}
            >
              {TEXT.openPublication}
            </button>
          )}
          {mayCancel && (
            <button type="button" className="btn btn-danger" onClick={() => onCancel(publication)}>
              {TEXT.cancel}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {TEXT.close}
          </button>
        </>
      }
    >
      <div className="wk-stack">
        <Callout tone={publication.status === 'failed' ? 'danger' : 'info'}>
          {PUBLICATION_MEANING[publication.status]}
        </Callout>
        {publication.error && (
          <div>
            <span className="label">{TEXT.error}</span>
            <p className="wk-error-text">{publication.error}</p>
          </div>
        )}
        <div>
          <span className="label">{TEXT.text}</span>
          <ErrorBox error={versions.error} title={TEXT.textError} loading />
          {versions.loading && !version && <Skeletons rows={2} />}
          {version && (
            <div className="wk-text-box">
              <p className="wk-body-text">{version.body}</p>
            </div>
          )}
        </div>
        <PublicationFacts
          publication={publication}
          account={account}
          versionNumber={version?.versionNumber}
        />
        <div>
          <h3 className="label">What happened</h3>
          <Timeline items={publicationTimeline(publication, personName)} />
        </div>
      </div>
    </Drawer>
  );
}
