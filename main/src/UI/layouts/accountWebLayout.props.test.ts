import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ACCOUNT_SECTION_IDS } from '../../application/policies/account-sections.config';
import {
  buildAccountWebProps,
  buildAccountWebTranslations,
} from './accountWebLayout.props';
import { ACCOUNT_WEB_NAV } from './AccountWebLayout.sidebar.config';
import type { AccountWebLayoutTranslations } from './AccountWebLayout.composition';

const tx = {} as AccountWebLayoutTranslations;

describe('buildAccountWebProps', () => {
  it('skips an empty account name instead of rendering a blank identity', () => {
    const { identity } = buildAccountWebProps({
      currentUser: {
        name: '',
        email: 'ala@example.com',
        stylist_account: { display_name: null, pricing_plan: 'PRO' },
      },
      activeRole: 'STYLIST',
      tx,
    });
    expect(identity?.name).toBe('ala');
    // No is_active on the input: the rail must not poll for an unknown state.
    expect(identity?.isActive).toBe(false);
    expect(identity?.planLabel).toBeTruthy();
  });

  it('keeps the same user photo and initials when switching roles', () => {
    const currentUser = {
      name: 'Anna Nowak',
      email: 'anna@example.com',
      avatar_url: '/custom.jpg',
      image: '/oauth.jpg',
      stylist_account: {
        display_name: 'Studio X',
        avatar_url: '/old.jpg',
        pricing_plan: 'PRO' as const,
      },
      client_account: {},
    };
    const stylist = buildAccountWebProps({
      currentUser,
      activeRole: 'STYLIST',
      tx,
    }).identity;
    const client = buildAccountWebProps({
      currentUser,
      activeRole: 'CLIENT',
      tx,
    }).identity;
    expect(stylist?.name).toBe('Anna Nowak');
    expect(stylist?.avatarUrl).toBe('/custom.jpg');
    expect(stylist?.avatarFallbackUrl).toBe('/oauth.jpg');
    expect(client?.name).toBe(stylist?.name);
    expect(client?.avatarUrl).toBe(stylist?.avatarUrl);
    expect(client?.avatarFallbackUrl).toBe(stylist?.avatarFallbackUrl);
  });

  it('hides the plan label in client mode (the plan is a stylist surface)', () => {
    const props = buildAccountWebProps({
      currentUser: {
        name: 'Ala',
        stylist_account: { display_name: 'Studio Ala', pricing_plan: 'PRO' },
        client_account: {},
      },
      activeRole: 'CLIENT',
      tx,
    });
    expect(props.showBilling).toBe(false);
    expect(props.identity?.planLabel).toBeUndefined();
  });
});

describe('buildAccountWebTranslations', () => {
  it('carries a label for every account section and the list name', () => {
    const translated = buildAccountWebTranslations(key => `t:${key}`, 'skip');
    expect(translated.sectionsAriaLabel).toBe('t:sectionsAriaLabel');
    expect(translated.sectionAccount).toBe('t:sectionAccount');
    expect(translated.sectionDanger).toBe('t:sectionDanger');
    expect(translated.navAccount).toBe('t:navAccount');
    expect(translated.navNotifications).toBe('t:navNotifications');
    expect(translated.skipToContent).toBe('skip');
  });
});

describe('ACCOUNT_WEB_NAV', () => {
  it('lists the account sections under „Konto” only, in config order', () => {
    const withChildren = ACCOUNT_WEB_NAV.filter(
      item => item.children !== undefined
    );
    expect(withChildren.map(item => item.path)).toEqual([
      ROUTES_FRONT.USER_ACCOUNT,
    ]);
    expect(withChildren[0]?.children?.map(child => child.id)).toEqual([
      ...ACCOUNT_SECTION_IDS,
    ]);
  });

  it('keeps payments a separate item, never a section of „Konto”', () => {
    const paths = ACCOUNT_WEB_NAV.flatMap(item => [
      ...(item.children ?? []).map(child => child.path),
    ]);
    expect(paths).not.toContain(ROUTES_FRONT.USER_ACCOUNT_PAY);
    expect(ACCOUNT_WEB_NAV.map(item => item.path)).toContain(
      ROUTES_FRONT.USER_ACCOUNT_PAY
    );
  });
});
