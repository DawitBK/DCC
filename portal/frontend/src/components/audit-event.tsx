'use client';

import type { ReactNode } from 'react';
import { ROLE_LABELS, isRole, type AuditEventDto } from '@dcc/contracts';
import { CopyId } from '@/components/kit/parts';
import { Timeline, type TimelineItem } from '@/components/kit/parts';
import { formatDateTime } from '@/lib/format';
import { INCIDENT_SEVERITY, INCIDENT_STATUS, type Tone } from '@/lib/labels';
import { useWorkspace } from '@/lib/workspace';
import type { WorkspaceScreen } from '@/lib/workspace-routes';

/**
 * What the audit trail's own words mean, in plain English, and how to read one event: used by the activity
 * audit, the incident history and the dashboard feed. The action names are the platform's (`AuditActions` in
 * the backend); an action this file does not know is still shown, with a label made from its name.
 */

export type AuditArea =
  | 'signin'
  | 'access'
  | 'company'
  | 'account'
  | 'content'
  | 'publishing'
  | 'inbox'
  | 'incident'
  | 'policy'
  | 'audit'
  | 'system';

export const AUDIT_AREA_LABEL: Record<AuditArea, string> = {
  signin: 'Signing in and out',
  access: 'Roles and access',
  company: 'Companies and brands',
  account: 'Social accounts',
  content: 'Content and approvals',
  publishing: 'Publishing',
  inbox: 'Inbox',
  incident: 'Incidents',
  policy: 'Approval rules',
  audit: 'The audit trail',
  system: 'System',
};

type ActionInfo = { label: string; area: AuditArea; tone?: Tone; sensitive?: boolean };

export const AUDIT_ACTIONS: Record<string, ActionInfo> = {
  'auth.login': { label: 'Signed in', area: 'signin' },
  'auth.login_failed': { label: 'Sign-in failed', area: 'signin', tone: 'red', sensitive: true },
  'auth.logout': { label: 'Signed out', area: 'signin' },
  'auth.acting_role_changed': { label: 'Chose which role to act as', area: 'signin' },
  'auth.backchannel_logout': { label: 'Signed out by the SSO', area: 'signin' },
  'security.access_denied': {
    label: 'A request was refused',
    area: 'access',
    tone: 'red',
    sensitive: true,
  },
  'access.group_admin_granted_by_idp': {
    label: 'Group administrator role given by the SSO',
    area: 'access',
    tone: 'amber',
    sensitive: true,
  },
  'access.group_admin_revoked_by_idp': {
    label: 'Group administrator role taken away by the SSO',
    area: 'access',
    tone: 'amber',
    sensitive: true,
  },
  'access.membership_granted': {
    label: 'Role given',
    area: 'access',
    tone: 'amber',
    sensitive: true,
  },
  'access.membership_revoked': {
    label: 'Role removed',
    area: 'access',
    tone: 'amber',
    sensitive: true,
  },
  'company.created': { label: 'Company added', area: 'company' },
  'company.updated': { label: 'Company changed', area: 'company' },
  'brand.created': { label: 'Brand added', area: 'company' },
  'brand.updated': { label: 'Brand renamed', area: 'company' },
  'account.created': { label: 'Social account registered', area: 'account' },
  'account.updated': { label: 'Social account changed', area: 'account' },
  'account.status_changed': {
    label: 'Social account status changed',
    area: 'account',
    sensitive: true,
  },
  'account.backup_admin_changed': {
    label: 'Backup administrator changed',
    area: 'account',
    tone: 'amber',
    sensitive: true,
  },
  'account.assigned': { label: 'Person assigned to an account', area: 'account' },
  'account.unassigned': { label: 'Person removed from an account', area: 'account' },
  'account.engine_linked': {
    label: 'Account linked to the engine',
    area: 'account',
    sensitive: true,
  },
  'account.engine_unlinked': {
    label: 'Account unlinked from the engine',
    area: 'account',
    sensitive: true,
  },
  'content.drafted': { label: 'Post drafted', area: 'content' },
  'content.version_created': { label: 'New version of a post', area: 'content' },
  'content.submitted': { label: 'Post sent for review', area: 'content' },
  'content.reviewed': { label: 'Review comment', area: 'content' },
  'content.approved': { label: 'Post approved', area: 'content', tone: 'green' },
  'content.rejected': { label: 'Post rejected', area: 'content', tone: 'red' },
  'media.uploaded': { label: 'Picture or video uploaded', area: 'content' },
  'publication.published': { label: 'Post published', area: 'publishing', tone: 'green' },
  'publication.scheduled': { label: 'Post scheduled', area: 'publishing', tone: 'blue' },
  'publication.cancelled': { label: 'Schedule cancelled', area: 'publishing' },
  'publication.failed': { label: 'Publishing failed', area: 'publishing', tone: 'red' },
  'publication.outcome_unknown': {
    label: 'Publishing outcome unknown',
    area: 'publishing',
    tone: 'red',
  },
  'publishing.frozen': {
    label: 'Publishing frozen',
    area: 'publishing',
    tone: 'amber',
    sensitive: true,
  },
  'publishing.unfrozen': {
    label: 'Freeze lifted',
    area: 'publishing',
    tone: 'amber',
    sensitive: true,
  },
  'publishing.freeze_lift_confirmed': {
    label: 'Freeze lift confirmed or withdrawn',
    area: 'publishing',
    tone: 'amber',
    sensitive: true,
  },
  'inbox.reply_requested': { label: 'Reply requested', area: 'inbox' },
  'inbox.reply_sent': { label: 'Reply sent', area: 'inbox' },
  'inbox.reply_failed': { label: 'Reply failed', area: 'inbox', tone: 'red' },
  'inbox.assigned': { label: 'Message assigned', area: 'inbox' },
  'inbox.unassigned': { label: 'Message unassigned', area: 'inbox' },
  'inbox.response_target_set': { label: 'Response target set', area: 'inbox' },
  'audit.exported': {
    label: 'Audit trail exported',
    area: 'audit',
    tone: 'amber',
    sensitive: true,
  },
  'maintenance.idempotency_keys_pruned': { label: 'Old send keys cleaned up', area: 'system' },
  'content_category.created': { label: 'Kind of content added', area: 'policy' },
  'content_category.updated': { label: 'Kind of content changed', area: 'policy' },
  'approval_policy.set': {
    label: 'Approval rule set',
    area: 'policy',
    tone: 'amber',
    sensitive: true,
  },
  'approval_policy.removed': {
    label: 'Approval rule removed',
    area: 'policy',
    tone: 'amber',
    sensitive: true,
  },
  'incident.opened': { label: 'Incident opened', area: 'incident', tone: 'red' },
  'incident.updated': { label: 'Incident updated', area: 'incident' },
  'incident.review_recorded': { label: 'Post-incident review recorded', area: 'incident' },
  'incident.closed': { label: 'Incident closed', area: 'incident' },
  'incident_category.created': { label: 'Incident category added', area: 'incident' },
  'incident_category.updated': { label: 'Incident category changed', area: 'incident' },
  'incident_contact.created': { label: 'Recovery contact added', area: 'incident' },
  'incident_contact.updated': { label: 'Recovery contact changed', area: 'incident' },
};

const AREA_BY_PREFIX: Record<string, AuditArea> = {
  auth: 'signin',
  security: 'access',
  access: 'access',
  company: 'company',
  brand: 'company',
  account: 'account',
  content: 'content',
  media: 'content',
  publication: 'publishing',
  publishing: 'publishing',
  inbox: 'inbox',
  incident: 'incident',
  incident_category: 'incident',
  incident_contact: 'incident',
  approval_policy: 'policy',
  content_category: 'policy',
  audit: 'audit',
  maintenance: 'system',
};

/** "social_account.status_changed" becomes "Social account: status changed". */
export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function actionInfo(action: string): ActionInfo & { known: boolean } {
  const known = AUDIT_ACTIONS[action];
  if (known) return { ...known, known: true };
  const [prefix = '', rest = ''] = action.split('.');
  return {
    label: rest ? `${humanize(prefix)}: ${humanize(rest).toLowerCase()}` : humanize(action),
    area: AREA_BY_PREFIX[prefix] ?? 'system',
    known: false,
  };
}

export const SENSITIVE_ACTIONS = Object.entries(AUDIT_ACTIONS)
  .filter(([, info]) => info.sensitive)
  .map(([action]) => action);

/** The quick filters: one click sets the filters for a common question. `mine` filters by the signed-in person. */
export type QuickFilter = {
  id: string;
  label: string;
  hint: string;
  actions?: string[];
  mine?: boolean;
};

export const QUICK_FILTERS: QuickFilter[] = [
  { id: 'mine', label: 'My actions', hint: 'Everything you did in DCC.', mine: true },
  {
    id: 'sensitive',
    label: 'Sensitive actions',
    hint: 'Roles, approval rules, freezes, exports, backup administrators, account links and refused requests.',
    actions: SENSITIVE_ACTIONS,
  },
  {
    id: 'signins',
    label: 'Sign-ins',
    hint: 'Signing in, failed sign-ins, signing out and sign-outs by the SSO.',
    actions: ['auth.login', 'auth.login_failed', 'auth.logout', 'auth.backchannel_logout'],
  },
  {
    id: 'roles',
    label: 'Role changes',
    hint: 'A role given or removed, including those made by the SSO.',
    actions: [
      'access.membership_granted',
      'access.membership_revoked',
      'access.group_admin_granted_by_idp',
      'access.group_admin_revoked_by_idp',
    ],
  },
  {
    id: 'freezes',
    label: 'Freezes',
    hint: 'Publishing frozen and freezes lifted.',
    actions: ['publishing.frozen', 'publishing.unfrozen', 'publishing.freeze_lift_confirmed'],
  },
  {
    id: 'exports',
    label: 'Exports',
    hint: 'Every time the audit trail was exported.',
    actions: ['audit.exported'],
  },
  {
    id: 'refused',
    label: 'Refused requests',
    hint: 'Requests the platform refused because the person was not allowed.',
    actions: ['security.access_denied'],
  },
];

/** The kinds of record an event can be about (`target_type`), in words. */
export const TARGET_KINDS: { value: string; label: string }[] = [
  { value: 'company', label: 'Company' },
  { value: 'brand', label: 'Brand' },
  { value: 'membership', label: 'Role given to a person' },
  { value: 'user', label: 'Person' },
  { value: 'social_account', label: 'Social account' },
  { value: 'content_item', label: 'Post' },
  { value: 'content_media', label: 'Picture or video' },
  { value: 'content_category', label: 'Kind of content' },
  { value: 'approval_policy', label: 'Approval rule' },
  { value: 'publication', label: 'Publication' },
  { value: 'publishing_freeze', label: 'Publishing freeze' },
  { value: 'inbox_item', label: 'Inbox message' },
  { value: 'incident', label: 'Incident' },
  { value: 'incident_category', label: 'Incident category' },
  { value: 'incident_contact', label: 'Recovery contact' },
  { value: 'audit_export', label: 'Audit export' },
  { value: 'idempotency_key', label: 'Send key' },
];

export function targetKindLabel(type: string | null): string {
  if (!type) return '—';
  return TARGET_KINDS.find((kind) => kind.value === type)?.label ?? humanize(type);
}

export type TargetLink = {
  screen: WorkspaceScreen;
  id: string | null;
  params?: Record<string, string>;
  /** What the link says: "Open the post". */
  label: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** The screen that shows what an event was about, when there is one. */
export function targetLink(event: AuditEventDto): TargetLink | null {
  const type = event.target_type;
  const id = event.target_id;
  const details = event.details ?? {};
  switch (type) {
    case 'content_item':
      return { screen: 'content', id, label: 'Open the post' };
    case 'incident':
      return { screen: 'incidents', id, label: 'Open the incident' };
    case 'social_account':
      return { screen: 'accounts', id, label: 'Open the social account' };
    case 'company':
      return { screen: 'companies', id, label: 'Open the company' };
    case 'brand':
      return event.company_id
        ? { screen: 'companies', id: event.company_id, label: 'Open the company of the brand' }
        : null;
    case 'membership':
    case 'user': {
      const person = type === 'user' ? id : isUuid(details.userId) ? details.userId : null;
      return person ? { screen: 'access', id: person, label: 'Open the person' } : null;
    }
    case 'publication':
      return { screen: 'publishing', id, label: 'Open the publication' };
    case 'publishing_freeze':
      return { screen: 'publishing', id: null, label: 'Open publishing' };
    case 'content_category':
    case 'approval_policy':
      return { screen: 'policies', id: null, label: 'Open the approval rules' };
    case 'incident_category':
    case 'incident_contact':
      return {
        screen: 'incidents',
        id: null,
        params: { tab: 'setup' },
        label: 'Open the incident setup',
      };
    case 'inbox_item':
      return { screen: 'inbox', id: null, label: 'Open the inbox' };
    default:
      return null;
  }
}

type Names = {
  personName: (id: string | null) => string;
  companyName: (id: string | null) => string;
};

const statusWord = (action: string, value: unknown): string => {
  if (typeof value !== 'string') return String(value ?? '—');
  if (action.startsWith('incident')) {
    const status = INCIDENT_STATUS[value as keyof typeof INCIDENT_STATUS];
    if (status) return status.label;
    const severity = INCIDENT_SEVERITY[value as keyof typeof INCIDENT_SEVERITY];
    if (severity) return severity.label;
  }
  return humanize(value);
};

/** One line saying the most useful thing about an event, for a timeline or a feed. Empty when there is nothing to add. */
export function eventSummary(event: AuditEventDto, names: Names): string {
  const d = event.details ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  switch (event.action) {
    case 'access.membership_granted':
    case 'access.membership_revoked': {
      const person = isUuid(d.userId) ? names.personName(d.userId) : '';
      const role = isRole(d.role) ? ROLE_LABELS[d.role] : text(d.role);
      return [person, role].filter(Boolean).join(' · ');
    }
    case 'incident.opened': {
      const title = text(d.title);
      const severity = text(d.severity);
      if (d.suspectedBypass === true) return 'Found by the check for posts DCC did not send.';
      return [title, severity ? statusWord('incident', severity) : ''].filter(Boolean).join(' · ');
    }
    case 'incident.updated': {
      if (d.suspectedBypass === true)
        return 'The evidence was updated by the check for posts DCC did not send.';
      const parts: string[] = [];
      if (text(d.from) && text(d.to) && d.from !== d.to)
        parts.push(`Status: ${statusWord('incident', d.from)} → ${statusWord('incident', d.to)}`);
      if ('categoryFrom' in d || 'categoryTo' in d) parts.push('Category changed');
      return parts.join(' · ');
    }
    case 'audit.exported':
      return typeof d.rows === 'number' ? `${d.rows} rows were written to the file.` : '';
    case 'approval_policy.set': {
      const to = d.to as { requiredApprovals?: number } | undefined;
      return to?.requiredApprovals
        ? `${to.requiredApprovals} ${to.requiredApprovals === 1 ? 'approval' : 'approvals'} needed`
        : '';
    }
    case 'publishing.freeze_lift_confirmed': {
      const side = text(d.side) === 'security' ? 'security side' : 'communications side';
      return d.event === 'withdrawn'
        ? `The ${side} withdrew its confirmation.`
        : `The ${side} confirmed${d.lifted === true ? '; this was the second, so the freeze was lifted' : ''}.`;
    }
    case 'publishing.frozen':
      return text(d.reason) ? `Reason: ${text(d.reason)}` : '';
    case 'auth.login_failed':
      return text(d.reason) ? `Reason: ${humanize(text(d.reason)).toLowerCase()}` : '';
    default: {
      const pairs = Object.entries(d)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
        .filter(
          ([, value]) => typeof value !== 'string' || (value.length < 70 && !UUID.test(value)),
        )
        .slice(0, 2)
        .map(([key, value]) => `${humanize(key)}: ${String(value)}`);
      return pairs.join(' · ');
    }
  }
}

type Row = { label: string; value: ReactNode };

function personKey(key: string): boolean {
  return /user|actor|assignee|owner|admin|by$|person/i.test(key);
}

function valueNode(key: string, value: unknown, names: Names): ReactNode {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') {
    if (value === '') return '—';
    if (UUID.test(value)) {
      if (personKey(key)) return names.personName(value);
      if (/company/i.test(key)) return names.companyName(value);
      return <CopyId value={value} />;
    }
    if (ISO_TIME.test(value) && !Number.isNaN(new Date(value).getTime()))
      return formatDateTime(value);
    if (isRole(value)) return ROLE_LABELS[value];
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (value.every((item) => ['string', 'number'].includes(typeof item)))
      return value.map((item) => (isRole(item) ? ROLE_LABELS[item] : String(item))).join(', ');
    return <code className="gov-mono">{JSON.stringify(value)}</code>;
  }
  return <code className="gov-mono">{JSON.stringify(value)}</code>;
}

function flatten(details: unknown, names: Names, prefix = '', depth = 0): Row[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const rows: Row[] = [];
  for (const [key, raw] of Object.entries(details as Record<string, unknown>)) {
    let value = raw;
    // The bypass check keeps its evidence as a JSON text: read it as the object it is.
    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        /* keep the text */
      }
    }
    const label = `${prefix}${prefix ? ' › ' : ''}${humanize(key)}`;
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 3) {
      const inner = flatten(value, names, label, depth + 1);
      if (inner.length) rows.push(...inner);
      else rows.push({ label, value: '—' });
    } else {
      rows.push({ label, value: valueNode(key, value, names) });
    }
  }
  return rows;
}

/** The `details` of an event as readable pairs (people, companies and roles by name), with the raw JSON one click away. */
export function AuditDetails({ event }: { event: AuditEventDto }) {
  const { personName, companyName } = useWorkspace();
  const rows = flatten(event.details, { personName, companyName });
  return (
    <div className="gov-stack-tight">
      {rows.length === 0 ? (
        <p className="gov-muted" style={{ margin: 0 }}>
          This event carries no further details.
        </p>
      ) : (
        <dl className="gov-kv">
          {rows.map((row, index) => (
            <div key={`${row.label}-${index}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary>Show the stored record as it is</summary>
        <pre className="gov-raw">{JSON.stringify(event, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Events as a timeline, newest first: what happened, who did it, and the one line that matters. */
export function AuditFeed({ events, empty }: { events: AuditEventDto[]; empty?: ReactNode }) {
  const { personName, companyName } = useWorkspace();
  const items: TimelineItem[] = events.map((event) => {
    const info = actionInfo(event.action);
    const summary = eventSummary(event, { personName, companyName });
    const who = event.actor_user_id ? personName(event.actor_user_id) : 'The system';
    return {
      id: event.id,
      when: formatDateTime(event.occurred_at),
      title: (
        <>
          {info.label} <span className="gov-muted">· {who}</span>
        </>
      ),
      detail: summary || undefined,
      tone: info.tone ?? 'gray',
    };
  });
  return <Timeline items={items} empty={empty} />;
}
