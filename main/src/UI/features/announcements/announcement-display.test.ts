import { describe, expect, it } from 'vitest';
import {
  bannerAnnouncementCopy,
  notificationAnnouncementView,
} from './announcement-display';

const both = {
  audience_anonymous: true,
  audience_client: true,
  audience_stylist: true,
  translations: {
    pl: { title: 'PL', message: 'Cześć [blog](/blog/wiosna)' },
  },
};

describe('bannerAnnouncementCopy', () => {
  it('hides an announcement that has no copy in the interface language', () => {
    expect(bannerAnnouncementCopy(both, 'en', null, 'public')).toBeUndefined();
  });

  it('hides a public page when anonymous is off, including a signed-in stylist', () => {
    const appOnly = { ...both, audience_anonymous: false };
    expect(
      bannerAnnouncementCopy(appOnly, 'pl', 'STYLIST', 'public')
    ).toBeUndefined();
    expect(bannerAnnouncementCopy(appOnly, 'pl', 'STYLIST', 'app')).toEqual({
      title: 'PL',
      message: 'Cześć [blog](/blog/wiosna)',
    });
  });

  it('shows a guest only the anonymous public banner', () => {
    expect(bannerAnnouncementCopy(both, 'pl', null, 'public')?.title).toBe(
      'PL'
    );
    expect(bannerAnnouncementCopy(both, 'pl', null, 'app')).toBeUndefined();
  });

  it('shows an in-app client only the client audience', () => {
    const stylists = {
      ...both,
      audience_anonymous: false,
      audience_client: false,
    };
    expect(
      bannerAnnouncementCopy(stylists, 'pl', 'CLIENT', 'app')
    ).toBeUndefined();
    expect(
      bannerAnnouncementCopy(stylists, 'pl', 'STYLIST', 'app')?.title
    ).toBe('PL');
  });
});

describe('notificationAnnouncementView', () => {
  it('keeps the selected test language when the admin interface uses another language', () => {
    const view = notificationAnnouncementView(
      {
        translations: {
          pl: { title: 'PL', message: 'Polska wersja' },
          en: { title: 'EN', message: 'English version' },
        },
        primary_href: null,
        test_locale: 'en',
      },
      'pl'
    );
    expect(view).toMatchObject({
      title: 'EN',
      message: 'English version',
      locale: 'en',
    });
  });

  it('does not borrow a primary-language link for a translated body without a link', () => {
    const announcement = {
      translations: {
        pl: { title: 'PL', message: '[A](/pl-a)' },
        en: { title: 'EN', message: 'No link here' },
      },
      primary_href: '/pl-a',
    };
    expect(
      notificationAnnouncementView(announcement, 'en')?.rowHref
    ).toBeNull();
    expect(
      notificationAnnouncementView({ ...announcement, test_locale: 'en' }, 'pl')
        ?.rowHref
    ).toBeNull();
  });

  it('preserves the interface language for normal announcements without a test locale', () => {
    const view = notificationAnnouncementView(
      {
        translations: {
          pl: { title: 'PL', message: 'Polska wersja' },
          en: { title: 'EN', message: 'English version' },
        },
        primary_href: null,
        test_locale: null,
      },
      'pl'
    );
    expect(view?.title).toBe('PL');
  });

  it('falls back to another language and keeps every link in the body', () => {
    const view = notificationAnnouncementView(
      {
        translations: both.translations,
        primary_href: '/blog/wiosna',
      },
      'de'
    );
    expect(view).toEqual({
      locale: 'pl',
      title: 'PL',
      message: 'Cześć [blog](/blog/wiosna)',
      rowHref: null,
      external: false,
    });
  });

  it('opens the row itself only when the body has no link', () => {
    expect(
      notificationAnnouncementView(
        {
          translations: { en: { title: 'Hi', message: 'No link here' } },
          primary_href: 'https://example.com/post',
        },
        'pl'
      )
    ).toEqual({
      locale: 'en',
      title: 'Hi',
      message: 'No link here',
      rowHref: 'https://example.com/post',
      external: true,
    });
    expect(
      notificationAnnouncementView(
        {
          translations: { pl: { title: 'A', message: 'Bez adresu' } },
          primary_href: null,
        },
        'pl'
      )?.rowHref
    ).toBeNull();
  });
});
