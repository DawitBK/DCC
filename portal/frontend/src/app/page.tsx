import { getMe } from '@/lib/api';
import { redirect } from 'next/navigation';
import { RolePreview } from './role-preview';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; companyId?: string }>;
}) {
  const me = await getMe();
  const { error, companyId } = await searchParams;

  if (me) {
    const basePath = process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? '';
    const companyQuery = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    redirect(`${basePath}/dashboard${companyQuery}`);
  }

  const basePath = process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? '';
  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand-lockup">
          <span className="brand-mark">DCC</span>
          <span>Kerchanshe Group</span>
        </div>
        <div className="login-brand-copy">
          <p className="eyebrow">Digital communications control center</p>
          <h1>Clear governance for every conversation.</h1>
          <p>
            Plan, review and oversee the Group’s social communications in one trusted workspace.
          </p>
          <div className="login-feature-list">
            <div>
              <span>01</span>
              <div>
                <strong>One shared workspace</strong>
                <small>Company and brand activity together</small>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <strong>Thoughtful approvals</strong>
                <small>Every post follows its review path</small>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <strong>Accountable publishing</strong>
                <small>Actions recorded for clear oversight</small>
              </div>
            </div>
          </div>
        </div>
        <small className="login-footer">Kerchanshe Group · Internal communications platform</small>
      </section>
      <section className="login-form-panel">
        <div className="login-card">
          <div className="login-mini-brand">
            <span className="brand-mark">DCC</span>
            <span>Welcome to DCC</span>
          </div>
          <p className="eyebrow">Secure workspace</p>
          <h2>Sign in to continue</h2>
          <p className="login-explainer">
            Use your existing Kerchanshe account. DCC will redirect you to the company sign-in
            service.
          </p>
          {error && (
            <p className="login-error" role="alert">
              Sign-in could not be completed. Please try again.
            </p>
          )}
          <a className="btn btn-primary login-submit" href={`${basePath}/api/auth/login`}>
            Continue with Kerchanshe SSO <span aria-hidden="true">→</span>
          </a>
          <p className="login-security">
            <span aria-hidden="true">▣</span> Protected by Kerchanshe single sign-on and
            multi-factor authentication.
          </p>
          {process.env.NODE_ENV !== 'production' && <RolePreview />}
          <small className="login-help">Need access? Contact your DCC administrator.</small>
        </div>
      </section>
    </main>
  );
}
