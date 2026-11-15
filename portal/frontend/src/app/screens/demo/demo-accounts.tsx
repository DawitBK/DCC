'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { useToast } from '@/components/toast';
import { DEMO_ACCOUNTS } from '@/lib/demo-data';
import { DemoStatusChip, PLATFORM_NAMES } from './demo-shared';

export function DemoAccounts({ company }: { company: string }) {
  const showToast = useToast();
  const [filter, setFilter] = useState('All platforms');
  const [query, setQuery] = useState('');
  const rows = DEMO_ACCOUNTS.map((account) => ({ ...account, key: account.handle }));
  const scopedAccounts = rows.filter(
    (account) => company === 'All companies' || account.company === company,
  );
  const accounts = rows.filter(
    (account) =>
      (company === 'All companies' || account.company === company) &&
      (filter === 'All platforms' || account.platform === filter) &&
      `${account.name} ${account.handle} ${account.company}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const connectedCount = scopedAccounts.filter(
    (item) => item.status === 'Active' || item.status === 'Connected',
  ).length;
  const attentionCount = scopedAccounts.filter(
    (item) => item.status.toLowerCase() === 'needs attention',
  ).length;
  return (
    <>
      <PageTitle
        title="Social accounts"
        description={`Review account ownership and connection health · ${company}. Connections are managed through the approved engine workflow.`}
        action={
          <button
            className="btn btn-outline"
            onClick={() =>
              showToast('Account connections are managed through the approved engine workflow.')
            }
          >
            Connection guidance
          </button>
        }
      />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label="Accounts in view"
          value={String(scopedAccounts.length)}
          change="Sample placeholders"
          icon="◎"
        />
        <StatCard
          label="Connected"
          value={String(connectedCount)}
          change="No verified connection status"
          icon="✓"
        />
        <StatCard
          label="Needs attention"
          value={String(attentionCount)}
          change="No verified connection status"
          icon="!"
        />
      </div>
      <div className="filter-row">
        <select
          className="select-field"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter accounts by platform"
        >
          <option>All platforms</option>
          {PLATFORM_NAMES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <input
          className="field"
          style={{ maxWidth: 230 }}
          placeholder="Search accounts"
          aria-label="Search accounts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <SectionPanel
        title="Account registry"
        subtitle="Mock placeholders only · no real connected handles"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Company / brand</th>
                <th>Owner</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.key}>
                  <td>
                    <span className="account-icon">
                      {account.platform.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="post-title">{account.name}</span>
                    <span className="subline">
                      {account.platform} · {account.handle}
                    </span>
                  </td>
                  <td>
                    {account.company}
                    <span className="subline">{account.brand}</span>
                  </td>
                  <td>{account.owner}</td>
                  <td>
                    <DemoStatusChip value={account.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No matching accounts</strong>
              <p>Try another search or platform filter.</p>
            </div>
          </div>
        )}
      </SectionPanel>
      <small className="hint">
        Mock rows are placeholders, not real social profiles. Live connections and statuses appear
        only when returned by the read-only API.
      </small>
    </>
  );
}
