'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import type { DemoPost, DemoStatus } from '@/lib/demo-data';
import { initials } from '@/lib/format';
import { DemoStatusChip } from './demo-shared';

export function DemoApprovals({
  company,
  posts,
  update,
}: {
  company: string;
  posts: DemoPost[];
  update: (id: string, status: DemoStatus) => void;
}) {
  const [activeId, setActiveId] = useState(
    posts.find((post) => post.status === 'Needs review')?.id ?? '',
  );
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('Needs review');
  const visible = posts.filter(
    (post) =>
      (company === 'All companies' || post.company === company) &&
      (filter === 'All statuses' || post.status === filter),
  );
  const selected = visible.find((post) => post.id === activeId) ?? visible[0];
  return (
    <>
      <PageTitle
        title="Review & approvals"
        description="Review submitted content, leave clear feedback, and record the decision."
        action={<span className="status status-amber">Separation of duties enforced by DCC</span>}
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label="Filter approvals"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option>Needs review</option>
          <option>Changes requested</option>
          <option>Approved</option>
          <option>All statuses</option>
        </select>
        <span className="status status-gray">{visible.length} sample items</span>
      </div>
      <div className="grid grid-2">
        <SectionPanel title="Review queue" subtitle="Choose an item to inspect">
          {visible.length ? (
            <div className="activity-list">
              {visible.map((post) => (
                <button
                  key={post.id}
                  className="activity-row"
                  style={{
                    width: '100%',
                    border: 0,
                    borderBottom: '1px solid #eff2f5',
                    background: activeId === post.id ? '#f2f8f8' : 'white',
                    textAlign: 'left',
                  }}
                  onClick={() => setActiveId(post.id)}
                >
                  <span className="activity-dot" />
                  <span className="activity-copy" style={{ flex: 1 }}>
                    <strong>{post.title}</strong>
                    <small>
                      {post.creator} · {post.company} · {post.date}
                    </small>
                  </span>
                  <DemoStatusChip value={post.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <strong>Nothing in this view</strong>
                <p>New submissions will appear here.</p>
              </div>
            </div>
          )}
        </SectionPanel>
        <SectionPanel
          title={selected?.title ?? 'Select content'}
          subtitle={
            selected
              ? `${selected.id} · submitted by ${selected.creator}`
              : 'Post details and review history'
          }
        >
          {selected ? (
            <>
              <div className="preview-card" style={{ marginBottom: 14 }}>
                <div className="preview-head">
                  <div className="preview-avatar">{initials(selected.creator)}</div>
                  <div>
                    <strong>{selected.company}</strong>
                    <small>{selected.platforms.join(' · ')}</small>
                  </div>
                </div>
                <div className="preview-image">Sample post media preview</div>
                <div className="preview-body">{selected.caption}</div>
              </div>
              <div className="grid grid-2" style={{ marginBottom: 13 }}>
                <div>
                  <small className="hint">CREATOR</small>
                  <strong style={{ display: 'block', fontSize: 12 }}>{selected.creator}</strong>
                </div>
                <div>
                  <small className="hint">SUBMITTED</small>
                  <strong style={{ display: 'block', fontSize: 12 }}>
                    {selected.date} · {selected.time}
                  </strong>
                </div>
              </div>
              <label className="label" htmlFor="review-comment">
                Review comment
              </label>
              <textarea
                id="review-comment"
                className="textarea-field"
                style={{ minHeight: 80 }}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Share specific, helpful feedback…"
              />
              <div className="heading-actions" style={{ marginTop: 13 }}>
                <button
                  className="btn btn-outline"
                  onClick={() => update(selected.id, 'Changes requested')}
                >
                  ↩ Request changes
                </button>
                <button className="btn btn-danger" onClick={() => update(selected.id, 'Draft')}>
                  Reject
                </button>
                <button className="btn btn-primary" onClick={() => update(selected.id, 'Approved')}>
                  Approve
                </button>
              </div>
              <small className="hint">
                Demo only: decisions update sample status in this page and are not recorded by DCC.
              </small>
            </>
          ) : (
            <div className="empty-state">
              <div>
                <strong>No item selected</strong>
                <p>Select a post from the queue to review it.</p>
              </div>
            </div>
          )}
        </SectionPanel>
      </div>
    </>
  );
}
