import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from './email-template.renderer';

describe('salon invitation email acceptance link', () => {
  it.each(['pl', 'en', 'de'] as const)(
    'keeps the exact purpose-specific URL without tracking in %s',
    locale => {
      const invitationUrl =
        'https://nailfolio.app/salon-invitation?token=sample_token';
      const { html } = renderEmailTemplate(
        'salon-staff-invitation',
        { invitationUrl, inviterName: 'Anna', salonName: 'Studio Ani' },
        locale,
        '',
        'email.salonStaffInvitation.subject'
      );
      expect(html).toContain(`href="${invitationUrl}"`);
      expect(html).not.toContain('/app/salon/invitations');
      expect(html).not.toContain('utm_campaign=salon-staff-invitation');
    }
  );
});

const NAMELESS_INTRO = {
  pl: 'Właścicielka salonu w Nailfolio zaprasza Cię',
  en: 'A salon owner in Nailfolio invites you',
  de: 'Eine Salonbesitzerin lädt Sie',
} as const;

describe('salon invitation email without any owner or salon name', () => {
  it.each(['pl', 'en', 'de'] as const)(
    'opens subject and body with words, not a blank, in %s',
    locale => {
      const { subject, text } = renderEmailTemplate(
        'salon-staff-invitation',
        {
          invitationUrl: 'https://nailfolio.app/salon-invitation?token=t',
          inviterName: '',
          salonName: '',
        },
        locale,
        '',
        'email.salonStaffInvitation.subjectNoName'
      );
      expect(subject.trim().length).toBeGreaterThan(0);
      expect(subject).toBe(subject.trimStart());
      expect(text).toContain(NAMELESS_INTRO[locale]);
      expect(text).not.toMatch(/(^|\n)\s*(zaprasza|invites|lädt) /u);
    }
  );

  it('keeps the named first sentence when the owner has a name', () => {
    const { text } = renderEmailTemplate(
      'salon-staff-invitation',
      {
        invitationUrl: 'https://nailfolio.app/salon-invitation?token=t',
        inviterName: 'Anna',
        salonName: 'Studio Ani',
      },
      'pl',
      '',
      'email.salonStaffInvitation.subject'
    );
    expect(text).toContain(
      'Anna zaprasza Cię jako stylistkę do zespołu salonu Studio Ani w Nailfolio. Na swoim koncie'
    );
  });
});
