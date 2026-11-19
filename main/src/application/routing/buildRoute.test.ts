import { describe, it, expect } from 'vitest';
import { buildRoute } from './buildRoute';

describe('buildRoute', () => {
  it('substitutes a single param', () => {
    expect(buildRoute('/app/gallery/[id]', { id: '123' })).toBe(
      '/app/gallery/123'
    );
  });

  it('substitutes multiple params', () => {
    expect(buildRoute('/app/[type]/[id]', { type: 'photo', id: '5' })).toBe(
      '/app/photo/5'
    );
  });

  it('returns template unchanged when there are no params', () => {
    expect(buildRoute('/app/gallery')).toBe('/app/gallery');
  });

  it('returns template unchanged when empty params object passed', () => {
    expect(buildRoute('/app/gallery', {})).toBe('/app/gallery');
  });

  it('URL-encodes param values with special characters', () => {
    expect(
      buildRoute('/stylist/[identifier]', { identifier: 'anna kowal' })
    ).toBe('/stylist/anna%20kowal');
  });

  it('handles nested path param templates from ROUTES_FRONT', () => {
    expect(buildRoute('/blog/[slug]', { slug: 'hello-world' })).toBe(
      '/blog/hello-world'
    );
  });

  it('handles support thread template', () => {
    expect(
      buildRoute('/app/user/support/[threadId]', { threadId: 'abc-123' })
    ).toBe('/app/user/support/abc-123');
  });

  it('handles blog category template', () => {
    expect(
      buildRoute('/blog/category/[category]', { category: 'trends' })
    ).toBe('/blog/category/trends');
  });
});
