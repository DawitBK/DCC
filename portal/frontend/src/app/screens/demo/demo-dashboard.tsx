import type { MeResponse } from '@dcc/contracts';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { DEMO_ACTIVITY, DEMO_COMPANY_CONFIG, type DemoPost } from '@/lib/demo-data';
import type { WorkspaceScreen } from '@/lib/workspace-routes';
import { Chart, PostTable } from './demo-shared';

type Screen = WorkspaceScreen;

export function DemoDashboard({
  me,
  company,
  posts,
  go,
}: {
  me: MeResponse;
  company: string;
  posts: DemoPost[];
  go: (screen: Screen) => void;
}) {
  const primaryRole = me.memberships[0]?.role;
  const groupAdmin = primaryRole === 'group_admin';
  const isCreator = primaryRole === 'content_creator';
  const isReviewer = primaryRole === 'content_reviewer';
  const companyIndex = DEMO_COMPANY_CONFIG.findIndex((item) => item.name === company);
  const workspacePosts = posts.filter(
    (post) => company === 'All companies' || post.company === company,
  );
  const countScale =
    company === 'All companies' ? 1 : 0.12 + (Math.max(companyIndex, 0) % 5) * 0.07;
  const title = isCreator
    ? 'Your drafts and ideas'
    : isReviewer
      ? 'Reviews waiting for you'
      : primaryRole === 'publisher'
        ? 'Approved content ready to publish'
        : primaryRole === 'auditor'
          ? 'Governance overview'
          : primaryRole === 'group_cto' || primaryRole === 'security_admin'
            ? 'Security and governance overview'
            : groupAdmin
              ? company === 'All companies'
                ? 'Group communications overview'
                : `${company} workspace overview`
              : primaryRole === 'company_admin'
                ? `${company} workspace overview`
                : `Good morning, ${(me.user.displayName || 'there').split(' ')[0]}`;
  const description = isCreator
    ? 'Pick up a draft or start a new piece of content.'
    : isReviewer
      ? 'Review submitted content and help your team move forward.'
      : primaryRole === 'publisher'
        ? 'See approved posts and upcoming sample publishing activity.'
        : primaryRole === 'auditor'
          ? 'Review activity, account health and available governance records.'
          : groupAdmin && company === 'All companies'
            ? 'Compare communications activity across the configurable Group portfolio.'
            : `A company-level view of ${company} content, channels and team activity.`;
  const tablePosts = workspacePosts.slice(0, 4);
  const totalPosts = Math.round(128 * countScale);
  const publishedPosts = Math.round(96 * countScale);
  const scheduledPosts = Math.max(
    1,
    workspacePosts.filter((post) => post.status === 'Scheduled').length,
  );
  const pendingPosts = workspacePosts.filter((post) => post.status === 'Needs review').length;
  const activity =
    company === 'All companies'
      ? DEMO_ACTIVITY
      : [
          {
            person: `Sample team · ${company}`,
            action: 'updated company content and account planning',
            time: 'Today',
          },
        ];
  return (
    <>
      <PageTitle
        title={title}
        description={`${description} · ${company}`}
        action={
          <>
            <button className="btn btn-outline" onClick={() => go('calendar')}>
              View calendar
            </button>
            {me.permissions.includes('content.create') && (
              <button className="btn btn-primary" onClick={() => go('composer')}>
                ＋ Create content
              </button>
            )}
          </>
        }
      />
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <StatCard
          label="Total posts"
          value={String(totalPosts)}
          change={company === 'All companies' ? 'Across the Group' : company}
          icon="▤"
        />
        <StatCard
          label="Published"
          value={String(publishedPosts)}
          change="Sample performance"
          icon="↗"
        />
        <StatCard
          label="Scheduled"
          value={String(company === 'All companies' ? 18 : scheduledPosts)}
          change="Upcoming content"
          icon="◷"
        />
        <StatCard
          label="Pending approvals"
          value={String(company === 'All companies' ? 13 : pendingPosts)}
          change="Needs attention"
          icon="✓"
        />
      </div>
      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <SectionPanel
          title="Content performance"
          subtitle="Engagement across channels · last 30 days"
          action={
            <button className="text-link" onClick={() => go('analytics')}>
              Full report →
            </button>
          }
        >
          <Chart />
        </SectionPanel>
        <SectionPanel
          title="Recent team activity"
          subtitle={company === 'All companies' ? 'Across all sample workspaces' : `In ${company}`}
        >
          <div className="activity-list">
            {activity.map((entry) => (
              <div className="activity-row" key={entry.person + entry.time}>
                <span className="activity-dot" />
                <div className="activity-copy">
                  <strong>{entry.person}</strong> {entry.action}
                  <small>{entry.time}</small>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
      <div className="grid grid-2">
        <SectionPanel
          title={
            isCreator ? 'My recent drafts' : isReviewer ? 'Waiting for review' : 'Recent content'
          }
          action={
            <button
              className="text-link"
              onClick={() => go(isReviewer ? 'approvals' : 'publishing')}
            >
              View all →
            </button>
          }
        >
          {tablePosts.length ? (
            <PostTable posts={tablePosts} compact />
          ) : (
            <div className="empty-state">
              <div>
                <strong>No sample content yet</strong>
                <p>Content for {company} will appear here.</p>
              </div>
            </div>
          )}
        </SectionPanel>
        <SectionPanel
          title="Upcoming schedule"
          subtitle={`Next posts planned for ${company}`}
          action={
            <button className="text-link" onClick={() => go('calendar')}>
              Open calendar →
            </button>
          }
        >
          <div className="activity-list">
            {workspacePosts
              .filter((post) => post.status === 'Scheduled' || post.status === 'Approved')
              .slice(0, 3)
              .map((post) => (
                <div className="activity-row" key={post.id}>
                  <span className="activity-dot" />
                  <div className="activity-copy">
                    <strong>{post.title}</strong>
                    <span> · {post.platforms.join(', ')}</span>
                    <small>
                      {post.company} · {post.date} at {post.time}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        </SectionPanel>
      </div>
      {groupAdmin && company === 'All companies' && (
        <div style={{ marginTop: 18 }}>
          <SectionPanel
            title="Portfolio performance by company"
            subtitle="Sample comparison · select a workspace from the company switcher to focus its dashboard"
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company / institution</th>
                    <th>Followers</th>
                    <th>Engagement rate</th>
                    <th>Published posts</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_COMPANY_CONFIG.map((item, index) => (
                    <tr key={item.id}>
                      <td>
                        <span
                          className="account-icon"
                          style={{ backgroundColor: `${item.accent}20`, color: item.accent }}
                        >
                          {item.name.slice(0, 1)}
                        </span>
                        {item.name}
                      </td>
                      <td>{(12800 + index * 7350).toLocaleString()}</td>
                      <td>{(4.8 + (index % 5) * 0.7).toFixed(1)}%</td>
                      <td>{32 + index * 7}</td>
                      <td>
                        <span className="positive">↑ {(3.2 + index * 0.4).toFixed(1)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small className="hint">
              Fictional demo metrics only. The listed company names are configurable examples, not a
              final legal entity list.
            </small>
          </SectionPanel>
        </div>
      )}
    </>
  );
}
