import { notFound, redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { screenForSegment } from '@/lib/workspace-routes';
import { DccWorkspace } from '../dcc-workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspaceRoute({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ companyId?: string }>;
}) {
  const [{ section }, { companyId }, me] = await Promise.all([params, searchParams, getMe()]);
  const initialScreen = screenForSegment(section);

  if (!initialScreen) notFound();
  if (!me) redirect('/');

  return <DccWorkspace me={me} initialScreen={initialScreen} initialCompanyId={companyId} />;
}
