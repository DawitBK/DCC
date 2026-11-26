'use client';

import {
  ROLE_LABELS,
  type ApprovalPolicyFullDto,
  type ApprovalRequestFullDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { effectiveRule, type EffectiveRule } from '@/lib/work';
import { Skeletons } from './parts';
import '@/app/screens/work-shared.css';

const TEXT = {
  ruleTitle: 'The rule this post will be held to',
  source: {
    category: (category: string) => `This company has its own rule for “${category}”.`,
    company: 'This company has a default rule, and this kind of content has no rule of its own.',
    system:
      'This company set no rule, so DCC’s built-in default applies: one approval from any role that may approve.',
  },
  count: (needed: number) =>
    needed === 1
      ? 'It needs 1 approval.'
      : `It needs ${needed} approvals, each from a different person.`,
  roles: (roles: string) => `Only these roles may decide: ${roles}.`,
  anyRole: 'Any role that may approve content may decide.',
  duty: 'Nobody who wrote a version of the post can decide on it.',
  limit: (hours: number, clock: 'working' | 'continuous') =>
    clock === 'continuous'
      ? `Time limit: ${hours} ${hours === 1 ? 'hour' : 'hours'}, counted round the clock. Reviewers are reminded as it runs out.`
      : `Time limit: ${hours} ${hours === 1 ? 'hour' : 'hours'} of office time (Monday to Saturday, 08:30 to 17:30). Reviewers are reminded as it runs out.`,
  noLimit: 'No time limit is set for this kind of content.',
  validity: 'Once approved, the post must be published within 7 days or the approval expires.',
  fixed:
    'The rule is fixed when you send the post: a later change of the rule does not change a request that is waiting.',
  loadError: 'The approval rules could not be read',
  title: 'Send this post for review?',
  body: 'Reviewers of the company are told that a post is waiting. While it is in review, an edit makes a new version and starts again.',
  cancel: 'Cancel',
  send: 'Send for review',
  working: 'Working…',
  sent: 'Sent for review.',
  loading: 'Reading the approval rule…',
};

/** The approval rule in words: where it comes from, how many approvals, which roles. */
export function RuleSummary({
  rule,
  categoryName,
}: {
  rule: EffectiveRule;
  categoryName?: string | null;
}) {
  return (
    <div className="wk-rule" aria-label={TEXT.ruleTitle}>
      <strong>{TEXT.ruleTitle}</strong>
      <p>
        {rule.source === 'category'
          ? TEXT.source.category(categoryName ?? 'this kind of content')
          : rule.source === 'company'
            ? TEXT.source.company
            : TEXT.source.system}
      </p>
      <p>{TEXT.count(rule.requiredApprovals)}</p>
      <p>
        {rule.approverRoles.length > 0
          ? TEXT.roles(rule.approverRoles.map((role) => ROLE_LABELS[role]).join(', '))
          : TEXT.anyRole}
      </p>
      <p>{TEXT.duty}</p>
      <p>
        {rule.timeLimitHours === null ? TEXT.noLimit : TEXT.limit(rule.timeLimitHours, rule.clock)}
      </p>
      <p>{TEXT.validity}</p>
    </div>
  );
}

/** Reads the approval rule of a company (`GET /api/approval-policies?companyId=`) and works out the one that applies. */
export function useRule(companyId: string | null, categoryId: string | null) {
  const policies = useApiData<ApprovalPolicyFullDto[]>(
    companyId ? `/approval-policies?companyId=${companyId}` : null,
  );
  const rule =
    policies.data && companyId ? effectiveRule(policies.data, companyId, categoryId) : null;
  return { rule, loading: policies.loading, error: policies.error };
}

/**
 * Confirm, then `POST /api/content-items/:id/submit`: the rule the post will be held to is shown first, because
 * it is fixed at this moment. Only a draft or a rejected post can be sent; the API answers 409 otherwise.
 */
export function SubmitReviewDialog({
  itemId,
  companyId,
  categoryId,
  categoryName,
  onClose,
  onDone,
}: {
  itemId: string;
  companyId: string;
  categoryId: string | null;
  categoryName?: string | null;
  onClose: () => void;
  onDone: (request: ApprovalRequestFullDto) => void;
}) {
  const { refreshNotifications } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const { rule, loading, error } = useRule(companyId, categoryId);
  return (
    <Dialog title={TEXT.title} description={TEXT.body} onClose={onClose}>
      <ErrorBox error={error} title={TEXT.loadError} loading />
      <ErrorBox error={action.error} />
      {loading && !rule && <Skeletons rows={3} label={TEXT.loading} />}
      {rule && <RuleSummary rule={rule} categoryName={categoryName} />}
      <p className="wk-hint" style={{ marginTop: 10 }}>
        {TEXT.fixed}
      </p>
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {TEXT.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy}
          onClick={async () => {
            let request: ApprovalRequestFullDto | undefined;
            const failure = await action.run(async () => {
              request = await apiSend<ApprovalRequestFullDto>(
                'POST',
                `/content-items/${itemId}/submit`,
              );
            });
            if (failure || !request) return;
            showToast(TEXT.sent);
            refreshNotifications();
            onDone(request);
          }}
        >
          {action.busy ? TEXT.working : TEXT.send}
        </button>
      </DialogActions>
    </Dialog>
  );
}
