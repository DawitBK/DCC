'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { COMPANY_ONLY_ROLES, ROLE_LABELS, ROLES, permissionsForRole, type MeResponse, type Role } from '@dcc/contracts';
import { DccWorkspace } from './dcc-workspace';
import { DEMO_COMPANY_CONFIG } from '@/lib/demo-data';

export function RolePreview() {
  const [open, setOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>('group_admin');
  const [companyId, setCompanyId] = useState<string>(DEMO_COMPANY_CONFIG[0].id);
  const [auditorScope, setAuditorScope] = useState<'company' | 'group'>('company');

  if (process.env.NODE_ENV === 'production') return null;

  if (activeRole) {
    const company = DEMO_COMPANY_CONFIG.find((item) => item.id === companyId) ?? DEMO_COMPANY_CONFIG[0];
    const groupScoped = activeRole === 'auditor' ? auditorScope === 'group' : !COMPANY_ONLY_ROLES.includes(activeRole as (typeof COMPANY_ONLY_ROLES)[number]);
    const preview: MeResponse = {
      user: { id: `demo-user-${activeRole}`, email: `preview+${activeRole}@dcc.demo`, displayName: `${ROLE_LABELS[activeRole]} Preview` },
      memberships: [{ role: activeRole, companyId: groupScoped ? null : company.id, groupId: 'demo-group' }],
      permissions: [...permissionsForRole(activeRole)],
    };
    return createPortal(<div className="preview-app-overlay"><DccWorkspace me={preview} demoMode initialCompanyName={groupScoped ? 'All companies' : company.name} onSwitchPreviewRole={() => { setSelectedRole(activeRole); setActiveRole(null); setOpen(true); }} onExitPreview={() => { setActiveRole(null); setOpen(false); }} /></div>, document.body);
  }

  return <>
    <button className="btn btn-outline demo-entry" onClick={() => setOpen(true)}>Preview Frontend as Any Role</button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="modal role-preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <div className="demo-preview-kicker"><span aria-hidden="true">◉</span> FRONTEND DEMO · NO SIGN-IN</div>
        <h2 id="preview-title">Choose a role to preview</h2>
        <p>This changes only local demo state. It does not sign you in, create a session or call DCC APIs.</p>
        <div className="field-group"><label className="label" htmlFor="preview-role">DCC role</label><select id="preview-role" className="select-field" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as Role)}>{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></div>
        {selectedRole === 'auditor' && <div className="field-group"><label className="label" htmlFor="auditor-scope">Auditor scope</label><select id="auditor-scope" className="select-field" value={auditorScope} onChange={(event) => setAuditorScope(event.target.value as 'company' | 'group')}><option value="company">Single sample company</option><option value="group">Whole group</option></select></div>}
        <div className="field-group"><label className="label" htmlFor="preview-company">Sample company workspace</label><select id="preview-company" className="select-field" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{DEMO_COMPANY_CONFIG.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small className="hint">These configurable examples are not the final legal company list.</small></div>
        <div className="modal-actions"><button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => { setActiveRole(selectedRole); setOpen(false); }}>Preview selected role</button></div>
      </section>
    </div>}
  </>;
}
