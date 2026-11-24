import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { SCREEN_TITLES, screenForSegment } from '@/lib/workspace-routes';
import { DccWorkspace } from '../dcc-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const screen = screenForSegment((await params).section);
  return screen ? { title: `${SCREEN_TITLES[screen]} · DCC` } : {};
}

export default async function WorkspaceRoute({ params }: { params: Promise<{ section: string }> }) {
  const [{ section }, me] = await Promise.all([params, getMe()]);
  const initialScreen = screenForSegment(section);

  if (!initialScreen) notFound();
  if (!me) redirect('/');

  // The chosen company is read from ?companyId= by the workspace itself.
  return <DccWorkspace me={me} initialScreen={initialScreen} />;
}
