// Prose only: the old code built `${DOMAIN}/blog/${slug}/` by hand, which
// dropped the locale prefix. A comment naming the rule must not trip it.
const blogPostUrl = (locale: string, slug: string): string => locale + slug;

export const url = blogPostUrl('en', 'a');
