'use client';

import { useMemo, useState } from 'react';
import {
  PublishContentRequest,
  type ContentItemDto,
  type ContentVersionDto,
  type FreezeDto,
  type PublicationDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { Callout } from '@/components/kit/parts';
import { apiSend } from '@/lib/browser-api';
import { currentVersionOf } from '@/lib/content';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { PLATFORM_LABELS, PUBLICATION_STATUS } from '@/lib/labels';
import { networkWarnings } from '@/lib/networks';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import {
  PUBLICATION_MEANING,
  accountPublishState,
  accountReadiness,
  addDays,
  toLocalInput,
} from '@/lib/work';
import { Skeletons, WhyBox } from './parts';
import '@/app/screens/work-shared.css';

const TEXT = {
  titleNow: 'Publish this post',
  titleLater: 'Schedule this post',
  intro:
    'Choose one account the post was approved for. Each account is a separate publication, so do this once for every account.',
  postText: 'What will be sent',
  files: (count: number) =>
    count === 1 ? '1 picture or video goes with it' : `${count} pictures and videos go with it`,
  noFiles: 'No pictures or videos',
  account: 'Account',
  accountHint: 'Only the accounts this version was written for.',
  noTargets: 'This version has no target accounts.',
  readiness: 'Engine and register',
  when: 'When',
  now: 'Now',
  later: 'At a planned time',
  at: 'Date and time',
  atHint: (zone: string) => `Your local time (${zone}). It must be in the future.`,
  presetHour: 'In 1 hour',
  presetTomorrow: 'Tomorrow at 9:00',
  presetMonday: 'Next Monday at 9:00',
  atRequired: 'Choose the date and time.',
  atInvalid: 'This is not a date and time.',
  freezeUnknown:
    'You may not list freezes, so this screen cannot tell if publishing is frozen. DCC checks again when you send and refuses if it is.',
  nowWarning:
    'Publishing now sends the post to the network straight away. It cannot be taken back from here.',
  laterWarning:
    'The engine will hold the post and send it at that time. You can cancel it until then.',
  networkProblems: (platform: string) => `For ${platform}, DCC found:`,
  networkNote: 'DCC does not block these: the network decides.',
  cancel: 'Cancel',
  close: 'Close',
  working: 'Working…',
  publishNow: 'Publish now',
  schedule: 'Schedule',
  published: (account: string) => `Published to ${account}.`,
  scheduled: (account: string, when: string) => `Scheduled for ${account} at ${when}.`,
  resultTitle: 'The engine did not confirm a send',
  resultError: 'What the engine said',
  recorded: 'DCC recorded this publication. Open it to follow what happens next.',
  loadingVersion: 'Reading the approved version…',
  versionError: 'The approved version could not be read',
};

/**
 * The one place a post is sent to an account, now or at a planned time: `POST /api/content-items/:id/publish`.
 * It shows what would be sent, which accounts can take it and what stops the others, and says in plain words
 * what the engine answered. A send the engine did not confirm (`pending`, `failed`) is shown here, not hidden
 * behind a success message. The API checks everything again: approval, freeze, company and account state.
 */
export function PublishDialog({
  item,
  accounts,
  publications,
  freezes,
  initialAccountId,
  initialLater = false,
  onClose,
  onDone,
}: {
  item: ContentItemDto;
  accounts: readonly SocialAccountDto[];
  /** What is already known about publications, so an account that already holds this version is shown as such. */
  publications: readonly PublicationDto[];
  /** The freezes this person may list; null when they may not (the API still checks). */
  freezes: readonly FreezeDto[] | null;
  initialAccountId?: string;
  initialLater?: boolean;
  onClose: () => void;
  /** The API recorded a publication: read the lists again. */
  onDone: (publication: PublicationDto) => void;
}) {
  const { companies } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const versions = useApiData<ContentVersionDto[]>(`/content-items/${item.id}/versions`);
  const version = currentVersionOf(item, versions.data ?? undefined);
  const company = companies.find((entry) => entry.id === item.companyId);
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const states = useMemo(
    () =>
      (version?.targetAccountIds ?? []).flatMap((id) => {
        const account = accounts.find((entry) => entry.id === id);
        return account && version
          ? [
              accountPublishState({
                item,
                versionTargetIds: version.targetAccountIds,
                account,
                company,
                publications,
                freezes: freezes ? [...freezes] : null,
              }),
            ]
          : [];
      }),
    [accounts, company, freezes, item, publications, version],
  );

  const [chosen, setChosen] = useState(initialAccountId ?? '');
  const [later, setLater] = useState(initialLater);
  const [at, setAt] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<PublicationDto | null>(null);

  const current =
    states.find((state) => state.account.id === chosen) ?? states.find((state) => state.ready);
  const accountId = current?.account.id ?? '';
  const warnings =
    current && version
      ? networkWarnings(current.account.platform, version.body, version.media)
      : [];

  const setPreset = (date: Date) => {
    setLater(true);
    setAt(toLocalInput(date));
    setErrors({});
  };
  const presets = () => {
    const hour = new Date(Date.now() + 60 * 60 * 1000);
    const tomorrow = addDays(new Date(), 1);
    tomorrow.setHours(9, 0, 0, 0);
    const monday = addDays(new Date(), (8 - new Date().getDay()) % 7 || 7);
    monday.setHours(9, 0, 0, 0);
    return { hour, tomorrow, monday };
  };

  const submit = async () => {
    const when = later && at ? new Date(at) : null;
    if (later && !at) return setErrors({ scheduledAt: TEXT.atRequired });
    if (later && (!when || Number.isNaN(when.getTime())))
      return setErrors({ scheduledAt: TEXT.atInvalid });
    const checked = validate(PublishContentRequest, {
      socialAccountId: accountId,
      scheduledAt: later && when ? when.toISOString() : undefined,
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    let answer: PublicationDto | undefined;
    const failure = await action.run(async () => {
      answer = await apiSend<PublicationDto>(
        'POST',
        `/content-items/${item.id}/publish`,
        checked.data,
      );
    });
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    if (!answer) return;
    const name = current
      ? `${PLATFORM_LABELS[current.account.platform]} · ${current.account.displayName}`
      : '';
    if (answer.status === 'published') showToast(TEXT.published(name));
    else if (answer.status === 'scheduled')
      showToast(TEXT.scheduled(name, formatDateTime(answer.scheduledAt)));
    if (answer.status === 'published' || answer.status === 'scheduled') return onDone(answer);
    setResult(answer);
  };

  const noneReady = states.length > 0 && !states.some((state) => state.ready);

  return (
    <Dialog
      title={later ? TEXT.titleLater : TEXT.titleNow}
      description={TEXT.intro}
      onClose={onClose}
      wide
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!result) void submit();
        }}
      >
        <ErrorBox error={versions.error} title={TEXT.versionError} loading />
        <ErrorBox error={action.error} />
        {versions.loading && !version && <Skeletons rows={3} label={TEXT.loadingVersion} />}
        {version && (
          <div className="wk-stack">
            <div>
              <span className="label">{TEXT.postText}</span>
              <div className="wk-text-box">
                <p className="wk-body-text">{version.body}</p>
              </div>
              <small className="hint">
                {version.media.length ? TEXT.files(version.media.length) : TEXT.noFiles}
              </small>
            </div>

            {result ? (
              <div className="wk-result" role="alert">
                <Callout
                  tone={result.status === 'failed' ? 'danger' : 'warn'}
                  title={TEXT.resultTitle}
                >
                  <StatusChip status={PUBLICATION_STATUS[result.status]} />{' '}
                  {PUBLICATION_MEANING[result.status]}
                </Callout>
                {result.error && (
                  <div>
                    <span className="label">{TEXT.resultError}</span>
                    <p className="wk-error-text">{result.error}</p>
                  </div>
                )}
                <small className="hint">{TEXT.recorded}</small>
              </div>
            ) : (
              <>
                <fieldset className="wk-radio-list" aria-describedby="publish-account-hint">
                  <legend className="label">
                    {TEXT.account}
                    <span className="required-mark" aria-hidden="true">
                      {' '}
                      *
                    </span>
                  </legend>
                  {states.length === 0 && <p className="wk-hint">{TEXT.noTargets}</p>}
                  {states.map((state) => {
                    const readiness = accountReadiness(state.account);
                    return (
                      <label
                        key={state.account.id}
                        className="wk-radio"
                        data-disabled={!state.ready}
                      >
                        <input
                          type="radio"
                          name="publish-account"
                          value={state.account.id}
                          checked={accountId === state.account.id}
                          disabled={!state.ready}
                          onChange={() => {
                            setChosen(state.account.id);
                            setErrors({});
                          }}
                        />
                        <span>
                          <strong>
                            {PLATFORM_LABELS[state.account.platform]} · {state.account.displayName}
                          </strong>{' '}
                          {state.existing ? (
                            <StatusChip
                              label={`Already ${PUBLICATION_STATUS[state.existing.status].label.toLowerCase()}`}
                              tone={PUBLICATION_STATUS[state.existing.status].tone}
                            />
                          ) : (
                            <StatusChip label={readiness.label} tone={readiness.tone} />
                          )}
                          {state.blockers.length > 0 ? (
                            <small>{state.blockers.join(' ')}</small>
                          ) : (
                            <small>{readiness.detail}</small>
                          )}
                        </span>
                      </label>
                    );
                  })}
                  <small className="hint" id="publish-account-hint">
                    {TEXT.accountHint}
                  </small>
                  {errors.socialAccountId && (
                    <small className="field-error" role="alert">
                      {errors.socialAccountId}
                    </small>
                  )}
                </fieldset>

                {noneReady && (
                  <WhyBox
                    title="This post cannot be published to any of its accounts yet"
                    reasons={[...new Set(states.flatMap((state) => state.blockers))]}
                  />
                )}

                {warnings.length > 0 && current && (
                  <Callout
                    tone="warn"
                    title={TEXT.networkProblems(PLATFORM_LABELS[current.account.platform])}
                  >
                    {warnings.join(' ')} {TEXT.networkNote}
                  </Callout>
                )}

                <fieldset className="wk-radio-list">
                  <legend className="label">{TEXT.when}</legend>
                  <label className="wk-radio">
                    <input
                      type="radio"
                      name="publish-when"
                      checked={!later}
                      onChange={() => setLater(false)}
                    />
                    <span>
                      <strong>{TEXT.now}</strong>
                      <small>{TEXT.nowWarning}</small>
                    </span>
                  </label>
                  <label className="wk-radio">
                    <input
                      type="radio"
                      name="publish-when"
                      checked={later}
                      onChange={() => setLater(true)}
                    />
                    <span>
                      <strong>{TEXT.later}</strong>
                      <small>{TEXT.laterWarning}</small>
                    </span>
                  </label>
                </fieldset>
                {later && (
                  <div>
                    <FormField
                      label={TEXT.at}
                      hint={TEXT.atHint(zone)}
                      error={errors.scheduledAt}
                      required
                    >
                      {(control) => (
                        <input
                          className="field"
                          type="datetime-local"
                          {...control}
                          value={at}
                          min={toLocalInput(new Date())}
                          onChange={(event) => setAt(event.target.value)}
                        />
                      )}
                    </FormField>
                    <div className="wk-presets">
                      <button type="button" onClick={() => setPreset(presets().hour)}>
                        {TEXT.presetHour}
                      </button>
                      <button type="button" onClick={() => setPreset(presets().tomorrow)}>
                        {TEXT.presetTomorrow}
                      </button>
                      <button type="button" onClick={() => setPreset(presets().monday)}>
                        {TEXT.presetMonday}
                      </button>
                    </div>
                  </div>
                )}
                {freezes === null && <p className="wk-hint">{TEXT.freezeUnknown}</p>}
              </>
            )}
          </div>
        )}
        <DialogActions>
          {result ? (
            <button type="button" className="btn btn-primary" onClick={() => onDone(result)}>
              {TEXT.close}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-outline" onClick={onClose}>
                {TEXT.cancel}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={action.busy || !current || !current.ready}
              >
                {action.busy ? TEXT.working : later ? TEXT.schedule : TEXT.publishNow}
              </button>
            </>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
