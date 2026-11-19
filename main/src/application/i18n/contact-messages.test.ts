import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { mapContactMessages } from './contact-messages';
import { getPublicPageMessages } from './i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from './page-messages.config';
import { serializeJsonLd } from '../security/jsonld-serialize';

const addresses = Object.values(BRAND_CONFIG.email);

describe('public contact exposure', () => {
  it('encodes nested messages without mutating source objects', () => {
    const original = {
      nested: [BRAND_CONFIG.email.contact, 'ordinary copy'],
      count: 2,
    };
    const encoded = mapContactMessages(original, 'encode');
    expect(encoded).not.toEqual(original);
    expect(original.nested[0]).toBe(BRAND_CONFIG.email.contact);
    expect(mapContactMessages(encoded, 'hidden').nested).toEqual([
      '…',
      'ordinary copy',
    ]);
    expect(mapContactMessages(encoded, 'revealed')).toEqual(original);
  });

  it('does not disclose brand addresses in public locale payloads or build data', async () => {
    for (const locale of ['pl', 'en', 'de']) {
      for (const spec of Object.values(PUBLIC_PAGE_MESSAGES)) {
        const payload = JSON.stringify(
          await getPublicPageMessages(locale, spec)
        );
        for (const address of addresses) {
          expect(payload).not.toContain(address);
        }
      }
    }
  });

  it('keeps mailbox literals out of locale modules before any bundler runs', () => {
    for (const locale of ['pl', 'en', 'de']) {
      for (const file of ['common.json', 'events.json']) {
        const source = readFileSync(
          join(process.cwd(), 'src/locales', locale, file),
          'utf8'
        );
        for (const address of addresses) {
          expect(source).not.toContain(address);
        }
      }
    }
  });

  it('preserves Date serialization in JSON-LD', () => {
    const date = new Date('2026-10-19T12:00:00Z');
    expect(JSON.parse(serializeJsonLd({ date })).date).toBe(date.toISOString());
  });

  it('directs crawlers to contact without leaking email in structured data', () => {
    const value = serializeJsonLd({
      email: BRAND_CONFIG.email.support,
      text: `Contact ${BRAND_CONFIG.email.privacy}`,
    });
    for (const address of addresses) {
      expect(value).not.toContain(address);
    }
    expect(value).toContain(`${BRAND_CONFIG.url}/contact`);
  });
});
