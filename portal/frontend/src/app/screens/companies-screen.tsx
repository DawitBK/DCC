'use client';

import { useEffect, useState } from 'react';
import {
  COMPANY_STATUSES,
  CreateBrandRequest,
  CreateCompanyRequest,
  UpdateBrandRequest,
  UpdateCompanyRequest,
  type BrandDto,
  type CompanyDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { StatCard } from '@/components/stat-card';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { ApiRequestError, apiFetch, apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { COMPANY_STATUS } from '@/lib/labels';
import { toApiError, useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Companies & brands',
  description: 'The company workspaces of the Group and the brands each one manages.',
  addCompany: '＋ Add company',
  companies: 'Companies',
  companiesFoot: 'In the chosen scope',
  brands: 'Brands',
  brandsFoot: 'Across those companies',
  brandCount: (count: number) => (count === 1 ? '1 brand' : `${count} brands`),
  noBrands: 'No brands yet',
  addBrand: '＋ Add brand',
  edit: 'Edit company',
  renameBrand: (name: string) => `Rename brand ${name}`,
  emptyTitle: 'No companies in this scope',
  emptyBody: 'The API returned no company workspaces for your access.',
  brandsError: 'Brands could not be loaded',
  name: 'Name',
  slug: 'Short name for links',
  slugHint: 'Lower-case letters, digits and single dashes. It cannot be changed later.',
  status: 'Status',
  statusHint: 'Suspended and archived companies cannot publish.',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  companyDialog: 'Add a company',
  editDialog: (name: string) => `Edit ${name}`,
  brandDialog: (company: string) => `Add a brand to ${company}`,
  renameDialog: (name: string) => `Rename ${name}`,
  companySaved: 'Company saved.',
  brandSaved: 'Brand saved.',
};

type Editing =
  | { kind: 'new-company' }
  | { kind: 'company'; company: CompanyDto }
  | { kind: 'new-brand'; company: CompanyDto }
  | { kind: 'brand'; company: CompanyDto; brand: BrandDto };

/**
 * `GET/POST /api/companies`, `PATCH /api/companies/:id`, `GET/POST /api/companies/:id/brands`,
 * `PATCH /api/companies/:id/brands/:brandId`.
 */
export function CompaniesScreen() {
  const { scopeCompanies, companies, can, reloadCompanies } = useWorkspace();
  const [brands, setBrands] = useState<Record<string, BrandDto[]>>({});
  const [brandsError, setBrandsError] = useState<ApiRequestError | null>(null);
  const [brandsVersion, setBrandsVersion] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const ids = scopeCompanies.map((item) => item.id).join(',');
  const canReadBrands = can('brand.read');

  useEffect(() => {
    if (!ids || !canReadBrands) return;
    let current = true;
    Promise.all(
      ids
        .split(',')
        .map(async (id) => [id, await apiFetch<BrandDto[]>(`/companies/${id}/brands`)] as const),
    )
      .then((entries) => {
        if (!current) return;
        setBrands(Object.fromEntries(entries));
        setBrandsError(null);
      })
      .catch((error: unknown) => {
        if (current) setBrandsError(toApiError(error));
      });
    return () => {
      current = false;
    };
  }, [ids, canReadBrands, brandsVersion]);

  const brandTotal = scopeCompanies.reduce(
    (total, item) => total + (brands[item.id]?.length ?? 0),
    0,
  );

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          can('company.manage') && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'new-company' })}>
              {TEXT.addCompany}
            </button>
          )
        }
      />
      <ErrorBox error={brandsError} title={TEXT.brandsError} loading />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label={TEXT.companies}
          value={String(scopeCompanies.length)}
          foot={TEXT.companiesFoot}
          icon="⌂"
        />
        <StatCard label={TEXT.brands} value={String(brandTotal)} foot={TEXT.brandsFoot} icon="◇" />
      </div>
      <div className="grid grid-3">
        {scopeCompanies.map((item) => {
          const list = brands[item.id] ?? [];
          return (
            <article key={item.id} className="panel">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div className="stat-icon" aria-hidden="true">
                  {item.name.slice(0, 1)}
                </div>
                <StatusChip status={COMPANY_STATUS[item.status]} />
              </div>
              <h2 style={{ margin: '16px 0 5px', fontSize: 16 }}>{item.name}</h2>
              <p style={{ margin: 0, color: '#7a8997', fontSize: 12 }}>
                {list.length ? TEXT.brandCount(list.length) : TEXT.noBrands}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
                {list.map((brand) =>
                  can('brand.manage', item.id) ? (
                    <button
                      key={brand.id}
                      className="status status-gray"
                      style={{ border: 0 }}
                      aria-label={TEXT.renameBrand(brand.name)}
                      onClick={() => setEditing({ kind: 'brand', company: item, brand })}
                    >
                      {brand.name} ✎
                    </button>
                  ) : (
                    <span className="status status-gray" key={brand.id}>
                      {brand.name}
                    </span>
                  ),
                )}
              </div>
              <span className="subline">{item.slug}</span>
              <div className="row-actions">
                {can('brand.manage', item.id) && (
                  <button
                    className="text-link"
                    onClick={() => setEditing({ kind: 'new-brand', company: item })}
                  >
                    {TEXT.addBrand}
                  </button>
                )}
                {can('company.manage', item.id) && (
                  <button
                    className="text-link"
                    onClick={() => setEditing({ kind: 'company', company: item })}
                  >
                    {TEXT.edit}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {companies.length === 0 && <LoadingState />}
      {companies.length > 0 && scopeCompanies.length === 0 && (
        <EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>
      )}
      {editing && (
        <CompanyForm
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadCompanies();
            setBrandsVersion((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

function CompanyForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const isNew = editing.kind === 'new-company' || editing.kind === 'new-brand';
  const isCompany = editing.kind === 'new-company' || editing.kind === 'company';
  const [name, setName] = useState(
    editing.kind === 'company'
      ? editing.company.name
      : editing.kind === 'brand'
        ? editing.brand.name
        : '',
  );
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState(editing.kind === 'company' ? editing.company.status : null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const title =
    editing.kind === 'new-company'
      ? TEXT.companyDialog
      : editing.kind === 'company'
        ? TEXT.editDialog(editing.company.name)
        : editing.kind === 'new-brand'
          ? TEXT.brandDialog(editing.company.name)
          : TEXT.renameDialog(editing.brand.name);

  const submit = async () => {
    const checked =
      editing.kind === 'new-company'
        ? validate(CreateCompanyRequest, { name, slug })
        : editing.kind === 'new-brand'
          ? validate(CreateBrandRequest, { name, slug })
          : editing.kind === 'company'
            ? validate(UpdateCompanyRequest, { name, status: status ?? undefined })
            : validate(UpdateBrandRequest, { name });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const path =
      editing.kind === 'new-company'
        ? '/companies'
        : editing.kind === 'company'
          ? `/companies/${editing.company.id}`
          : editing.kind === 'new-brand'
            ? `/companies/${editing.company.id}/brands`
            : `/companies/${editing.company.id}/brands/${editing.brand.id}`;
    const failure = await action.run(() => apiSend(isNew ? 'POST' : 'PATCH', path, checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(isCompany ? TEXT.companySaved : TEXT.brandSaved);
    onSaved();
  };

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {errors._form && (
          <small className="field-error" role="alert">
            {errors._form}
          </small>
        )}
        <FormField label={TEXT.name} error={errors.name} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={name}
              maxLength={maxLengthOf(CreateCompanyRequest.shape.name)}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>
        {isNew && (
          <FormField label={TEXT.slug} hint={TEXT.slugHint} error={errors.slug} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={slug}
                maxLength={maxLengthOf(CreateCompanyRequest.shape.slug)}
                onChange={(event) => setSlug(event.target.value)}
              />
            )}
          </FormField>
        )}
        {editing.kind === 'company' && status && (
          <FormField label={TEXT.status} hint={TEXT.statusHint} error={errors.status}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value as CompanyDto['status'])}
              >
                {COMPANY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {COMPANY_STATUS[value].label}
                  </option>
                ))}
              </select>
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
