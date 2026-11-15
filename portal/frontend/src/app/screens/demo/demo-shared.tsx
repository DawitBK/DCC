import type { DemoPost, DemoStatus } from '@/lib/demo-data';

const STATUS_CLASS: Record<DemoStatus | string, string> = {
  'Needs review': 'status-amber',
  'Changes requested': 'status-red',
  Approved: 'status-green',
  Scheduled: 'status-blue',
  Published: 'status-green',
  Draft: 'status-gray',
  Connected: 'status-green',
  'Needs attention': 'status-amber',
  Disconnected: 'status-red',
  Active: 'status-green',
  High: 'status-red',
  Medium: 'status-amber',
  Low: 'status-blue',
  Open: 'status-red',
  Investigating: 'status-amber',
  Resolved: 'status-green',
};
export const PLATFORM_NAMES = ['Facebook', 'Instagram', 'LinkedIn', 'X', 'YouTube', 'TikTok'];

export function DemoStatusChip({ value }: { value: string }) {
  return <span className={`status ${STATUS_CLASS[value] ?? 'status-gray'}`}>{value}</span>;
}

export function Chart() {
  return (
    <>
      <div
        className="bar-chart"
        role="img"
        aria-label="Sample engagement chart: weekly reach and interactions trending upward over the last six weeks"
      >
        {[
          [35, 25],
          [48, 36],
          [42, 31],
          [65, 43],
          [58, 50],
          [78, 60],
          [72, 68],
          [92, 76],
          [84, 68],
          [100, 82],
          [88, 78],
          [110, 90],
        ].map(([a, b], index) => (
          <div className="bar-group" key={index}>
            <i className="bar" style={{ height: `${a}px` }} />
            <i className="bar secondary" style={{ height: `${b}px` }} />
          </div>
        ))}
      </div>
      <div className="chart-labels">
        <span>Oct 1</span>
        <span>Oct 8</span>
        <span>Oct 15</span>
        <span>Oct 22</span>
        <span>Oct 29</span>
        <span>Nov 5</span>
      </div>
      <div className="legend">
        <span>
          <i />
          Reach
        </span>
        <span>
          <i className="gold" />
          Interactions
        </span>
      </div>
    </>
  );
}

export function PostTable({ posts, compact = false }: { posts: DemoPost[]; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Content</th>
            <th>Status</th>
            {!compact && <th>Company</th>}
            <th>{compact ? 'Date' : 'Channels'}</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <span className="post-title">{post.title}</span>
                <span className="subline">
                  {post.id} · {post.creator}
                </span>
              </td>
              <td>
                <DemoStatusChip value={post.status} />
              </td>
              {!compact && <td>{post.company}</td>}
              <td>
                {compact ? `${post.date.slice(5)} · ${post.time}` : post.platforms.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
