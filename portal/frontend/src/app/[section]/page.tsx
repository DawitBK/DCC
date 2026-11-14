import { notFound, redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { screenForSegment } from '@/lib/workspace-routes';
import { DccWorkspace } from '../dcc-workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspaceRoute({ params }: { params: Promise<{ section: string }> }) {
  const [{ section }, me] = await Promise.all([params, getMe()]);
  const initialScreen = screenForSegment(section);

  if (!initialScreen) notFound();
  if (!me) redirect('/');

  // The chosen company is read from ?companyId= by the workspace itself.
  return <DccWorkspace me={me} initialScreen={initialScreen} />;
}
