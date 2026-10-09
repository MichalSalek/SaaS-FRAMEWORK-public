import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import readingTime from 'reading-time';
import type { BlogPost, BlogPostFrontmatter, BlogPostFull } from './blog.types';
import type { BlogCategory } from '../../content/blog/categories.config';
import { BLOG_CATEGORIES } from '../../content/blog/categories.config';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';

const BLOG_CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'blog');

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
    readingTime: Math.ceil(stats.minutes),
    content,
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
