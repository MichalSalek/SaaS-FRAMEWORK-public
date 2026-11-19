import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { getPostBySlug } from './blog.utils';

const posts = [
  ['pl', 'qr-parowanie-jak-to-dziala'],
  ['en', 'best-nail-portfolio-apps-2026'],
  ['en', 'booksy-alternative-for-nail-techs'],
  ['en', 'fresha-vs-booksy-for-nail-techs'],
  ['en', 'nail-consultation-before-the-appointment'],
  ['en', 'nail-shapes-and-lengths'],
  ['de', 'nagelformen-und-laengen'],
  ['de', 'beratung-vor-dem-nageltermin'],
] as const;

describe('session policy in blog content', () => {
  it.each(posts)('%s/%s matches its generated mirror', (locale, slug) => {
    const post = getPostBySlug(slug, locale);
    expect(post).not.toBeNull();
    if (post === null) {
      throw new Error(`Missing blog post ${locale}/${slug}`);
    }
    const content = post.content.trim();
    const prefix = locale === 'pl' ? '' : `${locale}/`;
    const mirror = readFileSync(
      join(process.cwd(), 'public', prefix, 'blog', `${slug}.md`),
      'utf8'
    );
    expect(content).toContain(
      String(SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS)
    );
    expect(content).not.toContain('__NF_SESSION_EXPIRY_DAYS__');
    expect(mirror).toContain(content);
    expect(mirror).not.toContain('__NF_SESSION_EXPIRY_DAYS__');
  });
});
