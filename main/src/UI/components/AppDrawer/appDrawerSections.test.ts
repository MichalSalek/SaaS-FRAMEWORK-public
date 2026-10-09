import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getClientSections,
  getStylistSections,
  type DrawerSection,
} from './appDrawerSections';

const t = (key: string): string => key;
const logout = (): void => undefined;

function invitationItem(sections: DrawerSection[]) {
  return sections
    .flatMap(section => section.items)
    .find(item => item.path === ROUTES_FRONT.SALON_INVITATIONS);
}

describe('salon invitations drawer item', () => {
  it('is absent in both roles while nothing is pending', () => {
    expect(invitationItem(getStylistSections(t, logout, true, 0, 0))).toBe(
      undefined
    );
    expect(invitationItem(getClientSections(t, logout, 0, 0))).toBe(undefined);
  });

  it('shows with a count badge for a stylist', () => {
    const item = invitationItem(getStylistSections(t, logout, true, 0, 2));
    expect(item?.badgeCount).toBe(2);
    expect(item?.label).toBe('drawer.user.salonInvitations');
  });

  it('stays without a badge when the read failed (count unknown)', () => {
    for (const item of [
      invitationItem(getStylistSections(t, logout, true, 0, null)),
      invitationItem(getClientSections(t, logout, 0, null)),
    ]) {
      expect(item?.path).toBe(ROUTES_FRONT.SALON_INVITATIONS);
      expect(item?.badgeCount).toBe(undefined);
    }
  });

  it('shows with a count badge in client mode too', () => {
    expect(invitationItem(getClientSections(t, logout, 0, 1))?.badgeCount).toBe(
      1
    );
  });
});

describe('support drawer items', () => {
  const variants = (unreadSupport: number) => [
    getStylistSections(t, logout, true, 0, 0, unreadSupport),
    getClientSections(t, logout, 0, 0, unreadSupport),
  ];

  it('„Zgłoś błąd lub pomysł” sits right after „Pomoc” in both roles', () => {
    for (const sections of variants(0)) {
      const items = sections.flatMap(section => section.items);
      const helpIndex = items.findIndex(
        item => item.path === ROUTES_FRONT.SUPPORT
      );
      expect(helpIndex).toBeGreaterThan(-1);
      expect(items[helpIndex + 1]?.path).toBe(ROUTES_FRONT.SUPPORT_NEW);
      expect(items[helpIndex + 1]?.label).toBe('drawer.user.reportBugOrIdea');
    }
  });

  it('„Pomoc” carries the unread support count, the report entry never does', () => {
    for (const sections of variants(3)) {
      const items = sections.flatMap(section => section.items);
      expect(
        items.find(item => item.path === ROUTES_FRONT.SUPPORT)?.badgeCount
      ).toBe(3);
      expect(
        items.find(item => item.path === ROUTES_FRONT.SUPPORT_NEW)?.badgeCount
      ).toBe(undefined);
    }
  });
});
