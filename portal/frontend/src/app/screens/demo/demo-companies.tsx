'use client';

import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { useToast } from '@/components/toast';
import { DEMO_COMPANY_CONFIG } from '@/lib/demo-data';
import { DemoStatusChip } from './demo-shared';

export function DemoCompanies({ company }: { company: string }) {
  const showToast = useToast();
  const records = DEMO_COMPANY_CONFIG.filter(
    (item) => company === 'All companies' || item.name === company,
  ).map((item) => ({
    id: item.id,
    name: item.name,
    status: 'Sample only',
    brandNames: [] as string[],
  }));
  return () => {
      current = false;
    };
  }, [liveCompanies]);
  const records = liveCompanies
    ? liveCompanies
        .filter((item) => company === 'All companies' || item.name === company)
        .map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status[0].toUpperCase() + item.status.slice(1),
          brandNames: brands[item.id]?.map((brand) => brand.name) ?? [],
        }))
    : DEMO_COMPANY_CONFIG.filter(
        (item) => company === 'All companies' || item.name === company,
      ).map((item) => ({
        id: item.id,
        name: item.name,
        status: 'Sample only',
        brandNames: [] as string[],
      }));
  const brandCount = liveCompanies
    ? Object.values(brands).reduce((total, items) => total + items.length, 0)
    : null;
  return (
    <>
      <PageTitle
        title="Companies & brands"
        description="A clear view of company workspaces and the brands they manage."
        action={
          <button
            className="btn btn-outline"
            onClick={() =>
              showToast('Company creation and brand changes are not connected in this screen.')
            }
          >
            Management guidance
          </button>
        }
      />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label="Companies"
          value={String(DEMO_COMPANY_CONFIG.length)}
          change="Configurable sample workspaces"
          icon="⌂"
        />
        <StatCard
          label="Brands"
          value="Not configured"
          change="No sample brand names supplied"
          icon="◇"
        />
        <StatCard label="Social accounts" value="—" change="See account registry" icon="◎" />
      </div>
      <div className="grid grid-3">
        {records.map((item) => (
          <article key={item.id} className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="stat-icon">{item.name.slice(0, 1)}</div>
              <DemoStatusChip value={item.status} />
            </div>
            <h2 style={{ margin: '16px 0 5px', fontSize: 16 }}>{item.name}</h2>
            <p style={{ margin: 0, color: '#7a8997', fontSize: 12 }}>
              {item.brandNames.length
                ? `${item.brandNames.length} brands`
                : 'Brand names not configured'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
              {item.brandNames.map((brand) => (
                <span className="status status-gray" key={brand}>
                  {brand}
                </span>
              ))}
            </div>
            <span className="subline">
              Configurable sample workspace; legal status not verified
            </span>
          </article>
        ))}
      </div>
      {records.length === 0 && (
        <div className="empty-state">
          <div>
            <strong>No companies in this scope</strong>
            <p>There are no sample company workspaces for this selection.</p>
          </div>
        </div>
      )}
      <small className="hint">
        Mock workspaces show no claimed brands or connected accounts.
      </small>
    </>
  );
}
