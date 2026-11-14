'use client';

import { useEffect, useState } from 'react';
import {
  CreateContentItemRequest,
  EditContentItemRequest,
  type ApprovalRequestDto,
  type BrandDto,
  type ContentCategoryDto,
  type ContentItemDto,
  type ContentItemWithVersionDto,
  type ContentVersionDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
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
import { excerpt, formatDateTime } from '@/lib/format';
import {
  ACCOUNT_STATUS,
  APPROVAL_DECISION,
  APPROVAL_REQUEST_STATUS,
  CONTENT_STATUS,
  PLATFORM_LABELS,
} from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Create content',
  description: 'Write a post, choose the accounts it is for, and send it for review.',
  approvalRequired: 'Approval required before publishing',
  newPost: 'New post',
  editing: (version: number) => `Editing · version ${version}`,
  detailsNew: 'A new draft',
  detailsEdit: 'Saving makes a new version. A new version needs a new approval.',
  startNew: '＋ New post',
  company: 'Company workspace',
  category: 'Kind of content',
  categoryHint: 'It decides which approval rule applies. Without one, the company default applies.',
  noCategory: 'No category (company default)',
  brand: 'Brand',
  noBrand: 'No brand',
  fixedAfterCreate: 'Chosen when the post was created; it cannot be changed afterwards.',
  targets: 'Publish to',
  targetsHint: 'The accounts of this company. Choose at least one.',
  noAccounts: 'This company has no registered social accounts yet.',
  body: 'Text of the post',
  bodyPlaceholder: 'Write a clear message…',
  counter: (used: number, max: number | undefined) =>
    max ? `${used} / ${max} characters` : `${used} characters`,
  save: 'Save draft',
  saveVersion: 'Save as new version',
  submit: 'Submit for review',
  working: 'Working…',
  duty: 'Whoever wrote any version of a post cannot review, approve or reject it.',
  saved: 'Saved. The post was read again from DCC.',
  submitted: 'Sent for review.',
  previewTitle: 'Preview',
  previewSubtitle: 'How the text reads before it enters review.',
  previewEmpty: 'Your text will appear here as you write.',
  noTargetsChosen: 'No account chosen yet',
  reviewTitle: 'Review of this version',
  notSubmitted: 'This version has not been sent for review.',
  progress: (done: number, needed: number) => `${done} of ${needed} approvals`,
  listTitle: 'Content in this scope',
  listSubtitle: 'Choose a post to open it',
  listEmpty: 'No content yet',
  listEmptyBody: 'Posts appear here after the first draft is saved.',
  noText: '(text not loaded)',
  noCompany: 'You cannot create content in the chosen company',
  noCompanyBody: 'Choose a company where you hold a content role.',
  versionsError: 'The versions of this post could not be loaded',
};

/**
 * `GET /api/content-items`, `GET /:id/versions`, `GET /:id/approval`, `POST /api/content-items`,
 * `PATCH /:id` (a new version), `POST /:id/submit`, plus `GET /api/social-accounts`,
 * `GET /api/content-categories` and the company's brands for the pickers.
 */
export function ComposerScreen() {
  const { companyId, companiesWhere, companyName, can, personName, refreshNotifications } =
    useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('content.create');
  const items = useApiData<ContentItemDto[]>('/content-items');
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const categories = useApiData<ContentCategoryDto[]>('/content-categories');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    companyId: companies[0]?.id ?? '',
    categoryId: '',
    brandId: '',
    body: '',
  });
  const [targets, setTargets] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [listKey, setListKey] = useState(0);

  const editing = (items.data ?? []).find((item) => item.id === editingId) ?? null;
  const versions = useApiData<ContentVersionDto[]>(
    editingId ? `/content-items/${editingId}/versions` : null,
  );
  const approval = useApiData<ApprovalRequestDto | null>(
    editingId ? `/content-items/${editingId}/approval` : null,
  );
  const current = editing ? currentVersionOf(editing, versions.data ?? undefined) : undefined;
  const formCompany = editing?.companyId ?? form.companyId;
  const brands = useApiData<BrandDto[]>(formCompany ? `/companies/${formCompany}/brands` : null);

  // Opening a post (or the API confirming a new version) puts that version's text in the form.
  const currentId = current?.id;
  useEffect(() => {
    if (!current) return;
    setForm((value) => ({ ...value, body: current.body }));
    setTargets(current.targetAccountIds);
    // Only when a different version arrives; typing must not be overwritten.
  }, [currentId]);

  const companyAccounts = (accounts.data ?? []).filter((item) => item.companyId === formCompany);
  const visibleItems = byNewest(
    (items.data ?? []).filter((item) => !companyId || item.companyId === companyId),
  ).slice(0, 30);
  const { versionsByItem } = useContentVersions(visibleItems, listKey);
  const bodyMax = maxLengthOf(CreateContentItemRequest.shape.body);
  const changed =
    !current ||
    current.body !== form.body.trim() ||
    [...current.targetAccountIds].sort().join() !== [...targets].sort().join();

  const startNew = () => {
    setEditingId(null);
    setForm({ companyId: companies[0]?.id ?? '', categoryId: '', brandId: '', body: '' });
    setTargets([]);
    setErrors({});
    action.clear();
  };
  const reread = () => {
    items.reload();
    versions.reload();
    approval.reload();
    setListKey((value) => value + 1);
  };

  /** Create, or save a new version. Gives back the item id, or null when it was refused. */
  const save = async (): Promise<string | null> => {
    const checked = editing
      ? validate(EditContentItemRequest, { body: form.body, targetAccountIds: targets })
      : validate(
          CreateContentItemRequest,
          blankToUndefined({ ...form, targetAccountIds: targets }),
        );
    if (!checked.ok) {
      setErrors(checked.errors);
      return null;
    }
    setErrors({});
    let saved: ContentItemWithVersionDto | undefined;
    const failure = await action.run(async () => {
      saved = editing
        ? await apiSend<ContentItemWithVersionDto>(
            'PATCH',
            `/content-items/${editing.id}`,
            checked.data,
          )
        : await apiSend<ContentItemWithVersionDto>('POST', '/content-items', checked.data);
    });
    if (failure || !saved) {
      if (failure) setErrors(fieldErrorsFromApi(failure));
      return null;
    }
    setEditingId(saved.id);
    return saved.id;
  };

  const onSave = async () => {
    const id = await save();
    reread();
    if (id) showToast(TEXT.saved);
  };
  const onSubmit = async () => {
    const id = changed ? await save() : editingId;
    if (!id) return reread();
    const failure = await action.run(() => apiSend('POST', `/content-items/${id}/submit`));
    reread();
    if (!failure) {
      showToast(TEXT.submitted);
      refreshNotifications();
    }
  };

  if (companies.length === 0 && !editing) {
    return (
      <>
        <PageTitle title={TEXT.title} description={TEXT.description} />
        <EmptyState title={TEXT.noCompany}>{TEXT.noCompanyBody}</EmptyState>
      </>
    );
  }

  const maySubmit =
    can('content.submit', formCompany) &&
    (!editing || editing.status === 'draft' || editing.status === 'rejected' || changed);

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={<span className="status status-blue">{TEXT.approvalRequired}</span>}
      />
      <ErrorBox error={items.error} loading />
      <ErrorBox error={accounts.error} loading />
      <div className="composer-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{editing && current ? TEXT.editing(current.versionNumber) : TEXT.newPost}</h2>
              <p>{editing ? TEXT.detailsEdit : TEXT.detailsNew}</p>
            </div>
            {editing ? (
              <StatusChip status={CONTENT_STATUS[editing.status]} />
            ) : (
              <StatusChip status={CONTENT_STATUS.draft} />
            )}
          </div>
          <ErrorBox error={versions.error} title={TEXT.versionsError} loading />
          <ErrorBox error={action.error} />
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <div className="grid grid-2">
              <FormField label={TEXT.company} error={errors.companyId} required>
                {(control) => (
                  <select
                    className="select-field"
                    {...control}
                    disabled={Boolean(editing)}
                    value={formCompany}
                    onChange={(event) => {
                      setForm((value) => ({
                        ...value,
                        companyId: event.target.value,
                        brandId: '',
                      }));
                      setTargets([]);
                    }}
                  >
                    {editing && !companies.some((item) => item.id === editing.companyId) && (
                      <option value={editing.companyId}>{companyName(editing.companyId)}</option>
                    )}
                    {companies.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                label={TEXT.category}
                hint={editing ? TEXT.fixedAfterCreate : TEXT.categoryHint}
                error={errors.categoryId}
              >
                {(control) => (
                  <select
                    className="select-field"
                    {...control}
                    disabled={Boolean(editing)}
                    value={editing ? (editing.categoryId ?? '') : form.categoryId}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, categoryId: event.target.value }))
                    }
                  >
                    <option value="">{TEXT.noCategory}</option>
                    {(categories.data ?? [])
                      .filter((item) => item.status === 'active' || item.id === editing?.categoryId)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                )}
              </FormField>
            </div>
            <FormField
              label={TEXT.brand}
              hint={editing ? TEXT.fixedAfterCreate : undefined}
              error={errors.brandId}
            >
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  disabled={Boolean(editing)}
                  value={editing ? (editing.brandId ?? '') : form.brandId}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, brandId: event.target.value }))
                  }
                >
                  <option value="">{TEXT.noBrand}</option>
                  {(brands.data ?? []).map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <fieldset className="field-group" style={{ border: 0, padding: 0, minWidth: 0 }}>
              <legend className="label">{TEXT.targets} *</legend>
              {companyAccounts.length === 0 ? (
                <small className="hint">{TEXT.noAccounts}</small>
              ) : (
                <div className="platform-list">
                  {companyAccounts.map((account) => (
                    <label className="platform-option" key={account.id}>
                      <input
                        type="checkbox"
                        checked={targets.includes(account.id)}
                        onChange={() =>
                          setTargets((value) =>
                            value.includes(account.id)
                              ? value.filter((id) => id !== account.id)
                              : [...value, account.id],
                          )
                        }
                      />
                      <span>
                        {account.displayName}
                        <span className="subline">
                          {PLATFORM_LABELS[account.platform]} ·{' '}
                          {ACCOUNT_STATUS[account.status].label}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <small className="hint">{TEXT.targetsHint}</small>
              {errors.targetAccountIds && (
                <small className="field-error" role="alert">
                  {errors.targetAccountIds}
                </small>
              )}
            </fieldset>
            <FormField
              label={TEXT.body}
              hint={TEXT.counter(form.body.length, bodyMax)}
              error={errors.body}
              required
            >
              {(control) => (
                <textarea
                  className="textarea-field"
                  {...control}
                  value={form.body}
                  maxLength={bodyMax}
                  placeholder={TEXT.bodyPlaceholder}
                  onChange={(event) => setForm((value) => ({ ...value, body: event.target.value }))}
                />
              )}
            </FormField>
            <div className="heading-actions">
              {editing && (
                <button type="button" className="btn btn-outline" onClick={startNew}>
                  {TEXT.startNew}
                </button>
              )}
              <button
                type="submit"
                className="btn btn-outline"
                disabled={action.busy || (Boolean(editing) && !changed)}
              >
                {action.busy ? TEXT.working : editing ? TEXT.saveVersion : TEXT.save}
              </button>
              {maySubmit && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={action.busy}
                  onClick={() => void onSubmit()}
                >
                  {TEXT.submit}
                </button>
              )}
            </div>
          </form>
          <small className="hint" style={{ marginTop: 12 }}>
            {TEXT.duty}
          </small>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{TEXT.previewTitle}</h2>
              <p>{TEXT.previewSubtitle}</p>
            </div>
          </div>
          <div className="preview-card">
            <div className="preview-head">
              <div className="preview-avatar" aria-hidden="true">
                {companyName(formCompany || null).slice(0, 1)}
              </div>
              <div>
                <strong>{formCompany ? companyName(formCompany) : ''}</strong>
                <small>
                  {targets.length
                    ? companyAccounts
                        .filter((account) => targets.includes(account.id))
                        .map((account) => account.displayName)
                        .join(' · ')
                    : TEXT.noTargetsChosen}
                </small>
              </div>
            </div>
            <div className="preview-body" style={{ whiteSpace: 'pre-wrap' }}>
              {form.body || TEXT.previewEmpty}
            </div>
          </div>
          {editing && (
            <div className="panel" style={{ marginTop: 15, background: '#f8fbfc' }}>
              <strong style={{ fontSize: 12 }}>{TEXT.reviewTitle}</strong>
              <ErrorBox error={approval.error} loading />
              {approval.data ? (
                <>
                  <p style={{ margin: '6px 0' }}>
                    <StatusChip status={APPROVAL_REQUEST_STATUS[approval.data.status]} />{' '}
                    <span className="subline">
                      {TEXT.progress(approval.data.approvals, approval.data.requiredApprovals)}
                    </span>
                  </p>
                  <ul className="plain-list">
                    {approval.data.decisions.map((decision) => (
                      <li key={decision.id}>
                        <strong>{APPROVAL_DECISION[decision.decision].label}</strong> ·{' '}
                        {personName(decision.decidedBy)} · {formatDateTime(decision.decidedAt)}
                        {decision.comment && <span className="subline">{decision.comment}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p style={{ margin: '6px 0 0', color: '#718091', fontSize: 11 }}>
                  {TEXT.notSubmitted}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      <div style={{ marginTop: 18 }}>
        <SectionPanel title={TEXT.listTitle} subtitle={TEXT.listSubtitle}>
          {!items.data && items.loading && <LoadingState />}
          {items.data && visibleItems.length === 0 && (
            <EmptyState title={TEXT.listEmpty}>{TEXT.listEmptyBody}</EmptyState>
          )}
          <div className="activity-list">
            {visibleItems.map((item) => {
              const version = currentVersionOf(item, versionsByItem[item.id]);
              return (
                <button
                  key={item.id}
                  className="activity-row queue-row"
                  aria-pressed={editingId === item.id}
                  onClick={() => {
                    setErrors({});
                    action.clear();
                    setEditingId(item.id);
                  }}
                >
                  <span className="activity-dot" aria-hidden="true" />
                  <span className="activity-copy" style={{ flex: 1 }}>
                    <strong>{version ? excerpt(version.body) : TEXT.noText}</strong>
                    <small>
                      {companyName(item.companyId)} · {personName(item.createdBy)} ·{' '}
                      {formatDateTime(item.updatedAt)}
                    </small>
                  </span>
                  <StatusChip status={CONTENT_STATUS[item.status]} />
                </button>
              );
            })}
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
