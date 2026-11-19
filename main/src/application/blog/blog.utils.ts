import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import readingTime from 'reading-time';
import type {
  BlogPost,
  BlogPostFrontmatter,
  BlogPostFull,
  BlogTranslationGroup,
} from './blog.types';
import type { BlogCategory } from '../../content/blog/categories.config';
import { BLOG_CATEGORIES } from '../../content/blog/categories.config';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';
import { resolveSessionExpiryText } from '@kernel/domain/session-container/session-container.policy-text';

const BLOG_CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'blog');
const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseTranslationGroup(value: unknown): BlogTranslationGroup | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const group = value as Record<string, unknown>;
  if (
    Object.keys(group).sort().join(',') !== 'id,slugs' ||
    typeof group.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(group.id)
  ) {
    return null;
  }
  if (
    group.slugs === null ||
    typeof group.slugs !== 'object' ||
    Array.isArray(group.slugs)
  ) {
    return null;
  }
  const slugs = group.slugs as Record<string, unknown>;
  if (
    Object.keys(slugs).sort().join(',') !== 'de,en,pl' ||
    !I18N_CONFIG.locales.every(
      locale =>
        typeof slugs[locale] === 'string' &&
        (slugs[locale] as string).length <= 120 &&
        BLOG_SLUG.test(slugs[locale] as string)
    ) ||
    new Set(Object.values(slugs)).size !== 3
  ) {
    return null;
  }
  return {
    id: group.id,
    slugs: {
      pl: slugs.pl as string,
      en: slugs.en as string,
      de: slugs.de as string,
    },
  };
}

/** Return a group only when all three on-disk members reciprocate the exact mapping. */
export function resolveBlogTranslationGroup(
  post: BlogPost,
  load: (slug: string, locale: string) => BlogPost | null = getPostBySlug
): BlogTranslationGroup | null {
  const group = parseTranslationGroup(post.translationGroup);
  if (
    !group ||
    !I18N_CONFIG.locales.some(
      locale => locale === post.locale && group.slugs[locale] === post.slug
    )
  ) {
    return null;
  }
  for (const locale of I18N_CONFIG.locales) {
    const member = load(group.slugs[locale], locale);
    const other = parseTranslationGroup(member?.translationGroup);
    if (
      !member ||
      member.locale !== locale ||
      member.slug !== group.slugs[locale] ||
      !other ||
      other.id !== group.id ||
      I18N_CONFIG.locales.some(l => other.slugs[l] !== group.slugs[l])
    ) {
      return null;
    }
  }
  return group;
}

/**
 * Runtime type guard for blog post frontmatter from MDX gray-matter output.
 * Validates required fields and category against BLOG_CATEGORIES SSOT.
 */
function isBlogPostFrontmatter(
  data: Record<string, unknown>
): data is Record<string, unknown> & BlogPostFrontmatter {
  return (
    typeof data.title === 'string' &&
    typeof data.description === 'string' &&
    typeof data.date === 'string' &&
    typeof data.locale === 'string' &&
    typeof data.category === 'string' &&
    (BLOG_CATEGORIES as readonly string[]).includes(data.category)
  );
}

function parseMdxFile(filePath: string, slug: string): BlogPost | null {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);

  if (!isBlogPostFrontmatter(data)) {
    return null;
  }

  const stats = readingTime(content);

  return {
    slug,
    title: data.title,
    description: data.description,
    date: data.date,
    updated: typeof data.updated === 'string' ? data.updated : null,
    category: data.category,
    keywords: Array.isArray(data.keywords)
      ? (data.keywords as string[]) // gray-matter returns any[] — safe since MDX frontmatter is string[]
      : [],
    locale: data.locale,
    // Etykieta nadawcy = „Nailfolio" albo pierwsza osoba, NIGDY zespół i nigdy
    // imię założyciela (COPY_REGISTERS §Kto mówi, decyzja wiążąca). Fallback
    // wpisywał zakazany „Zespol Nailfolio" każdemu wpisowi bez pola `author`.
    author: typeof data.author === 'string' ? data.author : 'Nailfolio',
    coverImage: typeof data.coverImage === 'string' ? data.coverImage : '',
    ...(typeof data.coverImageAlt === 'string' && data.coverImageAlt.trim()
      ? { coverImageAlt: data.coverImageAlt }
      : {}),
    translationGroup: parseTranslationGroup(data.translationGroup),
    readingTime: Math.ceil(stats.minutes),
  };
}

export function getAllPosts(locale: string): BlogPost[] {
  if (!fs.existsSync(BLOG_CONTENT_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(BLOG_CONTENT_DIR)
    .filter(f => f.endsWith('.mdx'));

  const posts: BlogPost[] = [];

  for (const file of files) {
    const slug = file.replace(/\.mdx$/, '');
    const filePath = path.join(BLOG_CONTENT_DIR, file);
    const post = parseMdxFile(filePath, slug);

    if (post && post.locale === locale) {
      posts.push(post);
    }
  }

  // Sort by date descending (newest first)
  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return posts;
}

export function getPostBySlug(
  slug: string,
  locale: string
): BlogPostFull | null {
  if (slug.length > 120 || !BLOG_SLUG.test(slug)) {
    return null;
  }
  const filePath = path.join(BLOG_CONTENT_DIR, `${slug}.mdx`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);

  if (!isBlogPostFrontmatter(data)) {
    return null;
  }

  if (data.locale !== locale) {
    return null;
  }

  const stats = readingTime(content);

  return {
    slug,
    title: data.title,
    description: data.description,
    date: data.date,
    updated: typeof data.updated === 'string' ? data.updated : null,
    category: data.category,
    keywords: Array.isArray(data.keywords)
      ? (data.keywords as string[]) // gray-matter returns any[] — safe since MDX frontmatter is string[]
      : [],
    locale: data.locale,
    // Etykieta nadawcy = „Nailfolio" albo pierwsza osoba, NIGDY zespół i nigdy
    // imię założyciela (COPY_REGISTERS §Kto mówi, decyzja wiążąca). Fallback
    // wpisywał zakazany „Zespol Nailfolio" każdemu wpisowi bez pola `author`.
    author: typeof data.author === 'string' ? data.author : 'Nailfolio',
    coverImage: typeof data.coverImage === 'string' ? data.coverImage : '',
    ...(typeof data.coverImageAlt === 'string' && data.coverImageAlt.trim()
      ? { coverImageAlt: data.coverImageAlt }
      : {}),
    translationGroup: parseTranslationGroup(data.translationGroup),
    readingTime: Math.ceil(stats.minutes),
    content: resolveSessionExpiryText(content),
  };
}

export function getPostsByCategory(
  category: BlogCategory,
  locale: string
): BlogPost[] {
  return getAllPosts(locale).filter(post => post.category === category);
}

/**
 * Locales in which at least one post exists (optionally: in one category).
 *
 * Blog content is authored per locale (`locale` in frontmatter), and today every
 * post is Polish. Pages feed this into `PublicSeoHead.availableLocales`, because
 * advertising `hreflang="en"` for a URL that 404s is a broken hreflang cluster in
 * Google's eyes — which is exactly what shipped when the blog went live.
 */
export function getLocalesWithPosts(category?: BlogCategory): LocaleType[] {
  return I18N_CONFIG.locales.filter(locale =>
    category
      ? getPostsByCategory(category, locale).length > 0
      : getAllPosts(locale).length > 0
  );
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(BLOG_CONTENT_DIR)) {
    return [];
  }

  return fs
    .readdirSync(BLOG_CONTENT_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(f => f.replace(/\.mdx$/, ''));
}
