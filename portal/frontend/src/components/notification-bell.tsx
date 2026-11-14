'use client';

import { useEffect, useState } from 'react';
import type { MarkedReadDto, NotificationDto, UnreadCountDto } from '@dcc/contracts';
import { ApiRequestError, apiSend } from '@/lib/browser-api';
import { formatDateTime } from '@/lib/format';
import { NOTIFICATION_EVENT_LABELS } from '@/lib/labels';
import { toApiError, useApiData } from '@/lib/use-api';
import { Dialog, DialogActions } from './dialog';
import { EmptyState, LoadingState } from './empty-state';
import { ErrorBox } from './error-box';

const TEXT = {
  bell: (unread: number) =>
    unread === 0
      ? 'Notifications: none unread'
      : `Notifications: ${unread} unread`,
  title: 'Notifications',
  description: 'Messages DCC sent to you. Only you can see them.',
  unreadOnly: 'Show unread only',
  emptyTitle: 'No notifications',
  emptyBody: 'When something needs you, it appears here.',
  emptyUnread: 'You have read everything.',
  unread: 'Unread',
  read: 'Read',
  markRead: 'Mark as read',
  markAll: 'Mark all as read',
  open: 'Open',
  close: 'Close',
};

const REFRESH_MS = 60_000;

/**
 * The bell in the top bar: unread count from `GET /api/notifications/unread-count`, and a dialog with
 * the person's own notifications. Nothing is marked read on screen until the API has said so.
 */
export function NotificationBell({
  refreshKey,
  onOpenTarget,
}: {
  /** Change it to make the bell ask for the count again. */
  refreshKey: number;
  /** Take the person to what the notification is about. */
  onOpenTarget: (notification: NotificationDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [actionError, setActionError] = useState<ApiRequestError | null>(null);
  const [busy, setBusy] = useState(false);
  const count = useApiData<UnreadCountDto>('/notifications/unread-count');
  const list = useApiData<NotificationDto[]>(
    open ? `/notifications${unreadOnly ? '?unreadOnly=true' : ''}` : null,
  );
  const reloadCount = count.reload;

  useEffect(() => {
    if (refreshKey > 0) reloadCount();
  }, [refreshKey, reloadCount]);
  useEffect(() => {
    const timer = window.setInterval(reloadCount, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reloadCount]);

  const unread = count.data?.unread ?? 0;
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await run();
    } catch (error) {
      setActionError(toApiError(error));
    } finally {
      setBusy(false);
      list.reload();
      count.reload();
    }
  };

  return (
    <>
      <button
        type="button"
        className="icon-button notification-button"
        aria-label={TEXT.bell(unread)}
        aria-haspopup="dialog"
        onClick={() => {
          setActionError(null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">♧</span>
        {unread > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <Dialog title={TEXT.title} description={TEXT.description} onClose={() => setOpen(false)} wide>
          <label className="platform-option" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            {TEXT.unreadOnly}
          </label>
          <ErrorBox error={list.error} loading />
          <ErrorBox error={actionError} />
          {list.data === null && list.loading && <LoadingState />}
          {list.data && list.data.length === 0 && (
            <EmptyState title={TEXT.emptyTitle}>
              {unreadOnly ? TEXT.emptyUnread : TEXT.emptyBody}
            </EmptyState>
          )}
          {list.data && list.data.length > 0 && (
            <ul className="notification-list">
              {list.data.map((item) => (
                <li key={item.id} className="activity-row">
                  <span className="activity-dot" aria-hidden="true" />
                  <div className="activity-copy" style={{ flex: 1 }}>
                    <strong>{NOTIFICATION_EVENT_LABELS[item.eventType] ?? item.eventType}</strong>{' '}
                    <span className={`status ${item.readAt ? 'status-gray' : 'status-amber'}`}>
                      {item.readAt ? TEXT.read : TEXT.unread}
                    </span>
                    <span className="notification-summary">{item.summary}</span>
                    <small>{formatDateTime(item.createdAt)}</small>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          setOpen(false);
                          onOpenTarget(item);
                        }}
                      >
                        {TEXT.open}
                      </button>
                      {!item.readAt && (
                        <button
                          type="button"
                          className="text-link"
                          disabled={busy}
                          onClick={() =>
                            act(() => apiSend<unknown>('POST', `/notifications/${item.id}/read`))
                          }
                        >
                          {TEXT.markRead}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogActions>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy || unread === 0}
              onClick={() => act(() => apiSend<MarkedReadDto>('POST', '/notifications/read-all'))}
            >
              {TEXT.markAll}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
              {TEXT.close}
            </button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
