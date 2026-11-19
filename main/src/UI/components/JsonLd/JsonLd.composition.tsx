import Head from 'next/head';
import { serializeJsonLd } from '../../../application/security/jsonld-serialize';

// DECISION: `data` accepts any JSON-serializable structure (`unknown`): schema.org payloads mix
// arrays, nested objects and primitives, and demanding `Record<string, unknown>` forced 28+ call
// sites into `as unknown as Record<string, unknown>` casts. JSON.stringify gives the canonical
// serialization; readonly arrays (e.g. ItemListElement) are still flattened into a sequence of
// <script> tags.
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
