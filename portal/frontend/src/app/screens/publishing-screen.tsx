'use client';

import { useState } from 'react';
import {
  CONTENT_ITEM_STATUSES,
  CreateFreezeRequest,
  PublishContentRequest,
  type ContentItemDto,
  type ContentItemStatus,
  type ContentVersionDto,
  type FreezeDto,
  type PublicationDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { Dialog, DialogActions } from '@/components/dialog';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { byNewest, currentVersionOf, useContentVersions } from '@/lib/content';
import {
  blankToUndefined,
  fieldErrorsFromApi,
  maxLengthOf,
  validate,
  type FieldErrors,
} from '@/lib/forms';
import { excerpt, formatDateTime, shortId } from '@/lib/format';
import { CONTENT_STATUS, PLATFORM_LABELS, PUBLICATION_STATUS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Publishing workspace',
  description: 'Approved posts ready to go out, what was sent, and the emergency freeze.',
  freeze: 'Freeze publishing',
  ready: 'Approved and ready',
  readyFoot: 'Waiting for a publisher',
  scheduled: 'Scheduled',
  scheduledFoot: 'Held by the engine until their time',
  published: 'Published',
  publishedFoot: 'Publications recorded by DCC',
  failed: 'Failed',
  failedFoot: 'Need a look',
  filterStatus: 'Filter content by status',
  queue: 'Content',
  queueSubtitle:
    'Only an approved post can be published, to one of the accounts it was approved for.',
  queueCaption: 'Content items',
  content: 'Content',
  status: 'Status',
  company: 'Company',
  updated: 'Updated',
  actions: 'Actions',
  publish: 'Publish…',
  publishLabel: (text: string) => `Publish: ${text}`,
  noText: '(text not loaded)',
  emptyTitle: 'No matching content',
  emptyBody: 'Try another status, or wait for a post to be approved.',
  publications: 'Publications',
  publicationsSubtitle: 'Every attempt to send a post through DCC',
  publicationsCaption: 'Publications',
  account: 'Account',
  requested: 'Requested',
  result: 'Result',
  scheduledFor: (when: string) => `for ${when}`,
  openPost: 'Open the post',
  noPublications: 'Nothing has been published yet',
  freezes: 'Publishing freezes',
  freezesSubtitle:
    'A freeze stops publishing through DCC. It cannot stop someone posting directly on the network.',
  freezesCaption: 'Active publishing freezes',
  scope: 'Scope',
  wholeCompany: 'Whole company',
  reason: 'Reason',
  frozenBy: 'Frozen by',
  lift: 'Lift freeze',
  liftLabel: (scope: string) => `Lift the freeze on ${scope}`,
  noFreezes: 'Publishing is not frozen anywhere you can see',
  liftNote: 'Lifting a freeze may ask you to sign in again first.',
  lifted: 'Freeze lifted.',
  dialogPublish: 'Publish this post',
  target: 'Account',
  targetHint: 'Only the accounts this version was approved for.',
  when: 'When',
  now: 'Now',
  later: 'At a later time',
  at: 'Date and time',
  atHint: 'Your local time. It must be in the future.',
  cancel: 'Cancel',
  confirmPublish: 'Publish',
  confirmSchedule: 'Schedule',
  working: 'Working…',
  done: 'Sent. The lists were read again from DCC.',
  dialogFreeze: 'Freeze publishing',
  freezeAccount: 'What to freeze',
  reasonHint: 'Optional. It is recorded in the audit trail.',
  confirmFreeze: 'Freeze',
  frozen: 'Publishing frozen.',
};

/**
 * `GET /api/content-items` (+ versions), `POST /api/content-items/:id/publish` (now or scheduled),
 * `GET /api/publications`, `GET/POST /api/publishing-freezes`, `DELETE /api/publishing-freezes/:id`.
 */
export function PublishingScreen() {
  const { companyId, companyName, personName, can, companiesWhere, refreshNotifications } =
    useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const mayFreeze = companiesWhere('publishing.freeze').length > 0;
  const items = useApiData<ContentItemDto[]>('/content-items');
  const publications = useApiData<PublicationDto[]>('/publications');
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);
  const [status, setStatus] = useState<ContentItemStatus | ''>('approved');
  const [publishing, setPublishing] = useState<ContentItemDto | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [versionsKey, setVersionsKey] = useState(0);

  const inScope = <T extends { companyId: string }>(rows: T[] | null) =>
    (rows ?? []).filter((row) => !companyId || row.companyId === companyId);
  const scopedItems = inScope(items.data);
  const visible = byNewest(scopedItems.filter((item) => !status || item.status === status)).slice(
    0,
    30,
  );
  const { versionsByItem } = useContentVersions(visible, versionsKey);
  const scopedPublications = inScope(publications.data);
  const accountName = (id: string) => {
    const account = accounts.data?.find((entry) => entry.id === id);
    return account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : `Account ${shortId(id)}`;
  };
  const countPublications = (value: PublicationDto['status']) =>
    scopedPublications.filter((row) => row.status === value).length;
  const rereadAll = () => {
    items.reload();
    publications.reload();
    freezes.reload();
    setVersionsKey((value) => value + 1);
    refreshNotifications();
  };
  const freezeScope = (freeze: FreezeDto) =>
    `${companyName(freeze.companyId)} · ${
      freeze.socialAccountId ? accountName(freeze.socialAccountId) : TEXT.wholeCompany
    }`;

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          mayFreeze && (
            <button className="btn btn-danger" onClick={() => setFreezing(true)}>
              {TEXT.freeze}
            </button>
          )
        }
      />
      <ErrorBox error={items.error ?? publications.error} loading />
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <StatCard
          label={TEXT.ready}
          value={String(scopedItems.filter((item) => item.status === 'approved').length)}
          foot={TEXT.readyFoot}
          icon="✓"
        />
        <StatCard
          label={TEXT.scheduled}
          value={String(countPublications('scheduled'))}
          foot={TEXT.scheduledFoot}
          icon="◷"
        />
        <StatCard
          label={TEXT.published}
          value={String(countPublications('published'))}
          foot={TEXT.publishedFoot}
          icon="↗"
        />
        <StatCard
          label={TEXT.failed}
          value={String(countPublications('failed'))}
          foot={TEXT.failedFoot}
          icon="!"
        />
      </div>
      {can('publishing.freeze') && (
        <div style={{ marginBottom: 18 }}>
          <SectionPanel title={TEXT.freezes} subtitle={TEXT.freezesSubtitle}>
            <ErrorBox error={freezes.error} loading />
            <ErrorBox error={action.error} />
            {freezes.data && (
              <DataTable
                caption={TEXT.freezesCaption}
                rows={inScope(freezes.data)}
                rowKey={(row) => row.id}
                empty={<EmptyState title={TEXT.noFreezes} />}
                columns={[
                  { header: TEXT.scope, cell: freezeScope },
                  { header: TEXT.reason, cell: (row) => row.reason ?? '—' },
                  {
                    header: TEXT.frozenBy,
                    cell: (row) => (
                      <>
                        {personName(row.frozenBy)}
                        <span className="subline">{formatDateTime(row.frozenAt)}</span>
                      </>
                    ),
                  },
                  {
                    header: TEXT.actions,
                    cell: (row) =>
                      can('publishing.freeze', row.companyId) ? (
                        <button
                          className="text-link"
                          disabled={action.busy}
                          aria-label={TEXT.liftLabel(freezeScope(row))}
                          onClick={async () => {
                            const failure = await action.run(() =>
                              apiSend('DELETE', `/publishing-freezes/${row.id}`),
                            );
                            rereadAll();
                            if (!failure) showToast(TEXT.lifted);
                          }}
                        >
                          {TEXT.lift}
                        </button>
                      ) : null,
                  },
                ]}
              />
            )}
            <small className="hint">{TEXT.liftNote}</small>
          </SectionPanel>
        </div>
      )}
      <div className="filter-row">
        <select
          className="select-field"
          aria-label={TEXT.filterStatus}
          value={status}
          onChange={(event) => setStatus(event.target.value as ContentItemStatus | '')}
        >
          <option value="">All statuses</option>
          {CONTENT_ITEM_STATUSES.map((value) => (
            <option key={value} value={value}>
              {CONTENT_STATUS[value].label}
            </option>
          ))}
        </select>
      </div>
      <SectionPanel title={TEXT.queue} subtitle={TEXT.queueSubtitle}>
        {!items.data && items.loading ? (
          <LoadingState />
        ) : (
          <DataTable
            caption={TEXT.queueCaption}
            rows={visible}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>}
            columns={[
              {
                header: TEXT.content,
                cell: (row) => {
                  const version = currentVersionOf(row, versionsByItem[row.id]);
                  return (
                    <>
                      <span className="post-title">
                        {version ? excerpt(version.body) : TEXT.noText}
                      </span>
                      <span className="subline">
                        {version ? version.targetAccountIds.map(accountName).join(', ') : ''}
                      </span>
                    </>
                  );
                },
              },
              {
                header: TEXT.status,
                cell: (row) => <StatusChip status={CONTENT_STATUS[row.status]} />,
              },
              { header: TEXT.company, cell: (row) => companyName(row.companyId) },
              { header: TEXT.updated, cell: (row) => formatDateTime(row.updatedAt) },
              {
                header: TEXT.actions,
                cell: (row) => {
                  const version = currentVersionOf(row, versionsByItem[row.id]);
                  return row.status === 'approved' && can('content.publish', row.companyId) ? (
                    <button
                      className="text-link"
                      aria-label={TEXT.publishLabel(version ? excerpt(version.body, 40) : '')}
                      onClick={() => setPublishing(row)}
                    >
                      {TEXT.publish}
                    </button>
                  ) : null;
                },
              },
            ]}
          />
        )}
      </SectionPanel>
      <div style={{ marginTop: 18 }}>
        <SectionPanel title={TEXT.publications} subtitle={TEXT.publicationsSubtitle}>
          {publications.data && (
            <DataTable
              caption={TEXT.publicationsCaption}
              rows={byNewest(
                scopedPublications.map((row) => ({ ...row, createdAt: row.requestedAt })),
              )}
              rowKey={(row) => row.id}
              empty={<EmptyState title={TEXT.noPublications} />}
              columns={[
                {
                  header: TEXT.account,
                  cell: (row) => (
                    <>
                      <span className="post-title">{accountName(row.socialAccountId)}</span>
                      <span className="subline">{companyName(row.companyId)}</span>
                    </>
                  ),
                },
                {
                  header: TEXT.status,
                  cell: (row) => (
                    <>
                      <StatusChip status={PUBLICATION_STATUS[row.status]} />
                      {row.scheduledAt && (
                        <span className="subline">
                          {TEXT.scheduledFor(formatDateTime(row.scheduledAt))}
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  header: TEXT.requested,
                  cell: (row) => (
                    <>
                      {formatDateTime(row.requestedAt)}
                      <span className="subline">{personName(row.requestedBy)}</span>
                    </>
                  ),
                },
                {
                  header: TEXT.result,
                  cell: (row) =>
                    row.error ? (
                      row.error
                    ) : row.externalPostUrl ? (
                      <a
                        className="text-link"
                        href={row.externalPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {TEXT.openPost}
                      </a>
                    ) : (
                      formatDateTime(row.completedAt)
                    ),
                },
              ]}
            />
          )}
        </SectionPanel>
      </div>
      {publishing && (
        <PublishDialog
          item={publishing}
          accounts={accounts.data ?? []}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            rereadAll();
          }}
        />
      )}
      {freezing && (
        <FreezeDialog
          accounts={accounts.data ?? []}
          onClose={() => setFreezing(false)}
          onDone={() => {
            setFreezing(false);
            rereadAll();
          }}
        />
      )}
    </>
  );
}

function PublishDialog({
  item,
  accounts,
  onClose,
  onDone,
}: {
  item: ContentItemDto;
  accounts: SocialAccountDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const versions = useApiData<ContentVersionDto[]>(`/content-items/${item.id}/versions`);
  const version = currentVersionOf(item, versions.data ?? undefined);
  const targets = accounts.filter((account) => version?.targetAccountIds.includes(account.id));
  const [chosen, setChosen] = useState('');
  const [later, setLater] = useState(false);
  const [at, setAt] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const socialAccountId = chosen || targets[0]?.id || '';

  const submit = async () => {
    const when = later && at ? new Date(at) : null;
    const checked = validate(PublishContentRequest, {
      socialAccountId,
      scheduledAt: later
        ? when && !Number.isNaN(when.getTime())
          ? when.toISOString()
          : at
        : undefined,
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('POST', `/content-items/${item.id}/publish`, checked.data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.done);
    onDone();
  };

  return (
    <Dialog title={TEXT.dialogPublish} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={versions.error} loading />
        <ErrorBox error={action.error} />
        {version && (
          <div className="preview-card" style={{ marginBottom: 14 }}>
            <div className="preview-body" style={{ whiteSpace: 'pre-wrap' }}>
              {version.body}
            </div>
          </div>
        )}
        <FormField
          label={TEXT.target}
          hint={TEXT.targetHint}
          error={errors.socialAccountId}
          required
        >
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={socialAccountId}
              onChange={(event) => setChosen(event.target.value)}
            >
              {targets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName} ({PLATFORM_LABELS[account.platform]})
                </option>
              ))}
            </select>
          )}
        </FormField>
        <fieldset className="field-group" style={{ border: 0, padding: 0 }}>
          <legend className="label">{TEXT.when}</legend>
          <div className="platform-list">
            <label className="platform-option">
              <input
                type="radio"
                name="publish-when"
                checked={!later}
                onChange={() => setLater(false)}
              />
              {TEXT.now}
            </label>
            <label className="platform-option">
              <input
                type="radio"
                name="publish-when"
                checked={later}
                onChange={() => setLater(true)}
              />
              {TEXT.later}
            </label>
          </div>
        </fieldset>
        {later && (
          <FormField label={TEXT.at} hint={TEXT.atHint} error={errors.scheduledAt} required>
            {(control) => (
              <input
                className="field"
                type="datetime-local"
                {...control}
                value={at}
                onChange={(event) => setAt(event.target.value)}
              />
            )}
          </FormField>
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={action.busy || !socialAccountId}
          >
            {action.busy ? TEXT.working : later ? TEXT.confirmSchedule : TEXT.confirmPublish}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function FreezeDialog({
  accounts,
  onClose,
  onDone,
}: {
  accounts: SocialAccountDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { companiesWhere } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('publishing.freeze');
  const [form, setForm] = useState({
    companyId: companies[0]?.id ?? '',
    socialAccountId: '',
    reason: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const checked = validate(CreateFreezeRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/publishing-freezes', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.frozen);
    onDone();
  };

  return (
    <Dialog title={TEXT.dialogFreeze} description={TEXT.freezesSubtitle} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <FormField label={TEXT.company} error={errors.companyId} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.companyId}
              onChange={(event) =>
                setForm({ ...form, companyId: event.target.value, socialAccountId: '' })
              }
            >
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.freezeAccount} error={errors.socialAccountId}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.socialAccountId}
              onChange={(event) => setForm({ ...form, socialAccountId: event.target.value })}
            >
              <option value="">{TEXT.wholeCompany}</option>
              {accounts
                .filter((account) => account.companyId === form.companyId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} ({PLATFORM_LABELS[account.platform]})
                  </option>
                ))}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.reason} hint={TEXT.reasonHint} error={errors.reason}>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.reason}
              maxLength={maxLengthOf(CreateFreezeRequest.shape.reason)}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          )}
        </FormField>
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-danger" disabled={action.busy}>
            {action.busy ? TEXT.working : TEXT.confirmFreeze}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
