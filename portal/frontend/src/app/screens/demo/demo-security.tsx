'use client';

import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { useToast } from '@/components/toast';
import { DEMO_ACTIVITY } from '@/lib/demo-data';
import { DemoStatusChip } from './demo-shared';

export function DemoSecurity() {
  const showToast = useToast();
  return (
    <>
      <PageTitle
        title="Security center"
        description="A focused view of account connection health and governance signals."
        action={
          <button
            className="btn btn-outline"
            onClick={() => showToast('Demo only: security report is not exported.')}
          >
            Export summary
          </button>
        }
      />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard label="Account health" value="21 / 24" change="3 need attention" icon="◎" />
        <StatCard label="Review controls" value="Active" change="Approval required" icon="✓" />
        <StatCard label="Open incidents" value="2" change="1 high priority" icon="!" />
      </div>
      <div className="grid grid-2">
        <SectionPanel title="Governance signals" subtitle="Sample operational indicators">
          {[
            ['MFA required for DCC sign-in', 'Enforced by DCC / SSO', 'Connected'],
            ['Approval before publishing', 'Required by workflow', 'Connected'],
            ['Social account connection', '3 sample accounts need attention', 'Needs attention'],
            ['Audit history', 'Append-only audit trail', 'Connected'],
          ].map(([title, detail, status]) => (
            <div className="activity-row" key={title}>
              <span className="activity-dot" />
              <div className="activity-copy" style={{ flex: 1 }}>
                <strong>{title}</strong>
                <small>{detail}</small>
              </div>
              <DemoStatusChip value={status} />
            </div>
          ))}
        </SectionPanel>
        <SectionPanel title="Recent security activity" subtitle="Examples only">
          <div className="activity-list">
            {DEMO_ACTIVITY.slice(1).map((entry) => (
              <div className="activity-row" key={entry.action}>
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
      <small className="hint">
        This display does not inspect live security state or replace the backend security controls.
      </small>
    </>
  );
}
