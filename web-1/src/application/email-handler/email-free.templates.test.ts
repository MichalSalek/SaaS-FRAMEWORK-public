import { describe, expect, it } from 'vitest';
import {
  renderEmailTemplate,
  getEmailPreheader,
} from './email-template.renderer';
import { FREE_EMAIL_RULES } from '@kernel/domain/email/email-free.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { trackLifecycleEmailLinks } from './email-lifecycle-links';
const id = 'f7b36966-8474-490a-8d82-51f490102f60';
describe('Free templates and direct lifecycle links', () => {
  for (const locale of ['pl', 'en', 'de'] as const) {
    for (const [template, rule] of Object.entries(FREE_EMAIL_RULES)) {
      it(`${template} renders ${locale} with one primary CTA, working links and no tokens in attribution`, () => {
        const result = renderEmailTemplate(
          template,
          { appUrl: BRAND_CONFIG.url, lifecycleMessageId: id },
          locale,
          `${BRAND_CONFIG.url}/api/v1/email/unsubscribe?token=secret`,
          rule.subjectKey
        );
        expect(result.subject.length).toBeGreaterThan(5);
        expect(getEmailPreheader(result.html).length).toBeGreaterThan(5);
        expect(result.html).not.toMatch(/\{\{|undefined/);
        expect((result.html.match(/class="email-button"/g) ?? []).length).toBe(
          1
        );
        expect(result.html).toContain('Ekipa Nailfolio!');
        expect(result.html).toContain('mailto:support@example.com');
        expect(result.text).toContain(`nf_message=${id}`);
        const hrefs = [...result.html.matchAll(/href="([^"]+)"/g)].map(
          match => match[1] ?? ''
        );
        expect(hrefs.some(href => href.includes(`nf_cta=primary`))).toBe(true);
        expect(hrefs.some(href => href.includes(`nf_cta=app`))).toBe(true);
        expect(hrefs.some(href => href.includes(`nf_cta=support`))).toBe(true);
        expect(hrefs.find(href => href.includes('token=secret'))).not.toContain(
          'nf_message'
        );
      });
    }
    it(`pending request uses the client list in ${locale}`, () => {
      const result = renderEmailTemplate(
        'free-first-client',
        { appUrl: BRAND_CONFIG.url, pendingRequest: '1' },
        locale,
        '',
        FREE_EMAIL_RULES['free-first-client'].subjectKey
      );
      expect(result.html).toContain(ROUTES_FRONT.CLIENTS);
      expect(result.html).not.toContain(`${ROUTES_FRONT.PAIRING}?`);
      expect(getEmailPreheader(result.html)).not.toMatch(/QR/);
    });
  }
  it('does not stamp foreign origins, auth token URLs or mailto links', () => {
    const html = `<a href="https://example.com/app">foreign</a><a href="${BRAND_CONFIG.url}/login?token=secret">auth</a><a href="mailto:support@example.com">help</a>`;
    expect(trackLifecycleEmailLinks(html, id)).toBe(html);
  });
});
