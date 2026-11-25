'use client';

import { useMemo, useState } from 'react';
import type { Permission } from '@dcc/contracts';
import { PageHeader } from '@/components/kit/page-header';
import { Callout } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { useWorkspace } from '@/lib/workspace';
import type { WorkspaceScreen } from '@/lib/workspace-routes';

const TEXT = {
  title: 'Help and guides',
  description:
    'How to do the common jobs, step by step, for what your role can do. Everything here describes how DCC really works today.',
  tabsLabel: 'Help topics',
  tabs: {
    jobs: 'How do I…',
    workflow: 'How a post travels',
    words: 'Words we use',
    keys: 'Keyboard',
    problem: 'Something is wrong',
  },
  searchLabel: 'Search the guides',
  searchPlaceholder: 'Search the guides',
  noMatch: 'No guide matches. Try a shorter word.',
  open: 'Open the screen',
  youCan: 'Your role can do this',
  notYou: 'Your role cannot do this. Ask someone who can.',
  stepsHeading: 'Steps',
  workflowIntro:
    'A post always travels the same road. Each step is on the record: who, when and which version.',
  shortcutsIntro: 'DCC works with the keyboard everywhere.',
  problemHeading: 'When something fails',
  problemBody:
    'Every message DCC shows for a refused action carries a request id. Copy it and give it to the person who looks after DCC: it finds your exact request in the logs and in the audit trail.',
  problemSteps: [
    'Read the message: it says in plain words what DCC refused and why.',
    'If it says you need to sign in again, do so: the screen brings you back and you repeat the action.',
    'If it says your role cannot do it, open Roles and permissions to see who can.',
    'If it says "Something went wrong", reload once. If it happens again, send the request id shown under the message.',
  ],
  openRoles: 'Roles and permissions',
};

type Job = {
  id: string;
  title: string;
  /** The permission that makes this job possible for a role (any holder of one of them). */
  needs?: Permission | Permission[];
  screen: WorkspaceScreen;
  steps: string[];
  why?: string;
};

const JOBS: Job[] = [
  {
    id: 'write',
    title: 'Write a post and send it for review',
    needs: 'content.create',
    screen: 'composer',
    steps: [
      'Open Create content and choose the company, the brand and the kind of content (the kind decides who must approve).',
      'Choose the accounts the post is for: each shows whether it can be published to.',
      'Write the text. The counter and the preview show how it looks on each network; add pictures or videos if you need them.',
      'Press Save draft. Press Send for review when you are happy: from then the reviewers are told.',
    ],
    why: 'Nobody who wrote any version of a post may approve it, so someone else always checks.',
  },
  {
    id: 'approve',
    title: 'Review, approve or reject a post',
    needs: 'content.review',
    screen: 'approvals',
    steps: [
      'Open Approvals: the queue shows posts waiting, how many approvals each needs and how many it has.',
      'Open a post to read the text, its previews and the comments so far.',
      'Add a comment, or approve, or reject (say why when you reject). The rule for that kind of content decides how many different people must approve.',
      'If a button is greyed out, the screen says why: you wrote a version, or your role is not in the rule.',
    ],
  },
  {
    id: 'publish',
    title: 'Publish or schedule an approved post',
    needs: 'content.publish',
    screen: 'publishing',
    steps: [
      'Open Publishing: the Ready tab lists approved posts.',
      'Choose the account and publish now, or pick a time to schedule it.',
      'A freeze, a suspended company or an account not connected to the engine stops it, and the screen tells you which.',
      'Afterwards use Check with the engine to settle posts that are still waiting. A scheduled post can be cancelled before its time.',
    ],
  },
  {
    id: 'freeze',
    title: 'Freeze publishing in an emergency',
    needs: 'publishing.freeze',
    screen: 'publishing',
    steps: [
      'Open Publishing and press Freeze publishing.',
      'Choose the company (or one account) and write the reason: it is shown to everyone and kept on the record.',
      'While the freeze is on nothing is published for that company or account. Lifting it asks you to sign in again.',
    ],
  },
  {
    id: 'inbox',
    title: 'Answer comments and messages',
    needs: 'inbox.reply',
    screen: 'inbox',
    steps: [
      'Open the Unified inbox. Filter by unassigned, assigned to you or overdue.',
      'Assign a message to yourself or a colleague, then write the reply and send it.',
      'Each company can set a response target; a message past it is marked overdue.',
    ],
  },
  {
    id: 'account',
    title: 'Register a social account and connect it',
    needs: 'account.manage',
    screen: 'accounts',
    steps: [
      'Open Social accounts and press Register account: choose the company, the network, its name and handle, and who owns it.',
      'Set a backup administrator so the account never depends on one person.',
      'Open the account and link it to a channel of the publishing engine. Until then nothing can be published to it.',
    ],
  },
  {
    id: 'roles',
    title: 'Give someone a role, or take it away',
    needs: 'user.manage',
    screen: 'access',
    steps: [
      'Open Access governance and press Give a role. Type the work email of someone who has signed in to DCC once, and choose where and which role.',
      'To remove a role, use Remove next to it; the dialog says who loses what.',
      'Both ask you to sign in again if your last sign-in is old.',
    ],
  },
  {
    id: 'rules',
    title: 'Set who must approve each kind of content',
    needs: 'approval_policy.manage',
    screen: 'policies',
    steps: [
      'Open Approval rules. Each rule is for a company and a kind of content: how many different people must approve, and which roles may.',
      'A post keeps the rule it was sent under, so changing a rule never changes a post already waiting.',
    ],
  },
  {
    id: 'incident',
    title: 'Report and handle an incident',
    needs: 'incident.manage',
    screen: 'incidents',
    steps: [
      'Open Incidents and report it with a title, the company, the severity and, if you know it, the account.',
      'Choose the kind of incident: its playbook shows the steps to follow and the recovery contacts of the company.',
      'Freeze publishing first if posts may still go out, then update the status as you learn more, and close it with the lessons.',
    ],
  },
  {
    id: 'audit',
    title: 'Find out who did something',
    needs: 'audit.read',
    screen: 'audit',
    steps: [
      'Open Activity audit and filter by person, action, company, thing or date.',
      'Open an event to read its details. Use Verify to check the record was not altered; exporting asks you to sign in again.',
    ],
  },
  {
    id: 'security',
    title: 'Check the security of the Group',
    needs: 'security.read',
    screen: 'security',
    steps: [
      'Open the Security center: two-factor state, accounts without an owner or backup administrator, open incidents, freezes and new administrators.',
      'It also lists what DCC does not watch, so nobody assumes it does.',
    ],
  },
];

const FLOW = [
  ['Draft', 'The author writes and saves. Only the author sees it as work in progress.'],
  ['In review', 'The author sent it. Reviewers comment; approvers decide.'],
  [
    'Approved',
    'Enough different people approved under the rule. A change to the text starts review again.',
  ],
  ['Rejected', 'An approver said no. The author reads why and writes a new version.'],
  [
    'Scheduled or being published',
    'A publisher chose an account and a time (or now). The engine holds or sends it.',
  ],
  ['Published', 'The network has it. DCC keeps the link and the record.'],
  [
    'Failed or unresolved',
    'The engine reported a failure, or DCC cannot tell what happened. DCC never sends it again by itself: check with the engine, or settle it by hand with a reason.',
  ],
];

const WORDS = [
  [
    'Company and brand',
    'A company is a business of the Group; a brand belongs to a company. A post belongs to one company.',
  ],
  [
    'Social account',
    'An official page or profile on a network, registered in DCC with an owner and a backup administrator.',
  ],
  [
    'Engine',
    'The publishing system behind DCC. It carries out what DCC approved and nothing else.',
  ],
  ['Approval rule', 'How many different people, from which roles, must approve a kind of content.'],
  [
    'Freeze',
    'A stop on publishing for a company or one account, with a reason, until someone lifts it.',
  ],
  [
    'Audit trail',
    'The record of who did what and when. It is chained so a change to the past can be detected.',
  ],
  [
    'Incident and playbook',
    'Something that went wrong, and the steps to follow for that kind of problem.',
  ],
  [
    'Sign in again',
    'For sensitive actions DCC asks you to prove who you are again at the single sign-on if your sign-in is old.',
  ],
];

const KEYS = [
  ['Ctrl K (Cmd K on a Mac)', 'Search and jump: screens, companies, accounts, people and posts.'],
  ['Escape', 'Close a dialog, a side panel or the search.'],
  ['Tab and Shift Tab', 'Move between controls; the focus is always visible.'],
  ['Left and Right arrow', 'Move between tabs on a page with tabs.'],
  ['Enter or Space', 'Press the focused button.'],
];

/** A help centre from real product facts, shaped by what the viewer's role can do. */
export function HelpScreen() {
  const { me, open } = useWorkspace();
  const [tab, setTab] = useTabParam(['jobs', 'workflow', 'words', 'keys', 'problem'], 'jobs');
  const [query, setQuery] = useState('');
  const mayDo = (job: Job) => {
    if (!job.needs) return true;
    return (Array.isArray(job.needs) ? job.needs : [job.needs]).some((p) =>
      me.permissions.includes(p),
    );
  };
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = JOBS.filter(
      (job) => !needle || `${job.title} ${job.steps.join(' ')}`.toLowerCase().includes(needle),
    );
    return [...list].sort((a, b) => Number(mayDo(b)) - Number(mayDo(a)));
  }, [query, me.permissions]);

  return (
    <div className="kit-stack">
      <PageHeader title={TEXT.title} description={TEXT.description} />
      <Tabs
        label={TEXT.tabsLabel}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'jobs', label: TEXT.tabs.jobs, count: JOBS.length },
          { id: 'workflow', label: TEXT.tabs.workflow },
          { id: 'words', label: TEXT.tabs.words },
          { id: 'keys', label: TEXT.tabs.keys },
          { id: 'problem', label: TEXT.tabs.problem },
        ]}
      />

      {tab === 'jobs' && (
        <TabPanel id="jobs">
          <div className="kit-search" style={{ maxWidth: 420, marginBottom: 14 }}>
            <label className="visually-hidden" htmlFor="help-search">
              {TEXT.searchLabel}
            </label>
            <input
              id="help-search"
              type="search"
              className="field"
              placeholder={TEXT.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {shown.length === 0 && <p>{TEXT.noMatch}</p>}
          <div className="grid grid-2">
            {shown.map((job) => {
              const can = mayDo(job);
              return (
                <section key={job.id} className="panel" aria-labelledby={`job-${job.id}`}>
                  <div className="panel-header">
                    <div>
                      <h2 id={`job-${job.id}`}>{job.title}</h2>
                      <p>{can ? TEXT.youCan : TEXT.notYou}</p>
                    </div>
                    <span className={`status ${can ? 'status-green' : 'status-gray'}`}>
                      {can ? TEXT.youCan : '—'}
                    </span>
                  </div>
                  <ol className="plain-list" style={{ paddingLeft: 20 }}>
                    {job.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {job.why && <p className="hint">{job.why}</p>}
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => open(job.screen)}
                    >
                      {TEXT.open}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </TabPanel>
      )}

      {tab === 'workflow' && (
        <TabPanel id="workflow">
          <p>{TEXT.workflowIntro}</p>
          <ol className="kit-todo" style={{ marginTop: 12 }}>
            {FLOW.map(([name, body], index) => (
              <li key={name}>
                <div className="kit-todo-main">
                  <strong>
                    {index + 1}. {name}
                  </strong>
                  <small>{body}</small>
                </div>
              </li>
            ))}
          </ol>
        </TabPanel>
      )}

      {tab === 'words' && (
        <TabPanel id="words">
          <dl className="kit-dl kit-dl-1">
            {WORDS.map(([term, meaning]) => (
              <div key={term} className="kit-dl-row">
                <dt>{term}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </TabPanel>
      )}

      {tab === 'keys' && (
        <TabPanel id="keys">
          <p>{TEXT.shortcutsIntro}</p>
          <dl className="kit-dl kit-dl-1" style={{ marginTop: 12 }}>
            {KEYS.map(([key, meaning]) => (
              <div key={key} className="kit-dl-row">
                <dt>
                  <kbd className="kit-kbd">{key}</kbd>
                </dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </TabPanel>
      )}

      {tab === 'problem' && (
        <TabPanel id="problem">
          <Callout tone="info" title={TEXT.problemHeading}>
            {TEXT.problemBody}
          </Callout>
          <ol className="plain-list" style={{ paddingLeft: 20, marginTop: 12 }}>
            {TEXT.problemSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="row-actions">
            <button type="button" className="btn btn-outline" onClick={() => open('roles')}>
              {TEXT.openRoles}
            </button>
          </div>
        </TabPanel>
      )}
    </div>
  );
}
