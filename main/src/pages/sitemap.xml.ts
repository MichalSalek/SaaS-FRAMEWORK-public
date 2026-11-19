import type { GetServerSideProps } from 'next';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';

const DOMAIN = SEO_CONFIG.domain;

function generateSitemapIndex() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${DOMAIN}/sitemap-static.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${DOMAIN}/sitemap-profiles.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${DOMAIN}/sitemap-blog.xml</loc>
  </sitemap>
</sitemapindex>`;
}

function SitemapIndex() {
  // getServerSideProps will handle response
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const sitemapIndex = generateSitemapIndex();

  res.setHeader('Content-Type', 'text/xml');
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=86400, stale-while-revalidate=43200'
  );
  res.write(sitemapIndex);
  res.end();

  return {
    props: {},
  };
};

export default SitemapIndex;
