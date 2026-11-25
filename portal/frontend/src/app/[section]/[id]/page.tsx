import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { DETAIL_SCREENS, SCREEN_TITLES, screenForSegment } from '@/lib/workspace-routes';
import { DccWorkspace } from '../../dcc-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string; id: string }>;
}): Promise<Metadata> {
  const screen = screenForSegment((await params).section);
  return screen && DETAIL_SCREENS.includes(screen)
    ? { title: `${SCREEN_TITLES[screen]} · DCC` }
    : {};
}

/** `/<screen>/<id>`: one record on a screen that has a detail page. */
export default async function WorkspaceDetailRoute({
  params,
}: {
  params: Promise<{ section: string; id: string }>;
}) {
  const [{ section }, me] = await Promise.all([params, getMe()]);
  const initialScreen = screenForSegment(section);

  if (!initialScreen || !DETAIL_SCREENS.includes(initialScreen)) notFound();
  if (!me) redirect('/');

  return <DccWorkspace me={me} initialScreen={initialScreen} />;
}
