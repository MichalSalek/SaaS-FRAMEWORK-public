import { describe, expect, it } from 'vitest';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import {
  ANNOUNCEMENT_MESSAGE_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  EMPTY_ANNOUNCEMENT_FORM,
  announcementFormIssues,
  announcementPushSoftLocales,
  buildAnnouncementSubmitPayload,
  enabledAnnouncementTranslations,
  fromAnnouncement,
  isAnnouncementFormDirty,
} from './announcement-form.utils';
import {
  announcementAppRoles,
  announcementLanguageCodes,
  announcementNotificationSendState,
  joinAnnouncementList,
} from './announcement-send.logic';

const saved = {
  id: 'ann-1',
  title: 'Tytuł',
  message: 'Treść',
  type: 'info',
  is_active: true,
  starts_at: null,
  ends_at: null,
  created_by_user_id: 'admin',
  created_at: '2026-10-01T00:00:00.000Z',
  translations: { pl: { title: 'Tytuł', message: 'Treść' } },
  audience_anonymous: true,
  audience_client: true,
  audience_stylist: false,
  notification_sent_at: null,
} satisfies AdminAnnouncement;

describe('announcementFormIssues', () => {
  it('rejects an enabled language whose title or message is empty', () => {
    const form = {
      ...EMPTY_ANNOUNCEMENT_FORM,
      locales: {
        ...EMPTY_ANNOUNCEMENT_FORM.locales,
        pl: { enabled: true, title: 'Gotowe', message: 'Treść' },
        en: { enabled: true, title: '   ', message: '' },
      },
    };
    expect(announcementFormIssues(form)).toEqual([
      { code: 'title-empty', locale: 'en' },
      { code: 'message-empty', locale: 'en' },
    ]);
  });

  it('rejects a title or message past the kernel limits and ignores a disabled slot', () => {
    const form = {
      ...EMPTY_ANNOUNCEMENT_FORM,
      locales: {
        ...EMPTY_ANNOUNCEMENT_FORM.locales,
        pl: {
          enabled: true,
          title: 'a'.repeat(ANNOUNCEMENT_TITLE_MAX + 1),
          message: 'b'.repeat(ANNOUNCEMENT_MESSAGE_MAX + 1),
        },
        de: { enabled: false, title: '', message: '' },
      },
    };
    expect(announcementFormIssues(form)).toEqual([
      { code: 'title-long', locale: 'pl' },
      { code: 'message-long', locale: 'pl' },
    ]);
  });

  it('requires at least one language and one audience', () => {
    const form = {
      ...EMPTY_ANNOUNCEMENT_FORM,
      locales: {
        pl: { enabled: false, title: 'x', message: 'y' },
        en: { enabled: false, title: '', message: '' },
        de: { enabled: false, title: '', message: '' },
      },
      audience_anonymous: false,
      audience_client: false,
      audience_stylist: false,
    };
    expect(announcementFormIssues(form)).toEqual([
      { code: 'language' },
      { code: 'audience' },
    ]);
  });
});

describe('buildAnnouncementSubmitPayload', () => {
  it('drops a disabled language even when its fields still hold text', () => {
    const form = {
      ...fromAnnouncement(saved),
      locales: {
        pl: { enabled: true, title: '  Polski  ', message: 'Treść PL' },
        en: { enabled: false, title: 'English leftover', message: 'Hidden' },
        de: { enabled: true, title: 'Deutsch', message: 'Text' },
      },
    };
    const payload = buildAnnouncementSubmitPayload(form, saved);
    expect(payload.kind).toBe('update');
    if (payload.kind !== 'update') {
      return;
    }
    expect(payload.data.translations).toEqual({
      pl: { title: 'Polski', message: 'Treść PL' },
      de: { title: 'Deutsch', message: 'Text' },
    });
    expect(payload.data.title).toBe('Polski');
    expect(payload.data.message).toBe('Treść PL');
    expect(payload.data).not.toHaveProperty('translations.en');
  });

  it('uses the first enabled language as the legacy title when Polish is off', () => {
    const form = {
      ...EMPTY_ANNOUNCEMENT_FORM,
      locales: {
        pl: { enabled: false, title: 'Nie wysyłaj', message: 'Nie' },
        en: { enabled: true, title: 'Hello', message: 'Body' },
        de: { enabled: false, title: '', message: '' },
      },
      audience_anonymous: false,
      audience_client: true,
      audience_stylist: true,
    };
    const payload = buildAnnouncementSubmitPayload(form, null);
    expect(payload.kind).toBe('create');
    if (payload.kind !== 'create') {
      return;
    }
    expect(payload.data.title).toBe('Hello');
    expect(payload.data.message).toBe('Body');
    expect(enabledAnnouncementTranslations(form)).toEqual({
      en: { title: 'Hello', message: 'Body' },
    });
    expect(payload.data.audience_anonymous).toBe(false);
    expect(payload.data.audience_client).toBe(true);
    expect(payload.data.audience_stylist).toBe(true);
    expect(payload.data).not.toHaveProperty('starts_at');
  });
});

describe('isAnnouncementFormDirty', () => {
  it('is clean for the saved record and dirty when a language is switched off', () => {
    const form = fromAnnouncement(saved);
    expect(isAnnouncementFormDirty(form, form)).toBe(false);
    expect(
      isAnnouncementFormDirty(
        {
          ...form,
          locales: {
            ...form.locales,
            pl: { ...form.locales.pl, enabled: false },
          },
        },
        form
      )
    ).toBe(true);
  });
});

describe('announcementPushSoftLocales', () => {
  it('warns on a long push body only when an in-app role is selected', () => {
    const long = {
      ...EMPTY_ANNOUNCEMENT_FORM,
      audience_anonymous: false,
      audience_client: false,
      audience_stylist: false,
      locales: {
        ...EMPTY_ANNOUNCEMENT_FORM.locales,
        pl: {
          enabled: true,
          title: 'Krótki',
          message: `[czytaj](https://nailfolio.app/blog/a) ${'x'.repeat(180)}`,
        },
      },
    };
    expect(announcementPushSoftLocales(long)).toEqual([]);
    expect(
      announcementPushSoftLocales({ ...long, audience_client: true })
    ).toEqual(['pl']);
    expect(
      announcementPushSoftLocales({
        ...long,
        audience_stylist: true,
        locales: {
          ...long.locales,
          pl: { enabled: true, title: 'Krótki', message: 'Krótka treść' },
        },
      })
    ).toEqual([]);
  });
});

describe('announcementNotificationSendState', () => {
  it('blocks a dirty editor, an anonymous-only row and a row already sent', () => {
    const base = {
      saved: true,
      dirty: false,
      audience_client: true,
      audience_stylist: false,
      notification_sent_at: null,
    };
    expect(announcementNotificationSendState(base)).toBe('ready');
    expect(announcementNotificationSendState({ ...base, dirty: true })).toBe(
      'needs-save'
    );
    expect(
      announcementNotificationSendState({
        ...base,
        dirty: true,
        audience_client: false,
      })
    ).toBe('needs-save');
    expect(
      announcementNotificationSendState({ ...base, audience_client: false })
    ).toBe('anonymous-only');
    expect(
      announcementNotificationSendState({
        ...base,
        notification_sent_at: '2026-10-24T00:00:00.000Z',
        dirty: true,
      })
    ).toBe('already-sent');
  });

  it('lists app roles and enabled languages for the confirmation', () => {
    expect(
      announcementAppRoles({
        audience_client: true,
        audience_stylist: true,
      })
    ).toEqual(['client', 'stylist']);
    expect(
      announcementLanguageCodes({
        de: { title: 'D', message: 'D' },
        pl: { title: 'P', message: 'P' },
      })
    ).toEqual(['pl', 'de']);
    expect(
      joinAnnouncementList(['polski', 'angielski', 'niemiecki'], 'oraz')
    ).toBe('polski, angielski oraz niemiecki');
    expect(joinAnnouncementList(['klientki', 'stylistki'], 'oraz')).toBe(
      'klientki oraz stylistki'
    );
  });
});
