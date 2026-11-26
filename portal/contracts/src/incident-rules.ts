// Round 2 (2026-11-26): the two-person freeze lift and the post-incident review (sheet D2-17, D2-18, D2-23).
import { z } from 'zod';
import type { FreezeDto, IncidentDto } from './api';
import { CreateFreezeRequest } from './api';
import type { IncidentSeverity } from './platforms';

/**
 * The workbook speaks of SEV1 to SEV4; the incident register stores low, medium, high and critical.
 * ASSUMPTION: critical = SEV1, high = SEV2, medium = SEV3, low = SEV4.
 */
export const SEVERITY_SEV: Record<IncidentSeverity, 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'> = {
  critical: 'SEV1',
  high: 'SEV2',
  medium: 'SEV3',
  low: 'SEV4',
};

/** SEV1 and SEV2: a two-person freeze lift and a post-incident review are required. */
export const isSevereIncident = (severity: IncidentSeverity): boolean =>
  severity === 'critical' || severity === 'high';

/** A post-incident review is due this many business days after the incident was first marked resolved (D2-23). */
export const REVIEW_BUSINESS_DAYS = 5;

/** The two sides of lifting a freeze tied to a SEV1 or SEV2 incident. */
export const FREEZE_LIFT_SIDES = ['security', 'communications'] as const;
export type FreezeLiftSide = (typeof FREEZE_LIFT_SIDES)[number];

/** Freezing is unchanged; `incidentId` optionally ties the freeze to an incident of the same company. */
export const CreateFreezeWithIncidentRequest = CreateFreezeRequest.extend({
  incidentId: z.uuid().optional(),
});
export type CreateFreezeWithIncidentRequest = z.infer<typeof CreateFreezeWithIncidentRequest>;

/** The side is in the route (`/lift-confirmations/security` or `/communications`), because each side needs its own permission. */
export const ConfirmFreezeLiftRequest = z.object({
  note: z.string().trim().min(1).max(500).optional(),
});
export type ConfirmFreezeLiftRequest = z.infer<typeof ConfirmFreezeLiftRequest>;

export interface FreezeLiftConfirmationDto {
  id: string;
  side: FreezeLiftSide;
  confirmedBy: string;
  confirmedByName: string | null;
  note: string | null;
  confirmedAt: string;
}

/** A freeze as the screens see it: the old fields plus the incident link and the state of the two-person lift. */
export interface FreezeWithLiftDto extends FreezeDto {
  incidentId: string | null;
  incidentTitle: string | null;
  incidentSeverity: IncidentSeverity | null;
  /** true: lifting needs one confirmation from each side, from two different people. */
  twoPersonLift: boolean;
  /** The live (not withdrawn) confirmations. */
  liftConfirmations: FreezeLiftConfirmationDto[];
  /** Sides still missing; empty for a one-person freeze. */
  liftMissing: FreezeLiftSide[];
}

/** Answer of a confirmation: `lifted` is true when it was the second one and the freeze is gone. */
export interface FreezeLiftResultDto {
  freezeId: string;
  lifted: boolean;
  /** The freeze as it stands after this confirmation; null once it is lifted. */
  freeze: FreezeWithLiftDto | null;
}

const reviewText = (label: string) =>
  z
    .string()
    .trim()
    .min(3, `${label} is required.`)
    .max(5_000, `${label} is too long (5000 characters at most).`);

/** Recording (or correcting) the review of an incident. Needs incident.manage. */
export const RecordIncidentReviewRequest = z.object({
  cause: reviewText('The cause'),
  impact: reviewText('The impact'),
  response: reviewText('The response'),
  correctiveActions: reviewText('The corrective actions'),
  preventiveMeasures: reviewText('The preventive measures'),
  /** Names of the people who took part (they need no DCC account). */
  participants: z.array(z.string().trim().min(2).max(120)).min(1).max(30),
  /** When the review meeting was held. */
  heldAt: z.iso.datetime({ offset: true }),
});
export type RecordIncidentReviewRequest = z.infer<typeof RecordIncidentReviewRequest>;

export interface IncidentReviewDto {
  id: string;
  incidentId: string;
  cause: string;
  impact: string;
  response: string;
  correctiveActions: string;
  preventiveMeasures: string;
  participants: string[];
  heldAt: string;
  recordedBy: string;
  recordedByName: string | null;
  recordedAt: string;
  updatedAt: string;
}

/** An incident with the review fields of Round 2. */
export interface IncidentWithReviewDto extends IncidentDto {
  /** true for an incident that is, or ever was, SEV1 or SEV2. */
  reviewRequired: boolean;
  /** When the review is due; null while the incident has not been resolved yet (the clock has not started) or needs none. */
  reviewDueAt: string | null;
  /** The review is required, not recorded, and its due time has passed. */
  reviewOverdue: boolean;
  /** The review, once recorded. */
  review: IncidentReviewDto | null;
}
