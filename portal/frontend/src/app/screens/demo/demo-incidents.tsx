'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { useToast } from '@/components/toast';
import { DEMO_COMPANY_CONFIG } from '@/lib/demo-data';
import { DemoStatusChip } from './demo-shared';

export function DemoIncidents() {
  const showToast = useToast();
  const [filter, setFilter] = useState('All incidents');
  const rows = [
    [
      'INC-204',
      'Sample account placeholder needs review',
      DEMO_COMPANY_CONFIG[0].name,
      'Medium',
      'Open',
      'Today · 08:10',
    ],
    [
      'INC-203',
      'Sample schedule window missed',
      DEMO_COMPANY_CONFIG[7].name,
      'High',
      'Investigating',
      'Nov 10 · 14:26',
    ],
    [
      'INC-202',
      'Sample access review due',
      DEMO_COMPANY_CONFIG[8].name,
      'Low',
      'Resolved',
      'Nov 8 · 09:42',
    ],
  ];
  const visible = rows.filter((row) => filter === 'All incidents' || row[4] === filter);
  return (
    <>
      <PageTitle
        title="Incidents"
        description="Track communication workflow issues and their response status."
        action={
          <button
            className="btn btn-primary"
            onClick={() => showToast('Demo only: incident creation is not connected.')}
          >
            ＋ Report incident
          </button>
        }
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label="Filter incidents"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option>All incidents</option>
          <option>Open</option>
          <option>Investigating</option>
          <option>Resolved</option>
        </select>
        <select className="select-field" aria-label="Filter incident priority">
          <option>All priorities</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
      </div>
      <SectionPanel
        title="Incident register"
        subtitle="Fictional sample incidents for the demo workspace"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Incident</th>
                <th>Company</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row[0]}>
                  {row.map((value, index) => (
                    <td key={`${row[0]}-${index}`}>
                      {index === 3 || index === 4 ? <DemoStatusChip value={value} /> : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionPanel>
    </>
  );
}
