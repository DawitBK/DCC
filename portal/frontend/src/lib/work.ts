import {
  ROLE_LABELS,
  type ApprovalDecisionDto,
  type ApprovalPolicyFullDto,
  type ApprovalState,
  type CompanyDto,
  type ContentItemDto,
  type FreezeDto,
  type MeResponse,
  type Permission,
  type PublicationDto,
  type PublicationStatus,
  type Role,
  type SocialAccountDto,
} from '@dcc/contracts';
import { PLATFORM_LABELS, type Tone } from './labels';
import { needsRoleHint } from './permissions-ui';

/**
 * Rules the "work and content" screens share: who may decide on a request and why not, whether a post can
 * go to an account and what stops it, which approval rule a kind of content will use, and the date helpers
 * of the calendar. Everything here only reads what the API already said; the API decides every request.
 */

const TEXT = {
  alreadyDecided: 'This request is already decided.',
  wroteVersion:
    'You wrote a version of this post. DCC never lets the author of any version review, approve or reject it.',
  notInRule: (roles: string) =>
    `The approval rule for this kind of content says only these roles decide: ${roles}.`,
  alreadyApproved:
    'You have already approved this request. A second approval must come from someone else.',
  authorsUnknown: 'Checking who wrote the versions…',
  accountNotUsable: (status: string) => `The account is ${status}.`,
  noChannel:
    'The account is not connected to the publishing engine, so nothing can be sent to it. An account administrator links it on the Social accounts screen.',
  companyNotActive: (status: string) =>
    `The company is ${status}, and a ${status} company cannot publish.`,
  notApproved: 'Only an approved post can be published.',
  notTarget: 'This version was not written for this account.',
  frozenAccount: 'Publishing is frozen for this account.',
  frozenCompany: 'Publishing is frozen for the whole company.',
  existing: (status: string) =>
    `This version already has a publication for this account (${status}).`,
  noVersion: 'The post has no version to publish.',
  noReason: 'No reason was recorded.',
  sec: 'under a minute ago',
  min: (n: number) => (n === 1 ? '1 minute ago' : `${n} minutes ago`),
  hour: (n: number) => (n === 1 ? '1 hour ago' : `${n} hours ago`),
  day: (n: number) => (n === 1 ? '1 day ago' : `${n} days ago`),
  ahead: 'in the future',
};

export type Gate = { ok: boolean; reasons: string[] };

/**
 * May this person write a review comment, or approve or reject? `authorIds` are the writers of every version
 * of the post (null while they are not read yet). The backend repeats every one of these checks.
 */
export function decisionGate(input: {
  me: MeResponse;
  can: (permission: Permission, companyId?: string | null) => boolean;
  kind: 'review' | 'decide';
  request: {
    companyId: string;
    status: ApprovalState;
    approverRoles?: Role[] | null;
    /** From level 2 of the escalation ladder the request is open to every other approver (the stand-in). */
    escalationLevel?: number;
  };
  authorIds: readonly string[] | null;
  decisions: readonly ApprovalDecisionDto[] | null;
}): Gate {
  const { me, can, kind, request, authorIds, decisions } = input;
  const reasons: string[] = [];
  const permission: Permission = kind === 'review' ? 'content.review' : 'content.approve';
  if (request.status !== 'pending') reasons.push(TEXT.alreadyDecided);
  if (!can(permission, request.companyId)) reasons.push(needsRoleHint(permission));
  if (authorIds === null) reasons.push(TEXT.authorsUnknown);
  else if (authorIds.includes(me.user.id)) reasons.push(TEXT.wroteVersion);
  if (
    kind === 'decide' &&
    request.approverRoles &&
    request.approverRoles.length > 0 &&
    (request.escalationLevel ?? 0) < 2
  ) {
    const mine = me.memberships
      .filter((m) => m.companyId === null || m.companyId === request.companyId)
      .map((m) => m.role);
    if (!mine.some((role) => request.approverRoles!.includes(role)))
      reasons.push(
        TEXT.notInRule(request.approverRoles.map((role) => ROLE_LABELS[role]).join(', ')),
      );
  }
  if (
    kind === 'decide' &&
    decisions?.some((d) => d.decision === 'approved' && d.decidedBy === me.user.id)
  )
    reasons.push(TEXT.alreadyApproved);
  return { ok: reasons.length === 0, reasons };
}

/** The approval rule a kind of content will be held to: the company's rule for the category, else its default, else the system default. */
export type EffectiveRule = {
  requiredApprovals: number;
  approverRoles: Role[];
  /** Round 2: the time limit in hours (null = none) and how it counts. */
  timeLimitHours: number | null;
  clock: 'working' | 'continuous';
  /** Where it comes from: the rule set for this category, the company's default rule, or the built-in default. */
  source: 'category' | 'company' | 'system';
};

export function effectiveRule(
  policies: readonly ApprovalPolicyFullDto[],
  companyId: string,
  categoryId: string | null,
): EffectiveRule {
  const ofCompany = policies.filter((policy) => policy.companyId === companyId);
  const category = categoryId
    ? ofCompany.find((policy) => policy.categoryId === categoryId)
    : undefined;
  if (category)
    return {
      requiredApprovals: category.requiredApprovals,
      approverRoles: category.approverRoles,
      timeLimitHours: category.timeLimitHours,
      clock: category.clock,
      source: 'category',
    };
  const company = ofCompany.find((policy) => policy.categoryId === null);
  if (company)
    return {
      requiredApprovals: company.requiredApprovals,
      approverRoles: company.approverRoles,
      timeLimitHours: company.timeLimitHours,
      clock: company.clock,
      source: 'company',
    };
  return {
    requiredApprovals: 1,
    approverRoles: [],
    timeLimitHours: null,
    clock: 'working',
    source: 'system',
  };
}

/** How ready an account is to receive posts, from what the register says about it. */
export function accountReadiness(account: SocialAccountDto): {
  label: string;
  tone: Tone;
  detail: string;
  usable: boolean;
} {
  if (!account.engineChannelId)
    return {
      label: 'Not connected to the engine',
      tone: 'red',
      detail: TEXT.noChannel,
      usable: false,
    };
  if (account.status === 'disconnected' || account.status === 'archived')
    return {
      label: account.status === 'archived' ? 'Archived' : 'Disconnected',
      tone: 'red',
      detail: TEXT.accountNotUsable(account.status),
      usable: false,
    };
  if (account.status === 'needs_attention')
    return {
      label: 'Needs attention',
      tone: 'amber',
      detail: 'The register marks this account as needing attention. Publishing may still work.',
      usable: true,
    };
  return {
    label: 'Ready',
    tone: 'green',
    detail: 'Connected to the engine and active in the register.',
    usable: true,
  };
}

/** A publication in one of these states already "owns" a version and account: sending the same pair again would only repeat it. */
const HOLDS_THE_SLOT: PublicationStatus[] = ['pending', 'scheduled', 'published'];

export type AccountPublishState = {
  account: SocialAccountDto;
  /** Everything that stops a publish to this account right now. Empty = it can be tried. */
  blockers: string[];
  /** The publication that already holds this version and account, if any. */
  existing: PublicationDto | null;
  freeze: FreezeDto | null;
  ready: boolean;
};

/**
 * Can this approved post go to this account? `freezes` is null when this person is not allowed to list freezes:
 * then the freeze check is left to the API, which always checks it.
 */
export function accountPublishState(input: {
  item: Pick<ContentItemDto, 'id' | 'companyId' | 'status' | 'currentVersionId'>;
  versionTargetIds: readonly string[];
  account: SocialAccountDto;
  company: CompanyDto | undefined;
  publications: readonly PublicationDto[];
  freezes: readonly FreezeDto[] | null;
}): AccountPublishState {
  const { item, versionTargetIds, account, company, publications, freezes } = input;
  const blockers: string[] = [];
  if (!item.currentVersionId) blockers.push(TEXT.noVersion);
  if (item.status !== 'approved') blockers.push(TEXT.notApproved);
  if (!versionTargetIds.includes(account.id)) blockers.push(TEXT.notTarget);
  const readiness = accountReadiness(account);
  if (!readiness.usable) blockers.push(readiness.detail);
  if (company && company.status !== 'active') blockers.push(TEXT.companyNotActive(company.status));
  const freeze =
    freezes?.find(
      (entry) =>
        entry.companyId === item.companyId &&
        (entry.socialAccountId === null || entry.socialAccountId === account.id),
    ) ?? null;
  if (freeze)
    blockers.push(freeze.socialAccountId === null ? TEXT.frozenCompany : TEXT.frozenAccount);
  const existing =
    publications.find(
      (row) =>
        row.contentItemId === item.id &&
        row.contentVersionId === item.currentVersionId &&
        row.socialAccountId === account.id &&
        HOLDS_THE_SLOT.includes(row.status),
    ) ?? null;
  if (existing) blockers.push(TEXT.existing(existing.status));
  return { account, blockers, existing, freeze, ready: blockers.length === 0 };
}

/** "Facebook · Kerchanshe Coffee" */
export function accountLabel(account: SocialAccountDto | undefined, fallbackId?: string): string {
  return account
    ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
    : `Account ${(fallbackId ?? '').slice(0, 8)}`;
}

/* ----------------------------- dates ----------------------------- */

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `2026-11-25` in the person's own time zone: the day a thing belongs to on their calendar. */
export function dayKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "Today", "Yesterday" or the long date: the headings of the notification list. */
export function dayHeading(date: Date, now: Date = new Date()): string {
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatDayHeading(date);
}

/** How long ago, in words. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return TEXT.ahead;
  if (seconds < 60) return TEXT.sec;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return TEXT.min(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return TEXT.hour(hours);
  return TEXT.day(Math.floor(hours / 24));
}

/** Whole days since `iso` (0 = today). */
export function ageInDays(iso: string, now: number = Date.now()): number {
  const then = new Date(iso).getTime();
  return Number.isNaN(then) ? 0 : Math.max(0, Math.floor((now - then) / 86_400_000));
}

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` in local time. */
export function toLocalInput(date: Date): string {
  return `${dayKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The moment a publication belongs to on a calendar: its planned time if it has one, else when it was requested (what the API's `from`/`to` use too). */
export function publicationMoment(publication: PublicationDto): Date {
  return new Date(publication.scheduledAt ?? publication.requestedAt);
}

export const PUBLICATION_MEANING: Record<PublicationStatus, string> = {
  pending:
    'DCC handed the post to the publishing engine and was not told the result. It does not know whether the post went out, so it will not send it again by itself. Use "Check with the engine".',
  scheduled:
    'The engine holds the post and sends it at the planned time. It can be cancelled until then.',
  published: 'The post went out to the network.',
  failed:
    'The engine reported a failure, so nothing was posted. Read the error before you try again.',
  cancelled:
    'Cancelled before its time. The post itself stays approved and can be scheduled again.',
};

export const NO_REASON = TEXT.noReason;
