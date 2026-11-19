import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NotificationDTO } from '@kernel/models/notifications/notifications.dto';
import type * as Presentation from './notificationPresentation';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { NotificationsPageComposition } from './NotificationsPage.composition';
import { notificationAnnouncementView } from '../announcements/announcement-display';

// These three rendering modules are identical to the deployed 19a46ff client.
// That client has no icon for the new enum member; keep its boundary here.
const state = vi.hoisted(() => ({
  row: undefined as NotificationDTO | undefined,
}));
vi.mock('./notificationPresentation', async importOriginal => {
  const actual = await importOriginal<typeof Presentation>();
  return {
    ...actual,
    NOTIFICATION_ICONS: {
      ...actual.NOTIFICATION_ICONS,
      SESSION_EXPIRING_SOON: undefined,
    },
  };
});
vi.mock('./hooks/useNotifications', () => ({
  useRecentNotifications: () => ({
    data: { notifications: [state.row], unread_count: 1 },
    dataUpdatedAt: 1,
  }),
}));
vi.mock('./hooks/useNotificationReadMarker', () => ({
  useNotificationReadMarker: () => undefined,
}));
vi.mock('../../contexts/AuthContext.composition', () => ({
  useAuth: () => ({ isLoggedIn: true }),
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../components/AppHero/AppHero.organism', () => ({
  AppHeroOrganism: () => null,
}));
vi.mock('../../layouts/useAppBarTitle.composition', () => ({
  useAppBarTitle: () => undefined,
}));
vi.mock('../shared/push/PushOptIn.organism', () => ({
  PushOptInOrganism: () => null,
}));
vi.mock('../../../application/analytics/flow-events', () => ({
  trackFlowStep: () => undefined,
}));

const reminder: NotificationDTO = {
  id: 'reminder/id',
  type: 'SESSION_EXPIRING_SOON',
  actor_name: 'Anna',
  target_path: '/app/sessions/session-1',
  recipient_role: 'CLIENT',
  created_at: '2026-11-08T20:00:00.000Z',
  read_at: null,
};

describe('notification compatibility with the deployed old client', () => {
  it('shows why the unadapted new enum breaks the old notification page', () => {
    state.row = reminder;
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      expect(() =>
        renderWithProviders(<NotificationsPageComposition />)
      ).toThrow(/Element type is invalid/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each(['pl', 'en', 'de'] as const)(
    'renders the adapted reminder with a working internal link in %s',
    locale => {
      const target = '/app/notifications/open?id=reminder%2Fid';
      const wire: NotificationDTO = process.env['NF_LEGACY_TEST_WIRE']
        ? (JSON.parse(process.env['NF_LEGACY_TEST_WIRE']) as NotificationDTO)
        : {
            ...reminder,
            type: 'SYSTEM_ANNOUNCEMENT',
            announcement: {
              translations: {
                pl: { title: 'Tytuł', message: `[Otwórz](${target})` },
                en: { title: 'Title', message: `[Open](${target})` },
                de: { title: 'Titel', message: `[Öffnen](${target})` },
              },
              primary_href: null,
            },
          };
      state.row = wire;
      const view = notificationAnnouncementView(wire.announcement, locale);
      expect(view?.locale).toBe(locale);
      expect(view?.title).toBeTruthy();
      expect(view?.message).toBeTruthy();
      renderWithProviders(<NotificationsPageComposition />, { locale });
      const link = screen.getByRole('link', { name: /.+/ });
      expect(link.getAttribute('href')).toMatch(
        /^\/app\/notifications\/open\/?\?id=reminder%2Fid$/
      );
      expect(link.closest('a')?.parentElement?.closest('a')).toBeNull();
      expect(link.closest('li')?.textContent).toContain(view?.title);
    }
  );
});

describe('notification schema advertisement', () => {
  it('advertises schema 2 on both recent and get-one reads', async () => {
    const requests: unknown[] = [];
    vi.doMock('../../../application/http/io', () => ({
      contractEndpoint: () => (input: unknown) => {
        requests.push(input);
        return Promise.resolve({});
      },
    }));
    try {
      const io =
        await import('../../../domain/notifications/notificationsIO.possibilities.api');
      await io.getRecentNotifications_IO(undefined);
      await io.getNotification_IO({ id: 'n1' });
      expect(requests).toEqual([
        { notification_schema: '2' },
        { id: 'n1', notification_schema: '2' },
      ]);
    } finally {
      vi.doUnmock('../../../application/http/io');
    }
  });
});
