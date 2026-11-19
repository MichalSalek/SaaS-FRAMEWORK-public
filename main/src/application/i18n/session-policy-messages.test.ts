import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { getI18nMessages, getPublicPageMessages } from './i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from './page-messages.config';

const token = '__NF_SESSION_EXPIRY_DAYS__';
const policyPaths = [
  'pages.privacy.sections.dataRetention.content',
  'pages.privacy.sections.sessionShare.content',
  'pages.terms.sections.definitions.content',
  'pages.terms.sections.sessionShare.content',
  'seo.pricing.jsonLd.feature2',
  'static.forClients.how.footnote',
  'static.forClients.how.step03Body',
  'static.getApp.features.f04Body',
];

function message(tree: unknown, path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) {
      return undefined;
    }
    return (node as Record<string, unknown>)[key];
  }, tree);
  expect(value, path).toBeTypeOf('string');
  return value as string;
}

describe('session policy in loaded locale data', () => {
  it.each(['pl', 'en', 'de'])(
    'resolves legal, public and SEO copy in %s',
    async locale => {
      const messages = await getI18nMessages(locale);
      for (const path of policyPaths) {
        const value = message(messages, path);
        expect(value, path).toContain(
          String(SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS)
        );
        expect(value, path).not.toContain(token);
      }
      expect(
        message(messages, 'pages.terms.sections.withdrawalRight.content')
      ).toContain('14');
    }
  );

  it.each(['pl', 'en', 'de'])(
    'resolves the client, build and markdown paths in %s',
    async locale => {
      const { messages, buildMessages } = await getPublicPageMessages(
        locale,
        PUBLIC_PAGE_MESSAGES['/for-clients']
      );
      const footnote = message(messages, 'static.forClients.how.footnote');
      const step = message(buildMessages, 'static.forClients.how.step03Body');
      const prefix = locale === 'pl' ? '' : `${locale}/`;
      const mirror = readFileSync(
        join(process.cwd(), 'public', prefix, 'for-clients.md'),
        'utf8'
      );
      expect(mirror).toContain(footnote);
      expect(mirror).toContain(step);
      expect(mirror).not.toContain(token);
      const pricing = await getPublicPageMessages(
        locale,
        PUBLIC_PAGE_MESSAGES['/pricing']
      );
      expect(
        message(pricing.buildMessages, 'seo.pricing.jsonLd.feature2')
      ).toContain(String(SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS));
    }
  );

  it('resolves an unsupported locale through the Polish fallback', async () => {
    const messages = await getI18nMessages('unsupported');
    expect(message(messages, policyPaths[0])).toContain('30');
    expect(message(messages, policyPaths[0])).not.toContain(token);
  });
});
