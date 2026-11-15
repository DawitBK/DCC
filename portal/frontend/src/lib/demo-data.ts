export type DemoStatus =
  'Needs review' | 'Changes requested' | 'Approved' | 'Scheduled' | 'Published' | 'Draft';

export type DemoPost = {
  id: string;
  title: string;
  company: string;
  creator: string;
  platforms: string[];
  status: DemoStatus;
  date: string;
  time: string;
  caption: string;
};

export const DEMO_GROUP_NAME = 'Kerchanshe Group';

/** Edit this fixture to change the sample portfolio. It is not the approved legal company list. */
export const DEMO_COMPANY_CONFIG = [
  { id: 'demo-bunapen', name: 'Bunapen', accent: '#0e7c86' },
  { id: 'demo-bunaplet', name: 'Bunaplet', accent: '#8464a8' },
  { id: 'demo-geely', name: 'Geely', accent: '#3977a8' },
  { id: 'demo-equipment', name: 'Kerchanshe Equipment', accent: '#a86d37' },
  { id: 'demo-coffee-farm', name: 'Coffee Farm', accent: '#688246' },
  { id: 'demo-bunapulse', name: 'Bunapulse', accent: '#bf685f' },
  {
    id: 'demo-other',
    name: 'Other Kerchanshe Group companies and institutions',
    accent: '#697b8d',
  },
  { id: 'demo-oro-meat', name: 'Oro Meat', accent: '#9a4f42' },
  { id: 'demo-kerchanshe-transport', name: 'Kerchanshe Transport', accent: '#4c7188' },
] as const;

export const DEMO_COMPANIES = [
  'All companies',
  ...DEMO_COMPANY_CONFIG.map((company) => company.name),
];
export const DEMO_POSTS: DemoPost[] = DEMO_COMPANY_CONFIG.map((company, index) => ({
  id: `DCC-${1060 + index}`,
  title: `Sample communications update ${index + 1}`,
  company: company.name,
  creator: `Sample Creator ${String.fromCharCode(65 + index)}`,
  platforms: [
    ['Instagram', 'Facebook'],
    ['LinkedIn'],
    ['Facebook', 'X'],
    ['YouTube'],
    ['Instagram'],
    ['LinkedIn', 'X'],
    ['Facebook'],
    ['Instagram'],
    ['LinkedIn'],
  ][index],
  status: (
    [
      'Scheduled',
      'Needs review',
      'Approved',
      'Published',
      'Draft',
      'Changes requested',
      'Scheduled',
      'Needs review',
      'Approved',
    ] as const
  )[index],
  date: `2026-11-${String(12 + index).padStart(2, '0')}`,
  time: `${String(9 + index).padStart(2, '0')}:30`,
  caption: `Fictional sample copy for the ${company.name} workspace. This content is for frontend demonstration only.`,
}));

/** Placeholder account rows only; these are not connected or verified social profiles. */
export const DEMO_ACCOUNTS = DEMO_COMPANY_CONFIG.map((company, index) => ({
  company: company.name,
  brand: 'Brand not configured',
  platform: ['Instagram', 'LinkedIn', 'Facebook', 'YouTube', 'TikTok', 'X'][index % 6],
  name: `${company.name} sample account placeholder`,
  handle: `placeholder-${company.id}`,
  status: 'Sample only',
  owner: 'Sample workspace',
}));

export const DEMO_ACTIVITY = [
  {
    person: 'Sample Creator A',
    action: 'submitted “Seasonal campaign launch” for review',
    time: '12 minutes ago',
  },
  { person: 'Sample Reviewer B', action: 'reviewed “Team update”', time: '48 minutes ago' },
  {
    person: 'Sample Publisher C',
    action: 'updated a draft for “Meet our team”',
    time: '2 hours ago',
  },
  {
    person: 'Sample workspace team',
    action: 'reviewed a sample account placeholder',
    time: 'Yesterday',
  },
];

export const DEMO_PEOPLE = DEMO_COMPANY_CONFIG.flatMap((company, index) => [
  {
    name: `Sample Creator ${String.fromCharCode(65 + index)}`,
    role: 'Content creator',
    company: company.name,
    activity: `${index + 1} drafts`,
  },
  {
    name: `Sample Reviewer ${String.fromCharCode(65 + index)}`,
    role: 'Content reviewer',
    company: company.name,
    activity: `${(index % 3) + 1} reviews waiting`,
  },
  {
    name: `Sample Publisher ${String.fromCharCode(65 + index)}`,
    role: 'Publisher',
    company: company.name,
    activity: 'Active this week',
  },
]);

export const DEMO_AUDIT = DEMO_COMPANY_CONFIG.map((company, index) => ({
  id: `demo-audit-${index + 1}`,
  occurred_at: `2026-11-${String(12 + index).padStart(2, '0')}T09:30:00.000Z`,
  actor_user_id: `preview-user-${String.fromCharCode(65 + index)}`,
  action: [
    'content.submitted',
    'content.reviewed',
    'account.status_checked',
    'company.workspace_viewed',
    'content.scheduled',
    'access.reviewed',
    'content.updated',
  ][index],
  target_type: [
    'content',
    'content',
    'social_account',
    'company',
    'content',
    'membership',
    'content',
  ][index],
  target_id: `demo-target-${index + 1}`,
  company_id: company.id,
  company_name: company.name,
}));
