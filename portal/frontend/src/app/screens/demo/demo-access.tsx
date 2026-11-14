'use client';

import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { useToast } from '@/components/toast';
import { DEMO_PEOPLE } from '@/lib/demo-data';
import { initials } from '@/lib/format';
import { DemoStatusChip } from './demo-shared';

export function DemoAccess({ company }: { company: string }) {
  const showToast = useToast();
  const people = DEMO_PEOPLE.filter(
    (person) => company === 'All companies' || person.company === company,
  );
  return (
    <>
      <PageTitle
        title="Access governance"
        description={`Review team roles for ${company}. The API remains the authority for access decisions.`}
        action={
          <button
            className="btn btn-outline"
            onClick={() => showToast('Role assignments are not changed in this preview.')}
          >
            Role management guidance
          </button>
        }
      />
      <div className="demo-banner">
        <span aria-hidden="true">ⓘ</span>
        <div>
          Role labels come from the shared DCC contracts. Memberships and activity on this screen
          are fictional sample data.
        </div>
      </div>
      <SectionPanel
        title="Team access"
        subtitle={`${people.length} sample team members · ${company}`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team member</th>
                <th>Role</th>
                <th>Company scope</th>
                <th>Recent activity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.name}>
                  <td>
                    <span
                      className="user-avatar"
                      style={{
                        display: 'inline-grid',
                        width: 29,
                        height: 29,
                        marginRight: 8,
                        verticalAlign: 'middle',
                        fontSize: 10,
                      }}
                    >
                      {initials(person.name)}
                    </span>
                    {person.name}
                  </td>
                  <td>{person.role}</td>
                  <td>{person.company}</td>
                  <td>{person.activity}</td>
                  <td>
                    <DemoStatusChip value="Active" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {people.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No sample team members</strong>
              <p>There are no demo membership records for this workspace yet.</p>
            </div>
          </div>
        )}
      </SectionPanel>
    </>
  );
}
