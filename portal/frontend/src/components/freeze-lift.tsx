'use client';

import { useState } from 'react';
import {
  FREEZE_LIFT_SIDES,
  SEVERITY_SEV,
  type FreezeLiftResultDto,
  type FreezeLiftSide,
  type FreezeWithLiftDto,
  type IncidentWithReviewDto,
  type Permission,
} from '@dcc/contracts';
import { FormField } from '@/components/form-field';
import { Callout } from '@/components/kit/parts';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { formatDateTime } from '@/lib/format';
import { useApiData, useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { ConfirmDialog, GatedButton } from '@/app/screens/registry-shared';
import { ErrorBox } from '@/components/error-box';

const TEXT = {
  title: 'Two people must confirm lifting this freeze',
  tiedTo: (title: string, sev: string) => `Tied to the ${sev} incident “${title}”.`,
  rule: 'Because the incident is SEV1 or SEV2, one person on the security side and a different person on the communications side must each confirm. One person can give only one of the two.',
  security: 'Security side',
  securityWho: 'Group CTO or Security Administrator',
  communications: 'Communications side',
  communicationsWho: 'Marketing & Communications Manager or senior management',
  waiting: 'Waiting for a confirmation',
  confirmedBy: (who: string, when: string) => `Confirmed by ${who}, ${when}`,
  confirmedByYou: (when: string) => `Confirmed by you, ${when}`,
  noteLabel: 'Note (optional)',
  noteHint: 'For example why it is safe to resume. It is kept on the record.',
  confirm: (side: string) => `Confirm as the ${side}`,
  confirmTitle: (side: string) => `Confirm lifting the freeze as the ${side}?`,
  confirmBody:
    'Your confirmation is recorded with your name. When the other side has confirmed too, publishing starts again straight away. You can withdraw yours until then.',
  confirmReauth:
    'This is a sensitive action: if your last sign-in is old you are asked to sign in again, then repeat it.',
  withdraw: 'Withdraw my confirmation',
  withdrawn: 'Your confirmation was withdrawn.',
  confirmed: 'Your confirmation was recorded. The other side was told.',
  lifted: 'Both confirmations are in. Publishing is unfrozen.',
  sameDay: 'You already gave the other confirmation. A different person must give this one.',
  mayNotNote: (who: string) => `Only ${who} can give this confirmation.`,
  tied: 'Tie to an incident',
  tiedHint:
    'Optional. If the incident is SEV1 (critical) or SEV2 (high), lifting this freeze will need two confirmations from two different people.',
  noIncident: 'Not tied to an incident',
  twoPeopleChip: 'Needs two people to lift',
};

const SIDE_TEXT: Record<FreezeLiftSide, { label: string; who: string; permission: Permission }> = {
  security: { label: TEXT.security, who: TEXT.securityWho, permission: 'security.manage' },
  communications: {
    label: TEXT.communications,
    who: TEXT.communicationsWho,
    permission: 'publishing.lift_comms',
  },
};

/** The state of a two-person lift, with the buttons for the sides the person may act on. */
export function FreezeLiftPanel({
  freeze,
  onChanged,
}: {
  freeze: FreezeWithLiftDto;
  onChanged: () => void;
}) {
  const { can, me } = useWorkspace();
  const showToast = useToast();
  const withdrawing = useAction();
  const [confirming, setConfirming] = useState<FreezeLiftSide | null>(null);
  const [note, setNote] = useState('');
  const mine = freeze.liftConfirmations.find((c) => c.confirmedBy === me.user.id);

  if (!freeze.twoPersonLift) return null;
  const sev = freeze.incidentSeverity ? SEVERITY_SEV[freeze.incidentSeverity] : 'SEV1 or SEV2';

  return (
    <div className="gov-stack-tight" data-testid="freeze-lift">
      <Callout tone="warn" title={TEXT.title}>
        {freeze.incidentTitle && (
          <p className="rg-note">{TEXT.tiedTo(freeze.incidentTitle, sev)}</p>
        )}
        <p className="rg-note">{TEXT.rule}</p>
      </Callout>
      <ul className="inc-contacts">
        {FREEZE_LIFT_SIDES.map((side) => {
          const info = SIDE_TEXT[side];
          const given = freeze.liftConfirmations.find((c) => c.side === side);
          const mayAct = can(info.permission, freeze.companyId);
          return (
            <li key={side} className="inc-contact">
              <span className="inc-contact-name">
                <strong>{info.label}</strong>
                <span>{info.who}</span>
              </span>
              <span className="inc-contact-way">
                {given ? (
                  <span role="status">
                    {given.confirmedBy === me.user.id
                      ? TEXT.confirmedByYou(formatDateTime(given.confirmedAt))
                      : TEXT.confirmedBy(
                          given.confirmedByName ?? given.confirmedBy.slice(0, 8),
                          formatDateTime(given.confirmedAt),
                        )}
                    {given.note ? ` — “${given.note}”` : ''}
                  </span>
                ) : (
                  <span>{TEXT.waiting}</span>
                )}
                {given && given.confirmedBy === me.user.id ? (
                  <GatedButton
                    allowed
                    permission={info.permission}
                    compact
                    className="text-link"
                    busy={withdrawing.busy}
                    onClick={async () => {
                      const failure = await withdrawing.run(() =>
                        apiSend(
                          'DELETE',
                          `/publishing-freezes/${freeze.id}/lift-confirmations/${side}`,
                        ),
                      );
                      if (failure) return;
                      showToast(TEXT.withdrawn);
                      onChanged();
                    }}
                  >
                    {TEXT.withdraw}
                  </GatedButton>
                ) : !given ? (
                  <GatedButton
                    allowed={mayAct && !mine}
                    permission={info.permission}
                    reason={mayAct && mine ? TEXT.sameDay : TEXT.mayNotNote(info.who)}
                    compact
                    className="btn btn-outline"
                    onClick={() => {
                      setNote('');
                      setConfirming(side);
                    }}
                  >
                    {TEXT.confirm(info.label.toLowerCase())}
                  </GatedButton>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <ErrorBox error={withdrawing.error} />
      {confirming && (
        <ConfirmDialog
          title={TEXT.confirmTitle(SIDE_TEXT[confirming].label.toLowerCase())}
          confirmLabel={TEXT.confirm(SIDE_TEXT[confirming].label.toLowerCase())}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            const side = confirming;
            const result = await apiSend<FreezeLiftResultDto>(
              'POST',
              `/publishing-freezes/${freeze.id}/lift-confirmations/${side}`,
              note.trim() ? { note: note.trim() } : {},
            );
            showToast(result.lifted ? TEXT.lifted : TEXT.confirmed);
            onChanged();
          }}
        >
          <p>{TEXT.confirmBody}</p>
          <FormField label={TEXT.noteLabel} hint={TEXT.noteHint}>
            {(control) => (
              <textarea
                className="textarea-field"
                style={{ minHeight: 70 }}
                {...control}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </FormField>
          <p className="rg-note">{TEXT.confirmReauth}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** A short chip text for lists of freezes. */
export const TWO_PEOPLE_CHIP = TEXT.twoPeopleChip;

/** The optional "tie this freeze to an incident" choice of the freeze dialog (open incidents of the company only). */
export function FreezeIncidentField({
  companyId,
  value,
  onChange,
}: {
  companyId: string;
  value: string;
  onChange: (incidentId: string) => void;
}) {
  const { can } = useWorkspace();
  const incidents = useApiData<IncidentWithReviewDto[]>(
    can('incident.read', companyId) ? '/incidents' : null,
  );
  const open = (incidents.data ?? []).filter(
    (item) => item.companyId === companyId && item.status !== 'closed',
  );
  if (!can('incident.read', companyId)) return null;
  return (
    <FormField label={TEXT.tied} hint={TEXT.tiedHint}>
      {(control) => (
        <select
          className="select-field"
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{TEXT.noIncident}</option>
          {open.map((item) => (
            <option key={item.id} value={item.id}>
              {SEVERITY_SEV[item.severity]}: {item.title}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
