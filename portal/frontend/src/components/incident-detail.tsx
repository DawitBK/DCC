'use client';

import type { IncidentCategoryDto, IncidentContactDto, IncidentDto } from '@dcc/contracts';
import { CONTACT_CHANNEL } from '@/lib/labels';
import { queryString } from '@/lib/browser-api';
import { useApiData } from '@/lib/use-api';
import { SectionPanel } from './section-panel';
import { StatusChip } from './status-chip';

const TEXT = {
  categoryTitle: 'Category and playbook',
  noCategory: 'This incident has no category.',
  noPlaybook: 'This category has no playbook yet. The Group enters them.',
  archivedNote: 'This category is archived. It stays on incidents that already have it.',
  playbookSteps: (title: string) => `Playbook: ${title}`,
  contactsTitle: 'Who to call',
  contactsSubtitle: "The company's recovery contacts, in order. They need no DCC account.",
  noContacts: 'No recovery contact has been entered for this company yet.',
  contactsCaption: 'Recovery contacts',
  noCategoryOption: 'No category',
  archivedSuffix: ' (archived)',
  groupDefault: 'Group default',
  loadingCategories: 'Loading categories…',
};

/** The category of an incident with its playbook, as the API returns it (never a copy). Read-only. */
export function IncidentCategoryView({ incident }: { incident: IncidentDto }) {
  const category = incident.category;
  return (
    <SectionPanel title={TEXT.categoryTitle}>
      {!category ? (
        <p className="hint">{TEXT.noCategory}</p>
      ) : (
        <>
          <p>
            <strong>{category.name}</strong>
            {category.status === 'archived' && (
              <>
                {' '}
                <StatusChip label="Archived" tone="gray" />
              </>
            )}
          </p>
          {category.status === 'archived' && <p className="hint">{TEXT.archivedNote}</p>}
          {category.playbook ? (
            <div className="playbook">
              <h3>{TEXT.playbookSteps(category.playbook.title)}</h3>
              <ol>
                {category.playbook.steps.map((step, index) => (
                  <li key={`${index}:${step}`}>{step}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="hint">{TEXT.noPlaybook}</p>
          )}
        </>
      )}
    </SectionPanel>
  );
}

/** A way to reach a person: an email address or a phone number becomes a link, anything else stays text. */
export function ContactValue({ contact }: { contact: IncidentContactDto }) {
  if (contact.channel === 'email')
    return (
      <a className="text-link" href={`mailto:${contact.value}`}>
        {contact.value}
      </a>
    );
  if (contact.channel === 'phone')
    return (
      <a className="text-link" href={`tel:${contact.value.replace(/[^0-9+]/g, '')}`}>
        {contact.value}
      </a>
    );
  return <>{contact.value}</>;
}

/** The company's active recovery contacts on an incident, in the order the API returned them. */
export function RecoveryContactsView({ contacts }: { contacts: IncidentContactDto[] }) {
  return (
    <SectionPanel title={TEXT.contactsTitle} subtitle={TEXT.contactsSubtitle}>
      {contacts.length === 0 ? (
        <p className="hint">{TEXT.noContacts}</p>
      ) : (
        <ul className="contact-list" aria-label={TEXT.contactsCaption}>
          {contacts.map((contact) => (
            <li key={contact.id}>
              <strong>{contact.name}</strong>
              <span className="subline">{contact.roleLabel}</span>
              <span className="subline">
                {CONTACT_CHANNEL[contact.channel]}: <ContactValue contact={contact} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

/**
 * `GET /api/incident-categories?companyId=`: the company's own categories plus its group's defaults.
 * Archived ones are left out unless `keepId` (the category an incident already has) is among them.
 */
export function useCategoryOptions(companyId: string | null, keepId?: string | null) {
  const result = useApiData<IncidentCategoryDto[]>(
    companyId ? `/incident-categories${queryString({ companyId })}` : null,
  );
  const options = (result.data ?? []).filter(
    (category) => category.status === 'active' || category.id === keepId,
  );
  return { ...result, options };
}

/** The label of a category in a list: its name, and where it comes from or that it is archived. */
export function categoryOptionLabel(category: IncidentCategoryDto): string {
  return `${category.name}${category.companyId === null ? ` · ${TEXT.groupDefault}` : ''}${
    category.status === 'archived' ? TEXT.archivedSuffix : ''
  }`;
}

export const INCIDENT_DETAIL_TEXT = TEXT;
