const DOMAIN = 'https://example.test';
const blogPostUrl = (locale: string, slug: string): string => locale + slug;

export const good = blogPostUrl('en', 'a');
export const bad = (slug: string): string => `${DOMAIN}/blog/${slug}/`;
