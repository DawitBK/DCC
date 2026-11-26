'use client';

import { useState } from 'react';
import {
  INBOX_LANGUAGES,
  INBOX_RESPONDER_KINDS,
  SetInboxRespondersRequest,
  type CompanyDto,
  type InboxAssigneeDto,
  type InboxLanguage,
  type InboxResponderDto,
  type InboxResponderKind,
} from '@dcc/contracts';
import { apiSend, queryString } from '@/lib/browser-api';
import { validate } from '@/lib/forms';
import { useAction, useApiData } from '@/lib/use-api';
import { ErrorBox } from './error-box';
import { SectionPanel } from './section-panel';
import { useToast } from './toast';
import '../app/screens/inbox-routing.css';

export const LANGUAGE_LABEL: Record<InboxLanguage, string> = { en: 'English', am: 'Amharic' };
const KIND_LABEL: Record<InboxResponderKind, string> = {
  primary: 'Primary: gets new messages',
  backup: 'Backup: takes over when a message is late',
};

const TEXT = {
  title: 'Who answers the inbox',
  subtitle:
    'New messages are given by themselves to a primary responder who answers the message’s language (Amharic if it has Amharic letters, otherwise English), the one with the fewest open messages. A backup responder takes over when a message is 50% past its response time. With nobody listed, everyone who may reply shares the work.',
  empty: 'Nobody is listed for this company yet.',
  add: 'Add a person',
  addPlaceholder: 'Choose a person…',
  remove: 'Remove',
  person: 'Person',
  role: 'Role',
  languages: 'Languages',
  save: 'Save responders',
  saving: 'Saving…',
  saved: (company: string) => `${company}: responders saved.`,
  cannotReply: 'This person can no longer reply for this company and is ignored until they can.',
  noCandidates: 'Nobody can reply for this company yet, so nobody can be listed.',
  loading: 'Loading people…',
  needLanguage: 'Choose at least one language for each person.',
};

type Row = { userId: string; kind: InboxResponderKind; languages: InboxLanguage[] };

const rowsOf = (list: InboxResponderDto[]): Row[] =>
  list.map((r) => ({ userId: r.userId, kind: r.kind, languages: r.languages }));

/**
 * Round 3 (E-15, B-37): the responders of each company the person manages the inbox of. `GET/PUT /api/inbox/responders`
 * and `GET /api/inbox/responders/candidates`. UI visibility only: the API decides and answers 403 otherwise.
 */
export function InboxResponders({ companies }: { companies: CompanyDto[] }) {
  if (companies.length === 0) return null;
  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      <div className="clock-companies">
        {companies.map((company) => (
          <ResponderForm key={company.id} company={company} />
        ))}
      </div>
    </SectionPanel>
  );
}

function ResponderForm({ company }: { company: CompanyDto }) {
  const showToast = useToast();
  const action = useAction();
  const saved = useApiData<InboxResponderDto[]>(
    `/inbox/responders${queryString({ companyId: company.id })}`,
  );
  const candidates = useApiData<InboxAssigneeDto[]>(
    `/inbox/responders/candidates${queryString({ companyId: company.id })}`,
  );
  // null = nothing changed yet: the form shows what is saved.
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [addId, setAddId] = useState('');

  if (saved.error) return <ErrorBox error={saved.error} loading />;
  if (!saved.data) return <p className="hint">{TEXT.loading}</p>;
  const rows = draft ?? rowsOf(saved.data);
  const names = new Map<string, string>([
    ...saved.data.map((r) => [r.userId, r.displayName] as const),
    ...(candidates.data ?? []).map((p) => [p.userId, p.displayName] as const),
  ]);
  const cannotReply = new Set(saved.data.filter((r) => !r.canReply).map((r) => r.userId));
  const available = (candidates.data ?? []).filter((p) => !rows.some((r) => r.userId === p.userId));
  const change = (next: Row[]) => {
    setDraft(next);
    setProblem(null);
  };
  const patch = (userId: string, update: Partial<Row>) =>
    change(rows.map((r) => (r.userId === userId ? { ...r, ...update } : r)));
  const toggleLanguage = (row: Row, language: InboxLanguage, on: boolean) =>
    patch(row.userId, {
      languages: INBOX_LANGUAGES.filter((l) => (l === language ? on : row.languages.includes(l))),
    });

  const submit = async () => {
    if (rows.some((r) => r.languages.length === 0)) return setProblem(TEXT.needLanguage);
    const checked = validate(SetInboxRespondersRequest, {
      companyId: company.id,
      responders: rows,
    });
    if (!checked.ok) return setProblem(Object.values(checked.errors)[0] ?? TEXT.needLanguage);
    const failure = await action.run(() => apiSend('PUT', '/inbox/responders', checked.data));
    if (failure) return;
    showToast(TEXT.saved(company.name));
    setDraft(null);
    saved.reload();
    candidates.reload();
  };

  return (
    <form
      className="responder-company"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="clock-company-name">{company.name}</h3>
      <ErrorBox error={action.error} />
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="hint">{TEXT.empty}</p>
      ) : (
        <ul className="responder-list">
          {rows.map((row) => {
            const name = names.get(row.userId) ?? 'Someone';
            return (
              <li key={row.userId} className="responder-row">
                <div className="responder-person">
                  <strong>{name}</strong>
                  {cannotReply.has(row.userId) && (
                    <small className="field-error">{TEXT.cannotReply}</small>
                  )}
                </div>
                <label className="responder-field">
                  <span className="label">
                    {TEXT.role}
                    <span className="visually-hidden"> of {name}</span>
                  </span>
                  <select
                    className="select-field"
                    value={row.kind}
                    onChange={(event) =>
                      patch(row.userId, { kind: event.target.value as InboxResponderKind })
                    }
                  >
                    {INBOX_RESPONDER_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="responder-field responder-languages">
                  <legend className="label">
                    {TEXT.languages}
                    <span className="visually-hidden"> of {name}</span>
                  </legend>
                  {INBOX_LANGUAGES.map((language) => (
                    <label key={language} className="platform-option">
                      <input
                        type="checkbox"
                        checked={row.languages.includes(language)}
                        onChange={(event) => toggleLanguage(row, language, event.target.checked)}
                      />
                      {LANGUAGE_LABEL[language]}
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => change(rows.filter((r) => r.userId !== row.userId))}
                >
                  {TEXT.remove}
                  <span className="visually-hidden"> {name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="responder-add">
        <label className="responder-field">
          <span className="label">{TEXT.add}</span>
          <select
            className="select-field"
            value={addId}
            disabled={candidates.loading && !candidates.data}
            onChange={(event) => {
              const userId = event.target.value;
              setAddId('');
              if (userId) change([...rows, { userId, kind: 'primary', languages: ['en', 'am'] }]);
            }}
          >
            <option value="">
              {candidates.data && available.length === 0 && rows.length === 0
                ? TEXT.noCandidates
                : TEXT.addPlaceholder}
            </option>
            {available.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-outline" disabled={action.busy || draft === null}>
          {action.busy ? TEXT.saving : TEXT.save}
        </button>
      </div>
    </form>
  );
}
