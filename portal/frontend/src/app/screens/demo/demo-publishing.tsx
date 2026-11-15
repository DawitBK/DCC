'use client';

import { useEffect, useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { DEMO_COMPANIES, type DemoPost } from '@/lib/demo-data';
import { PLATFORM_NAMES, PostTable } from './demo-shared';

export function DemoPublishing({
  company,
  posts,
  onAction,
}: {
  company: string;
  posts: DemoPost[];
  onAction: () => void;
}) {
  const [filter, setFilter] = useState('All content');
  const [platform, setPlatform] = useState('All platforms');
  const [companyFilter, setCompanyFilter] = useState(company);
  const [date, setDate] = useState('');
  useEffect(() => setCompanyFilter(company), [company]);
  const groupView = company === 'All companies';
  const activeCompany = groupView ? companyFilter : company;
  const items = posts.filter(
    (post) =>
      (filter === 'All content' || post.status === filter) &&
      (platform === 'All platforms' || post.platforms.includes(platform)) &&
      (activeCompany === 'All companies' || post.company === activeCompany) &&
      (!date || post.date === date),
  );
  return (
    <>
      <PageTitle
        title="Publishing workspace"
        description={`Approved, scheduled and published content · ${company}`}
        action={
          <button className="btn btn-primary" onClick={onAction}>
            ＋ Schedule approved post
          </button>
        }
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label="Filter publishing status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option>All content</option>
          <option>Approved</option>
          <option>Scheduled</option>
          <option>Published</option>
        </select>
        <select
          className="select-field"
          aria-label="Filter by platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          <option>All platforms</option>
          {PLATFORM_NAMES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        {groupView && (
          <select
            className="select-field"
            aria-label="Filter by company"
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
          >
            {DEMO_COMPANIES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <input
          className="field"
          style={{ width: 190 }}
          type="date"
          aria-label="Filter by date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <SectionPanel
        title="Publishing queue"
        subtitle="Publishing states shown here use sample data"
      >
        <PostTable posts={items} />
        {items.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No matching sample content</strong>
              <p>Try changing or clearing one of the filters.</p>
            </div>
          </div>
        )}
      </SectionPanel>
      <div className="grid grid-3" style={{ marginTop: 18 }}>
        {[
          [
            'Approved and ready',
            String(
              posts.filter(
                (post) =>
                  post.status === 'Approved' &&
                  (activeCompany === 'All companies' || post.company === activeCompany),
              ).length,
            ),
            'Ready for a publisher to schedule',
          ],
          [
            'Scheduled',
            String(
              posts.filter(
                (post) =>
                  post.status === 'Scheduled' &&
                  (activeCompany === 'All companies' || post.company === activeCompany),
              ).length,
            ),
            'Planned in this workspace',
          ],
          [
            'Published this month',
            String(
              posts.filter(
                (post) =>
                  post.status === 'Published' &&
                  (activeCompany === 'All companies' || post.company === activeCompany),
              ).length,
            ),
            'Sample historical activity',
          ],
        ].map(([title, number, note]) => (
          <article className="stat-card" key={title}>
            <div className="stat-top">{title}</div>
            <div className="stat-value">{number}</div>
            <div className="stat-foot">{note}</div>
          </article>
        ))}
      </div>
    </>
  );
}
