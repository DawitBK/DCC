// Round 3 (2026-11-26): SMS, Teams and e-mail alerts for serious incidents (RQ-029; sheet D2-19, D2-20, D2-22).
import { z } from 'zod';

/** The three ways an alert can reach people. */
export const ALERT_CHANNELS = ['sms', 'teams', 'email'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];

/**
 * The lowest severity that raises an alert. `critical` = SEV1 only, `high` = SEV1 and SEV2 (the default).
 * Alerts are never sent below SEV2, so there is no lower choice.
 */
export const ALERT_MIN_SEVERITIES = ['critical', 'high'] as const;
export type AlertMinSeverity = (typeof ALERT_MIN_SEVERITIES)[number];

/** Why a channel is not usable: nothing set, set only in part, or an address that production refuses. */
export type AlertChannelReason = 'ok' | 'not_set' | 'incomplete' | 'insecure';

/** A channel's state as the screen may see it: never a value, only whether it can work. */
export interface AlertChannelStatusDto {
  configured: boolean;
  reason: AlertChannelReason;
}

export interface AlertStatusDto {
  sms: AlertChannelStatusDto;
  teams: AlertChannelStatusDto;
  email: AlertChannelStatusDto;
}

export interface AlertSettingsDto {
  groupId: string;
  smsEnabled: boolean;
  teamsEnabled: boolean;
  emailEnabled: boolean;
  minSeverity: AlertMinSeverity;
  /** null while the group still uses the defaults (nothing was ever saved). */
  updatedAt: string | null;
}

export const SetAlertSettingsRequest = z.object({
  smsEnabled: z.boolean(),
  teamsEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  minSeverity: z.enum(ALERT_MIN_SEVERITIES),
});
export type SetAlertSettingsRequest = z.infer<typeof SetAlertSettingsRequest>;

export const AlertGroupQuery = z.object({ groupId: z.uuid().optional() });
export type AlertGroupQuery = z.infer<typeof AlertGroupQuery>;

/** A mobile number in international form: `+`, then 8 to 15 digits (the first is not 0). Spaces and dashes typed by a person are removed. */
export const MOBILE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const normalizeMobile = (text: string): string => text.replace(/[\s\-().]/g, '');

export const MobileNumber = z
  .string()
  .trim()
  .transform(normalizeMobile)
  .pipe(
    z
      .string()
      .regex(
        MOBILE_PATTERN,
        'Write the mobile number in international form: a plus sign, the country code and the number (8 to 15 digits), for example +251911234567.',
      ),
  );

/**
 * `+251 9** *** 12`: the plus sign, the first four digits and the last two. The middle is always the same
 * fixed pattern, so the length of the number is not revealed either.
 */
export const maskMobile = (mobile: string): string => {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 8) return '+*** ***';
  return `+${digits.slice(0, 3)} ${digits[3]}** *** ${digits.slice(-2)}`;
};

/** Set (or, with `mobile: null`, remove) a contact. No `userId` = the caller's own; `alert.manage` may name anyone of the group. */
export const SetAlertContactRequest = z.object({
  groupId: z.uuid().optional(),
  userId: z.uuid().optional(),
  mobile: MobileNumber.nullable(),
});
export type SetAlertContactRequest = z.input<typeof SetAlertContactRequest>;

export interface AlertContactDto {
  groupId: string;
  userId: string;
  displayName: string | null;
  /** The full number for the person themselves and for `alert.manage` holders of the group; masked for everyone else. */
  mobile: string;
  masked: boolean;
  own: boolean;
  updatedAt: string;
}

/** Answer of `PUT /alerts/contacts`: the contact as saved, or `null` after it was removed. */
export interface AlertContactResultDto {
  contact: AlertContactDto | null;
}

/** What `GET /alerts/contacts` answers: the contacts of the caller's group, and whether the caller may set anyone's. */
export interface AlertContactsDto {
  groupId: string;
  contacts: AlertContactDto[];
  /** true when the caller may set anyone's contact in this group (alert.manage). */
  canManage: boolean;
}

export const AlertDeliveriesQuery = z.object({
  status: z.enum(ALERT_DELIVERY_STATUSES).optional(),
  incidentId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type AlertDeliveriesQuery = z.infer<typeof AlertDeliveriesQuery>;

export interface AlertDeliveryDto {
  id: string;
  companyId: string;
  incidentId: string;
  incidentTitle: string | null;
  channel: AlertChannel;
  /** null for a Teams message (it goes to the channel behind the webhook, not to a person). */
  recipientUserId: string | null;
  recipientName: string | null;
  severity: 'critical' | 'high';
  subject: string;
  status: AlertDeliveryStatus;
  attempts: number;
  /** What went wrong the last time, without any secret. */
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

export const TestAlertRequest = z.object({
  channel: z.enum(ALERT_CHANNELS),
  groupId: z.uuid().optional(),
});
export type TestAlertRequest = z.infer<typeof TestAlertRequest>;

export type AlertTestOutcome = 'sent' | 'failed' | 'not_configured' | 'no_contact' | 'disabled';

export interface AlertTestResultDto {
  channel: AlertChannel;
  outcome: AlertTestOutcome;
  /** A plain sentence for the screen. Never contains a secret or a number. */
  message: string;
}

/** The most an SMS may be: the gateway contract and the sheet say "under 300 characters". */
export const SMS_MAX_CHARACTERS = 299;

/** The retry schedule of an alert delivery: five attempts, waiting 1, 2, 4 and 8 minutes between them. */
export const ALERT_MAX_ATTEMPTS = 5;
export const ALERT_BACKOFF_MINUTES = [1, 2, 4, 8] as const;
