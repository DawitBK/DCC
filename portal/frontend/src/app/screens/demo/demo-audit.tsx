'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { DEMO_AUDIT } from '@/lib/demo-data';

export function DemoAudit({ company }: { company: string }) {
  const [eventType, setEventType] = useState('All event types');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [checked, setChecked] = useState<number | null>(null);
  const filtered = DEMO_AUDIT.filter((event) => {
    const category = event.action.split('.')[0];
    const matchesType =
      eventType === 'All event types' ||
      (eventType === 'Access'
        ? category === 'access'
        : eventType === 'Security'
          ? category === 'security' || category === 'auth'
          : eventType === 'Company'
            ? category === 'company'
            : category === eventType.toLowerCase());
    const searchable =
      `${event.action} ${event.target_type} ${event.target_id} ${event.company_name} ${event.actor_user_id}`.toLowerCase();
    return (
      matchesType &&
      (company === 'All companies' || company === event.company_name) &&
      searchable.includes(search.toLowerCase()) &&
      (!date || event.occurred_at.slice(0, 10) === date)
    );
  });
  return (
    <>
      <PageTitle
        title="Activity audit"
        description="Review recorded activity and check the audit chain."
        action={
          <button className="btn btn-outline" onClick={() => setChecked(filtered.length)}>
            Check sample log
          </button>
        }
      />
      {checked !== null && (
        <div className="demo-banner" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Sample check complete</strong>
            Simulated result for {checked} sample entries; no audit endpoint was called.
          </div>
        </div>
      )}
      <div className="filter-row">
        <input
          className="field"
          type="date"
          aria-label="Filter audit by date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <select
          className="select-field"
          aria-label="Filter audit event type"
          value={eventType}
          onChange={(event) => setEventType(event.target.value)}
        >
          {['All event types', 'Company', 'Access', 'Security', 'Content', 'Account'].map(
            (item) => (
              <option key={item}>{item}</option>
            ),
          )}
        </select>
        <input
          className="field"
          placeholder="Search audit activity"
          aria-label="Search audit events"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <SectionPanel
        title="Activity log"
        subtitle={`${filtered.length} sample entries for ${company}`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Actor ID</th>
                <th>Company</th>
                <th>Time</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td>
                    <span className="post-title">
                      {event.action.replaceAll('.', ' ').replaceAll('_', ' ')}
                    </span>
                    <span className="subline">{event.id.slice(0, 8)}</span>
                  </td>
                  <td>{event.actor_user_id.slice(0, 8)}</td>
                  <td>{event.company_name}</td>
                  <td>{new Date(event.occurred_at).toLocaleString()}</td>
                  <td>
                    {event.target_type ?? '—'}
                    {event.target_id ? ` · ${event.target_id.slice(0, 8)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No matching audit events</strong>
              <p>Try changing or clearing a filter.</p>
            </div>
          </div>
        )}
      </SectionPanel>
      <small className="hint">All entries and checks are fictional local demo data.</small>
    </>
  );
}
