import { ROLE_LABELS } from '@dcc/contracts';
import { getMe } from '@/lib/api';
import { SignOutButton } from './sign-out-button';

// Always evaluated per request: the page depends on the caller's session cookie.
export const dynamic = 'force-dynamic';

/**
 * SCAFFOLD ONLY. This proves the chain browser -> web -> API -> existing SSO works. The real dashboard,
 * navigation and screens are Rahel's work (docs/design/, docs/team/RAHEL-ONBOARDING.md).
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getMe();
  const { error } = await searchParams;

  if (!me) {
    return (
      <section className="mt-16 rounded-lg bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold">Digital Communications Control Center</h1>
        <p className="mt-2">Sign in with your Kerchanshe account to continue.</p>
        {error ? (
          <p role="alert" className="mt-4 rounded bg-alert/10 p-3 text-alert">
            Sign-in could not be completed. Please try again.
          </p>
        ) : null}
        <a
          href={`${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/api/auth/login`}
          className="mt-6 inline-block rounded bg-gold px-5 py-2 font-medium text-navy hover:opacity-90"
        >
          Sign in with Kerchanshe SSO
        </a>
      </section>
    );
  }

  return (
    <section className="mt-16 rounded-lg bg-white p-8 shadow">
      <h1 className="text-2xl font-semibold">Hello, {me.user.displayName || me.user.email}</h1>
      {me.memberships.length === 0 ? (
        <p className="mt-2">
          You are signed in, but a DCC administrator has not given you a role yet.
        </p>
      ) : (
        <ul className="mt-3 list-disc pl-6">
          {me.memberships.map((m) => (
            <li key={`${m.role}-${m.companyId ?? 'group'}`}>
              {ROLE_LABELS[m.role]} ({m.companyId ? 'one company' : 'whole group'})
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6">
        <SignOutButton />
      </div>
    </section>
  );
}
