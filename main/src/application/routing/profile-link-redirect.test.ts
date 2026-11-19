import { describe, expect, it } from 'vitest';
import { buildProfileLinkDestination } from './profile-link-redirect';

describe('buildProfileLinkDestination', () => {
  it('sends an old stylist link to her current one with the locale and the query', () => {
    expect(
      buildProfileLinkDestination({
        kind: 'STYLIST',
        resolved: { account_id: 'acc1', current_slug: 'anna-studio' },
        locale: 'de',
        query: { identifier: 'anna-nails', utm_source: 'ig', tag: ['a', 'b'] },
        routeParam: 'identifier',
      })
    ).toBe('/de/stylist/anna-studio/?utm_source=ig&tag=a&tag=b');
  });

  it('falls back to the id route when she has no link now', () => {
    expect(
      buildProfileLinkDestination({
        kind: 'STYLIST',
        resolved: { account_id: 'acc1', current_slug: null },
        locale: 'pl',
        query: { identifier: 'anna-nails' },
        routeParam: 'identifier',
      })
    ).toBe('/stylist/acc1/');
  });

  it('sends an old salon link to the current salon address', () => {
    expect(
      buildProfileLinkDestination({
        kind: 'SALON',
        resolved: { account_id: 'acc1', current_slug: 'studio-new' },
        locale: 'en',
        query: { slug: 'studio-old' },
        routeParam: 'slug',
      })
    ).toBe('/en/s/studio-new/');
    expect(
      buildProfileLinkDestination({
        kind: 'SALON',
        resolved: { account_id: 'acc1', current_slug: null },
        locale: 'pl',
        query: { slug: 'studio-old', utm_medium: 'qr' },
        routeParam: 'slug',
      })
    ).toBe('/salon/acc1/?utm_medium=qr');
  });
});
