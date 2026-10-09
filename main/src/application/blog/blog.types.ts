import type { BlogCategory } from '../../content/blog/categories.config';

export type BlogPostFrontmatter = {
  title: string;
  description: string;
  date: string;
  /** Last substantive revision (YYYY-MM-DD). null = never revised; JSON-LD
   *  dateModified and the sitemap lastmod fall back to `date`. null rather than
   *  optional because getStaticProps cannot serialize `undefined`. */
  updated: string | null;
  category: BlogCategory;
  keywords: string[];
  locale: string;
  author: string;
  coverImage: string;
};

export type BlogPost = BlogPostFrontmatter & {
  slug: string;
  readingTime: number;
};

export type BlogPostFull = BlogPost & {
  content: string;
};
