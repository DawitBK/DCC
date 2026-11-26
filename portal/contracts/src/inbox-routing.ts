// Round 3, routing (2026-11-26): responders per company and language, automatic assignment, claim.
// Own file, so parallel work never edits the same lines.
import { z } from 'zod';
import type { InboxClockMessageDto } from './inbox-clock';

/** Sheet E-11: a message is Amharic when it contains Ethiopic letters (U+1200 to U+137F), else English. */
export const INBOX_LANGUAGES = ['en', 'am'] as const;
export type InboxLanguage = (typeof INBOX_LANGUAGES)[number];

/** Sheet E-15: a primary responder is given new messages; a backup takes over at 150% of the response time. */
export const INBOX_RESPONDER_KINDS = ['primary', 'backup'] as const;
export type InboxResponderKind = (typeof INBOX_RESPONDER_KINDS)[number];

export const MAX_INBOX_RESPONDERS = 50;

export const InboxRespondersQuery = z.object({ companyId: z.uuid() });
export type InboxRespondersQuery = z.infer<typeof InboxRespondersQuery>;

export const InboxResponderInput = z.object({
  userId: z.uuid(),
  kind: z.enum(INBOX_RESPONDER_KINDS),
  languages: z
    .array(z.enum(INBOX_LANGUAGES))
    .min(1, 'Choose at least one language.')
    .max(INBOX_LANGUAGES.length)
    .refine((list) => new Set(list).size === list.length, 'Each language only once.'),
});
export type InboxResponderInput = z.infer<typeof InboxResponderInput>;

/** Replaces the whole list of responders of one company (an empty list clears it). One entry per person. */
export const SetInboxRespondersRequest = z.object({
  companyId: z.uuid(),
  responders: z
    .array(InboxResponderInput)
    .max(MAX_INBOX_RESPONDERS)
    .refine((list) => new Set(list.map((r) => r.userId)).size === list.length, {
      message: 'A person can be a responder only once.',
    }),
});
export type SetInboxRespondersRequest = z.infer<typeof SetInboxRespondersRequest>;

export interface InboxResponderDto {
  userId: string;
  displayName: string;
  kind: InboxResponderKind;
  languages: InboxLanguage[];
  /** False when the person no longer holds `inbox.reply` for the company: the router ignores them. */
  canReply: boolean;
  updatedAt: string;
}

/** `POST /inbox/claim`: take an unassigned message for yourself. */
export const ClaimInboxMessageRequest = z.object({
  socialAccountId: z.uuid(),
  engineMessageId: z.string().trim().min(1).max(200),
});
export type ClaimInboxMessageRequest = z.infer<typeof ClaimInboxMessageRequest>;

/** The inbox list row with the routing fields. The old fields are all kept. */
export interface InboxRoutedMessageDto extends InboxClockMessageDto {
  language: InboxLanguage;
  /** True while the message is held by an assignment the system made, not a person. */
  assignedAutomatically: boolean;
}
