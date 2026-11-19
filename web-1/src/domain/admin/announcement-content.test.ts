import { describe, expect, it } from 'vitest';
import {
  announcementTranslationsSchema,
  announcementTranslation,
  announcementVisibleTo,
  readAnnouncementTranslations,
} from '@kernel/domain/admin/announcement-content';
import {
  announcementPlainText,
  parseAnnouncementLinks,
  safeAnnouncementHref,
} from '@kernel/domain/admin/announcement-links';
import { adminCreateAnnouncementSchema } from '@kernel/domain/admin/admin-command.contract-schemas';

const audience = {
  audience_anonymous: false,
  audience_client: false,
  audience_stylist: true,
};

describe('announcement audience and languages', () => {
  it('keeps announcements written by the old backend readable during an additive rollout', () => {
    expect(
      readAnnouncementTranslations({}, { title: 'Hej', message: 'Aktualność' })
    ).toEqual({ pl: { title: 'Hej', message: 'Aktualność' } });
    expect(
      readAnnouncementTranslations(
        { en: { title: 'Hello', message: 'News' } },
        { title: 'Hej', message: 'Aktualność' }
      )
    ).toEqual({ en: { title: 'Hello', message: 'News' } });
  });
  it('never exposes an app-only announcement on public pages, even to a stylist', () => {
    expect(announcementVisibleTo(audience, 'STYLIST', 'public')).toBe(false);
    expect(announcementVisibleTo(audience, null, 'public')).toBe(false);
    expect(announcementVisibleTo(audience, 'CLIENT', 'app')).toBe(false);
    expect(announcementVisibleTo(audience, 'STYLIST', 'app')).toBe(true);
    expect(announcementVisibleTo(audience, null, 'app')).toBe(false);
  });
  it('requires both public visibility and a signed-in viewer role on public pages', () => {
    const publicAudience = { ...audience, audience_anonymous: true };
    expect(announcementVisibleTo(publicAudience, null, 'public')).toBe(true);
    expect(announcementVisibleTo(publicAudience, 'CLIENT', 'public')).toBe(
      false
    );
    expect(announcementVisibleTo(publicAudience, 'STYLIST', 'public')).toBe(
      true
    );
  });
  it('rejects an empty enabled language, whitespace, an empty set and unrecognized locales', () => {
    for (const value of [
      {},
      { en: { title: '', message: 'Hello' } },
      { pl: { title: 'Hej', message: ' ' } },
      { fr: { title: 'Bonjour', message: 'Bonjour' } },
    ]) {
      expect(announcementTranslationsSchema.safeParse(value).success).toBe(
        false
      );
    }
    expect(
      announcementTranslationsSchema.safeParse({
        en: { title: 'Hello', message: 'News' },
      }).success
    ).toBe(true);
  });
  it('only falls back in the notification centre, never in the banner', () => {
    const translations = { en: { title: 'Hello', message: 'News' } };
    expect(announcementTranslation(translations, 'pl')).toBeUndefined();
    expect(announcementTranslation(translations, 'pl', true)).toEqual(
      translations.en
    );
  });
  it('rejects a saved announcement with no audience', () => {
    const result = adminCreateAnnouncementSchema.safeParse({
      title: 'Hi',
      message: 'News',
      type: 'info',
      is_active: false,
      audience_anonymous: false,
      audience_client: false,
      audience_stylist: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('announcement web links', () => {
  it('turns same-origin links into internal paths and preserves external HTTPS', () => {
    expect(safeAnnouncementHref('https://nailfolio.app/blog/a?x=1#b')).toBe(
      '/blog/a?x=1#b'
    );
    expect(safeAnnouncementHref('/en/blog/a')).toBe('/en/blog/a');
    expect(
      safeAnnouncementHref('https://nailfolio.app//other.example/path')
    ).toBeUndefined();
    expect(safeAnnouncementHref('https://example.org/a')).toBe(
      'https://example.org/a'
    );
  });
  it('rejects unsafe schemes, protocol-relative URLs, backslashes, credentials and controls', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      '/\\evil.example',
      'https://user:pass@example.com',
      '/x\ny',
    ]) {
      expect(safeAnnouncementHref(value)).toBeUndefined();
    }
    expect(safeAnnouncementHref('https://nailfolio.app:444/a')).toBe(
      'https://nailfolio.app:444/a'
    );
  });
  it('retains literal HTML and unsafe Markdown and removes valid Markdown from push text', () => {
    expect(announcementPlainText('Nowość [Blog](/blog/a), <b>tekst</b>')).toBe(
      'Nowość Blog, <b>tekst</b>'
    );
    expect(parseAnnouncementLinks('[Klik](javascript:evil)')).toEqual([
      { text: '[Klik](javascript:evil)' },
    ]);
    expect(parseAnnouncementLinks('https://example.org/a.')).toEqual([
      { text: 'https://example.org/a', href: 'https://example.org/a' },
      { text: '.' },
    ]);
  });
});
