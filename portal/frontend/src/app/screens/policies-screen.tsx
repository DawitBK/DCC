'use client';

import { useState } from 'react';
import {
  APPROVER_ROLES,
  CONTENT_CATEGORY_STATUSES,
  CreateContentCategoryRequest,
  MAX_REQUIRED_APPROVALS,
  ROLE_LABELS,
  SetApprovalPolicyRequest,
  UpdateContentCategoryRequest,
  type ApprovalPolicyDto,
  type ContentCategoryDto,
  type Role,
} from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { Dialog, DialogActions } from '@/components/dialog';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { canAtGroup } from '@/lib/access';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { CATEGORY_STATUS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const DEFAULT = '';

const TEXT = {
  title: 'Approval rules',
  description:
    'How many people must approve a post, and which roles may, per company and kind of content.',
  addRule: '＋ Set a rule',
  addCategory: '＋ Add a kind of content',
  rules: 'Rules',
  rulesSubtitle:
    'A post follows the rule of its kind of content; without one, the company default; without that, one approval by any approver.',
  rulesCaption: 'Approval rules',
  company: 'Company',
  category: 'Kind of content',
  companyDefault: 'Company default',
  required: 'Approvals needed',
  approvers: 'Who may approve',
  anyApprover: 'Any role that may approve',
  updated: 'Last changed',
  actions: 'Actions',
  change: 'Change',
  remove: 'Remove',
  changeLabel: (what: string) => `Change the rule for ${what}`,
  removeLabel: (what: string) => `Remove the rule for ${what}`,
  noRules: 'No rule set',
  noRulesBody: 'Until a rule is set, one approval by any approver is enough.',
  categories: 'Kinds of content',
  categoriesSubtitle: 'Shared by every company of the group',
  categoriesCaption: 'Content categories',
  name: 'Name',
  key: 'Key',
  keyHint: 'Lower-case letters, digits and single dashes. It cannot be changed later.',
  status: 'Status',
  noCategories: 'No kinds of content yet',
  ruleDialog: 'Set an approval rule',
  ruleDialogBody: 'Saving replaces the rule for this company and kind of content.',
  approversHint: 'Tick none to allow any role that may approve.',
  categoryDialogNew: 'Add a kind of content',
  categoryDialogEdit: (name: string) => `Change ${name}`,
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved. The rules were read again from DCC.',
  removed: 'Rule removed.',
  reauthNote: 'Changing or removing a rule may ask you to sign in again first.',
};

/**
 * `GET/POST/PATCH /api/content-categories`, `GET/PUT /api/approval-policies`,
 * `DELETE /api/approval-policies/:id`.
 */
export function PoliciesScreen() {
  const { me, companyId, companyName, can, companiesWhere, personName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const policies = useApiData<ApprovalPolicyDto[]>(
    `/approval-policies${queryString({ companyId })}`,
  );
  const categories = useApiData<ContentCategoryDto[]>('/content-categories');
  const [rule, setRule] = useState<ApprovalPolicyDto | 'new' | null>(null);
  const [category, setCategory] = useState<ContentCategoryDto | 'new' | null>(null);
  const manageCompanies = companiesWhere('approval_policy.manage');
  const mayManageCategories =
    canAtGroup(me, 'approval_policy.manage') || can('approval_policy.manage');

  const categoryName = (id: string | null) =>
    id === null
      ? TEXT.companyDefault
      : (categories.data?.find((item) => item.id === id)?.name ?? id.slice(0, 8));
  const ruleName = (row: ApprovalPolicyDto) =>
    `${companyName(row.companyId)} · ${categoryName(row.categoryId)}`;

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          manageCompanies.length > 0 && (
            <button className="btn btn-primary" onClick={() => setRule('new')}>
              {TEXT.addRule}
            </button>
          )
        }
      />
      <ErrorBox error={policies.error ?? categories.error} loading />
      <ErrorBox error={action.error} />
      <SectionPanel title={TEXT.rules} subtitle={TEXT.rulesSubtitle}>
        {!policies.data && policies.loading ? (
          <LoadingState />
        ) : (
          <DataTable
            caption={TEXT.rulesCaption}
            rows={policies.data ?? []}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.noRules}>{TEXT.noRulesBody}</EmptyState>}
            columns={[
              { header: TEXT.company, cell: (row) => companyName(row.companyId) },
              { header: TEXT.category, cell: (row) => categoryName(row.categoryId) },
              { header: TEXT.required, cell: (row) => row.requiredApprovals },
              {
                header: TEXT.approvers,
                cell: (row) =>
                  row.approverRoles.length
                    ? row.approverRoles.map((role) => ROLE_LABELS[role]).join(', ')
                    : TEXT.anyApprover,
              },
              {
                header: TEXT.updated,
                cell: (row) => (
                  <>
                    {formatDateTime(row.updatedAt)}
                    <span className="subline">{personName(row.updatedBy)}</span>
                  </>
                ),
              },
              {
                header: TEXT.actions,
                cell: (row) =>
                  can('approval_policy.manage', row.companyId) ? (
                    <span className="row-actions" style={{ marginTop: 0 }}>
                      <button
                        className="text-link"
                        aria-label={TEXT.changeLabel(ruleName(row))}
                        onClick={() => setRule(row)}
                      >
                        {TEXT.change}
                      </button>
                      <button
                        className="text-link"
                        disabled={action.busy}
                        aria-label={TEXT.removeLabel(ruleName(row))}
                        onClick={async () => {
                          const failure = await action.run(() =>
                            apiSend('DELETE', `/approval-policies/${row.id}`),
                          );
                          policies.reload();
                          if (!failure) showToast(TEXT.removed);
                        }}
                      >
                        {TEXT.remove}
                      </button>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
        <small className="hint">{TEXT.reauthNote}</small>
      </SectionPanel>
      <div style={{ marginTop: 18 }}>
        <SectionPanel
          title={TEXT.categories}
          subtitle={TEXT.categoriesSubtitle}
          action={
            mayManageCategories && (
              <button className="btn btn-outline" onClick={() => setCategory('new')}>
                {TEXT.addCategory}
              </button>
            )
          }
        >
          {categories.data && (
            <DataTable
              caption={TEXT.categoriesCaption}
              rows={categories.data}
              rowKey={(row) => row.id}
              empty={<EmptyState title={TEXT.noCategories} />}
              columns={[
                { header: TEXT.name, cell: (row) => row.name },
                { header: TEXT.key, cell: (row) => row.key },
                {
                  header: TEXT.status,
                  cell: (row) => <StatusChip status={CATEGORY_STATUS[row.status]} />,
                },
                {
                  header: TEXT.actions,
                  cell: (row) =>
                    mayManageCategories ? (
                      <button
                        className="text-link"
                        aria-label={TEXT.categoryDialogEdit(row.name)}
                        onClick={() => setCategory(row)}
                      >
                        {TEXT.change}
                      </button>
                    ) : null,
                },
              ]}
            />
          )}
        </SectionPanel>
      </div>
      {rule && (
        <RuleDialog
          rule={rule === 'new' ? null : rule}
          categories={categories.data ?? []}
          onClose={() => setRule(null)}
          onSaved={() => {
            setRule(null);
            policies.reload();
          }}
        />
      )}
      {category && (
        <CategoryDialog
          category={category === 'new' ? null : category}
          onClose={() => setCategory(null)}
          onSaved={() => {
            setCategory(null);
            categories.reload();
          }}
        />
      )}
    </>
  );
}

function RuleDialog({
  rule,
  categories,
  onClose,
  onSaved,
}: {
  rule: ApprovalPolicyDto | null;
  categories: ContentCategoryDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { companiesWhere, companyName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('approval_policy.manage');
  const [companyId, setCompanyId] = useState(rule?.companyId ?? companies[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? DEFAULT);
  const [required, setRequired] = useState(rule?.requiredApprovals ?? 1);
  const [roles, setRoles] = useState<Role[]>(rule?.approverRoles ?? []);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const checked = validate(SetApprovalPolicyRequest, {
      companyId,
      categoryId: categoryId === DEFAULT ? null : categoryId,
      requiredApprovals: required,
      approverRoles: roles,
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('PUT', '/approval-policies', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onSaved();
  };

  return (
    <Dialog title={TEXT.ruleDialog} description={TEXT.ruleDialogBody} onClose={onClose}>
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
              disabled={Boolean(rule)}
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            >
              {rule && !companies.some((item) => item.id === rule.companyId) && (
                <option value={rule.companyId}>{companyName(rule.companyId)}</option>
              )}
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.category} error={errors.categoryId}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              disabled={Boolean(rule)}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value={DEFAULT}>{TEXT.companyDefault}</option>
              {categories
                .filter((item) => item.status === 'active' || item.id === rule?.categoryId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.required} error={errors.requiredApprovals} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={required}
              onChange={(event) => setRequired(Number(event.target.value))}
            >
              {Array.from({ length: MAX_REQUIRED_APPROVALS }, (_, index) => index + 1).map(
                (count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ),
              )}
            </select>
          )}
        </FormField>
        <fieldset className="field-group" style={{ border: 0, padding: 0, minWidth: 0 }}>
          <legend className="label">{TEXT.approvers}</legend>
          <div className="platform-list">
            {APPROVER_ROLES.map((role) => (
              <label className="platform-option" key={role}>
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() =>
                    setRoles((value) =>
                      value.includes(role)
                        ? value.filter((item) => item !== role)
                        : [...value, role],
                    )
                  }
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
          <small className="hint">{TEXT.approversHint}</small>
          {errors.approverRoles && (
            <small className="field-error" role="alert">
              {errors.approverRoles}
            </small>
          )}
        </fieldset>
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? TEXT.saving : TEXT.save}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: ContentCategoryDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [name, setName] = useState(category?.name ?? '');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<string>(category?.status ?? 'active');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const checked = category
      ? validate(UpdateContentCategoryRequest, { name, status })
      : validate(CreateContentCategoryRequest, { name, key });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      category
        ? apiSend('PATCH', `/content-categories/${category.id}`, checked.data)
        : apiSend('POST', '/content-categories', checked.data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onSaved();
  };

  return (
    <Dialog
      title={category ? TEXT.categoryDialogEdit(category.name) : TEXT.categoryDialogNew}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <FormField label={TEXT.name} error={errors.name} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={name}
              maxLength={maxLengthOf(CreateContentCategoryRequest.shape.name)}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>
        {category ? (
          <FormField label={TEXT.status} error={errors.status}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {CONTENT_CATEGORY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_STATUS[value].label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : (
          <FormField label={TEXT.key} hint={TEXT.keyHint} error={errors.key} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={key}
                maxLength={maxLengthOf(CreateContentCategoryRequest.shape.key)}
                onChange={(event) => setKey(event.target.value)}
              />
            )}
          </FormField>
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? TEXT.saving : TEXT.save}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
