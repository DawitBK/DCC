import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';

export function DemoInbox() {
  return (
    <>
      <PageTitle
        title="Unified inbox"
        description="A shared queue for social conversations across connected company accounts."
      />
      <SectionPanel
        title="Inbox integration"
        subtitle="Unified inbox is not connected in this DCC frontend yet"
      >
        <div className="empty-state">
          <div>
            <strong>Conversation management is coming soon</strong>
            <p>
              When the approved inbox integration is available, this page will show messages grouped
              by company and social account.
            </p>
          </div>
        </div>
      </SectionPanel>
      <small className="hint">No social messages are fetched or displayed here.</small>
    </>
  );
}
