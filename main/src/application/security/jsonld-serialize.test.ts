import { describe, expect, it } from 'vitest';
import { serializeJsonLd } from './jsonld-serialize';

describe('serializeJsonLd — safe inside <script type="application/ld+json">', () => {
  const payload = {
    image: 'https://x/a</script><script>alert(1)</script>.jpg',
    name: 'A & B > C',
    note: 'line sep end',
  };

  it('never emits a raw <, > or & (no way to close the script block)', () => {
    const html = serializeJsonLd(payload);
    expect(html).not.toMatch(/[<>&]/);
    expect(html).not.toContain('</script');
  });

  it('parses back to exactly the same values', () => {
    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload);
  });
});
