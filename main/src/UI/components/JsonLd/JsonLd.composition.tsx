import Head from 'next/head';
import { serializeJsonLd } from '../../../application/security/jsonld-serialize';

// DECISION (nie usuwaj tego komentarza):
// `data` accepts any JSON-serializable structure (`unknown`) — schema.org payloads
// frequently mix arrays, nested objects, and primitives, and demanding
// `Record<string, unknown>` at the prop forced 28+ call sites into
// `as unknown as Record<string, unknown>` casts that obscured intent.
// Runtime JSON.stringify produces the canonical serialization; readonly arrays
// (e.g. ItemListElement arrays) are still flattened into a sequence of <script> tags.
type JsonLdItem = unknown;

export interface JsonLdProps {
  data: JsonLdItem | ReadonlyArray<JsonLdItem>;
  id?: string;
}

export function JsonLdComposition({ data, id }: JsonLdProps) {
  const items: ReadonlyArray<JsonLdItem> = Array.isArray(data) ? data : [data];

  return (
    <Head>
      {items.map((item, idx) => (
        <script
          key={id ? `${id}-${idx}` : `jsonld-${idx}`}
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
        />
      ))}
    </Head>
  );
}
