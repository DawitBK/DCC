'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { DEMO_ACCOUNTS, DEMO_COMPANIES, DEMO_COMPANY_CONFIG, DEMO_POSTS } from '@/lib/demo-data';

const PLATFORMS = ['Facebook', 'Instagram', 'LinkedIn', 'X', 'YouTube', 'TikTok'];
const TYPES = ['All content types', 'Image', 'Video', 'Carousel', 'Text'];
const RANGES = ['Last 7 days', 'Last 30 days', 'Last 90 days'];
const periodsByTrend: Record<string, string[]> = { Day: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], Week: ['W1','W2','W3','W4','W5','W6'], Month: ['Jun','Jul','Aug','Sep','Oct','Nov'] };

export function AnalyticsScreen({ company, isGroupAdmin }: { company: string; isGroupAdmin: boolean }) {
  const [companyFilter, setCompanyFilter] = useState(company);
  const [platform, setPlatform] = useState('All platforms');
  const [account, setAccount] = useState('All accounts');
  const [contentType, setContentType] = useState('All content types');
  const [range, setRange] = useState('Last 30 days');
  const [trend, setTrend] = useState('Day');
  useEffect(() => { setCompanyFilter(company); setAccount('All accounts'); }, [company]);

  const groupView = isGroupAdmin && company === 'All companies';
  const activeCompany = groupView ? companyFilter : company;
  const companyRecords = groupView ? DEMO_COMPANY_CONFIG : DEMO_COMPANY_CONFIG.filter((item) => item.name === activeCompany);
  const companyIndex = DEMO_COMPANY_CONFIG.findIndex((item) => item.name === activeCompany);
  const scale = (range === 'Last 7 days' ? 0.28 : range === 'Last 90 days' ? 2.45 : 1) * (platform === 'All platforms' ? 1 : 0.23) * (account === 'All accounts' ? 1 : 0.18) * (contentType === 'All content types' ? 1 : 0.42);
  const followers = Math.round((activeCompany === 'All companies' ? 682400 : 38400 + Math.max(0, companyIndex) * 12850) * (platform === 'All platforms' ? 1 : 0.31) * (account === 'All accounts' ? 1 : 0.22));
  const likes = Math.round((activeCompany === 'All companies' ? 184200 : 12400 + Math.max(0, companyIndex) * 3700) * scale);
  const comments = Math.round((activeCompany === 'All companies' ? 28300 : 1700 + Math.max(0, companyIndex) * 540) * scale);
  const shares = Math.round((activeCompany === 'All companies' ? 14600 : 980 + Math.max(0, companyIndex) * 340) * scale);
  const reach = Math.round((activeCompany === 'All companies' ? 4820000 : 338000 + Math.max(0, companyIndex) * 126000) * scale);
  const impressions = Math.round((activeCompany === 'All companies' ? 8930000 : 628000 + Math.max(0, companyIndex) * 235000) * scale);
  const engagement = (5.2 + (Math.max(0, companyIndex) % 5) * 0.46 + (platform === 'All platforms' ? 0 : 0.7)).toFixed(1);
  const accountRows = DEMO_ACCOUNTS.filter((item) => (activeCompany === 'All companies' || item.company === activeCompany) && (platform === 'All platforms' || item.platform === platform));
  const visibleAccounts = accountRows.length ? accountRows : DEMO_ACCOUNTS.filter((item) => platform === 'All platforms' || item.platform === platform).slice(0, 4);
  const periods = periodsByTrend[trend];
  const topContent = DEMO_POSTS.filter((post) => (activeCompany === 'All companies' || post.company === activeCompany) && (platform === 'All platforms' || post.platforms.includes(platform)) && (contentType === 'All content types' || (contentType === 'Video' ? post.platforms.includes('YouTube') : contentType === 'Image' ? post.platforms.includes('Instagram') : true)) && (account === 'All accounts' || DEMO_ACCOUNTS.some((item) => item.handle === account && item.company === post.company))).slice(0, 5);

  return <>
    <Header title={groupView ? 'Group analytics' : `${activeCompany} analytics`} description={groupView ? 'Compare engagement and audience performance across the Group portfolio.' : `Performance for ${activeCompany} only · sample analytics`} />
    <div className="demo-banner"><span aria-hidden="true">ⓘ</span><div><strong>MOCK ANALYTICS · Fictional values</strong>All figures, trends, accounts and campaign results are generated sample data until real analytics integrations are available.</div></div>
    <div className="filter-row analytics-filters">
      {groupView && <select className="select-field" aria-label="Filter analytics by company" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>{DEMO_COMPANIES.map((name) => <option key={name}>{name}</option>)}</select>}
      <select className="select-field" aria-label="Filter analytics by platform" value={platform} onChange={(event) => setPlatform(event.target.value)}><option>All platforms</option>{PLATFORMS.map((name) => <option key={name}>{name}</option>)}</select>
      <select className="select-field" aria-label="Filter analytics by social account" value={account} onChange={(event) => setAccount(event.target.value)}><option>All accounts</option>{visibleAccounts.map((item) => <option key={item.handle} value={item.handle}>{item.name}</option>)}</select>
      <select className="select-field" aria-label="Filter analytics by content type" value={contentType} onChange={(event) => setContentType(event.target.value)}>{TYPES.map((item) => <option key={item}>{item}</option>)}</select>
      <select className="select-field" aria-label="Analytics date range" value={range} onChange={(event) => setRange(event.target.value)}>{RANGES.map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    <div className="grid grid-4" style={{ marginBottom: 18 }}>
      <Metric label="Total followers" value={followers.toLocaleString()} change="4.8% ↑" icon="◎"/><Metric label="Likes" value={likes.toLocaleString()} change="8.2% ↑" icon="♡"/><Metric label="Comments" value={comments.toLocaleString()} change="3.1% ↑" icon="◯"/><Metric label="Shares" value={shares.toLocaleString()} change="6.4% ↑" icon="↗"/>
    </div>
    <div className="grid grid-3" style={{ marginBottom: 18 }}><Metric label="Engagement rate" value={`${engagement}%`} change="0.6% ↑" icon="✳"/><Metric label="Reach" value={reach.toLocaleString()} change="11.2% ↑" icon="◉"/><Metric label="Impressions" value={impressions.toLocaleString()} change="9.6% ↑" icon="▤"/></div>
    <div className="grid grid-2" style={{ marginBottom: 18 }}>
      <Panel title="Engagement trend" subtitle={`${trend} view · ${range.toLowerCase()}`}><div className="calendar-toolbar"><span className="hint">Likes and comments over time</span><div className="heading-actions">{['Day','Week','Month'].map((item) => <button key={item} className={`btn ${trend === item ? 'btn-dark' : 'btn-outline'}`} aria-pressed={trend === item} onClick={() => setTrend(item)}>{item}</button>)}</div></div><div className="bar-chart" role="img" aria-label={`${trend} sample engagement trend`}>{periods.map((period, index) => <div className="bar-group" key={period}><i className="bar" style={{ height: `${38 + ((index * 17 + Math.max(0, companyIndex) * 9) % 75)}px` }}/><i className="bar secondary" style={{ height: `${28 + ((index * 13 + 21) % 58)}px` }}/></div>)}</div><div className="chart-labels">{periods.map((period) => <span key={period}>{period}</span>)}</div><div className="legend"><span><i/>Likes</span><span><i className="gold"/>Comments</span></div></Panel>
      <Panel title="Performance by platform" subtitle="Engagement rate · sample comparison">{PLATFORMS.map((name, index) => <div key={name} style={{ marginBottom: 14 }}><RowLabel label={name} value={`${(4.1 + ((index + Math.max(0, companyIndex)) % 5) * 0.83).toFixed(1)}%`}/><div className="progress-track"><div className="progress-fill" style={{ width: `${35 + ((index * 11 + 25) % 60)}%` }}/></div></div>)}</Panel>
    </div>
    {groupView && <Panel title="Performance by company" subtitle="Compare sample audience size and engagement across the Group"><div className="table-wrap"><table><thead><tr><th>Company / institution</th><th>Followers</th><th>Engagement</th><th>Reach</th><th>Trend</th></tr></thead><tbody>{companyRecords.map((item, index) => <tr key={item.id}><td><span className="account-icon" style={{ backgroundColor: `${item.accent}20`, color: item.accent }}>{item.name.slice(0,1)}</span>{item.name}</td><td>{(38400 + index * 12850).toLocaleString()}</td><td>{(5.2 + (index % 5) * 0.46).toFixed(1)}%</td><td>{(338000 + index * 126000).toLocaleString()}</td><td><span className="positive">↑ {(2.8 + index * 0.54).toFixed(1)}%</span></td></tr>)}</tbody></table></div><small className="hint">Fictional values only. Company names are configurable examples, not a final legal entity list.</small></Panel>}
    <div className="grid grid-2" style={{ marginTop: 18 }}>
      <Panel title="Performance by social account" subtitle={`${activeCompany} · sample accounts`}><div className="table-wrap"><table><thead><tr><th>Account</th><th>Platform</th><th>Followers</th><th>Engagement</th></tr></thead><tbody>{visibleAccounts.filter((item) => account === 'All accounts' || item.handle === account).map((item, index) => <tr key={item.handle}><td>{item.name}<span className="subline">{item.handle}</span></td><td>{item.platform}</td><td>{(8200 + index * 4730).toLocaleString()}</td><td>{(4.6 + index * 0.53).toFixed(1)}%</td></tr>)}</tbody></table></div></Panel>
      <Panel title="Content type comparison" subtitle="Average sample engagement by format">{[['Image','6.8%','82%'],['Video','7.9%','92%'],['Carousel','6.1%','74%'],['Text','4.3%','55%']].map(([name,value,width]) => <div key={name} style={{ marginBottom: 15 }}><RowLabel label={name} value={value}/><div className="progress-track"><div className="progress-fill" style={{ width }}/></div></div>)}</Panel>
    </div>
    <div className="grid grid-2" style={{ marginTop: 18 }}>
      <Panel title="Top-performing content" subtitle={`${activeCompany} · ranked by sample engagement`}><div className="table-wrap"><table><thead><tr><th>Content</th><th>Company</th><th>Engagement</th><th>Reach</th></tr></thead><tbody>{topContent.map((post, index) => <tr key={post.id}><td><span className="post-title">{post.title}</span><span className="subline">{post.platforms.join(' · ')}</span></td><td>{post.company}</td><td>{(9.2 - index * 0.8).toFixed(1)}%</td><td>{(38400 - index * 5200).toLocaleString()}</td></tr>)}</tbody></table></div>{topContent.length === 0 && <div className="empty-state"><div><strong>No matching sample content</strong><p>Change the filters to see another sample.</p></div></div>}</Panel>
      <Panel title="Campaign performance" subtitle="Sample campaign comparison"><div className="activity-list">{[['Community stories','7.8%','86%'],['Seasonal updates','6.4%','70%'],['Team highlights','5.9%','64%'],['Product education','5.2%','57%']].map(([name,value,width]) => <div key={name} style={{ marginBottom: 13 }}><RowLabel label={name} value={value}/><div className="progress-track"><div className="progress-fill" style={{ width }}/></div></div>)}</div></Panel>
    </div>
  </>;
}

function Header({ title, description }: { title: string; description: string }) { return <div className="page-heading"><div><p className="eyebrow">Analytics · mock data</p><h1>{title}</h1><p>{description}</p></div></div>; }
function Metric({ label, value, change, icon }: { label: string; value: string; change: string; icon: string }) { return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon" aria-hidden="true">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot"><span className="positive">{change}</span> sample trend</div></article>; }
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) { return <section className="panel"><div className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>; }
function RowLabel({ label, value }: { label: string; value: string }) { return <div className="analytics-row-label"><span>{label}</span><strong>{value}</strong></div>; }
