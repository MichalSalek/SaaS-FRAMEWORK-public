import Head from 'next/head';
import { AppLinkAtom as Link } from '../../UI/components/AppLink/AppLink.atom';
import type { GetStaticProps } from 'next';
import type { CSSProperties } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { ARE_DEV_ROUTES_ENABLED } from '../../application/environment/environment.possibilities.api';

/**
 * /dev/api — mapa API dla architekta. Endpointy pogrupowane wg domen (plików
 * .dto.ts); kontrakt (przyjmuje/zwraca) ZWINIĘTY domyślnie, rozwijany na klik.
 * Spec (OpenAPI 3.1) produkuje scripts/gen-openapi.ts z DTO-SSOT. Render natywny
 * (zero zależności, floor 7×ZERO). Dev-only + staging, noindex — na prod 404.
 */

interface Schema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  oneOf?: Schema[];
  additionalProperties?: Schema | boolean;
  description?: string;
}
interface Operation {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema: Schema;
    description?: string;
  }>;
  requestBody?: { content: { 'application/json': { schema: Schema } } };
  responses: Record<
    string,
    {
      description?: string;
      content?: { 'application/json': { schema: Schema } };
    }
  >;
}
interface Tag {
  name: string;
  description?: string;
}
interface Spec {
  info: { title: string; version: string; description?: string };
  tags?: Tag[];
  paths: Record<string, Record<string, Operation>>;
}
interface Props {
  spec: Spec;
}

const METHOD_TONE: Record<string, { background: string; color: string }> = {
  get: {
    background:
      'color-mix(in oklch, var(--color-success) 12%, var(--color-bg-paper))',
    color: 'var(--color-success-fg)',
  },
  post: {
    background:
      'color-mix(in oklch, var(--color-warning) 12%, var(--color-bg-paper))',
    color: 'var(--color-warning-fg)',
  },
  put: {
    background:
      'color-mix(in oklch, var(--color-info) 12%, var(--color-bg-paper))',
    color: 'var(--color-info-fg)',
  },
  patch: {
    background:
      'color-mix(in oklch, var(--color-info) 12%, var(--color-bg-paper))',
    color: 'var(--color-info-fg)',
  },
  delete: {
    background:
      'color-mix(in oklch, var(--color-error) 12%, var(--color-bg-paper))',
    color: 'var(--color-error-fg)',
  },
};
const METHOD_TONE_FALLBACK = {
  background: 'var(--color-surface-input)',
  color: 'var(--color-text-muted)',
};

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function typeLabel(s: Schema | undefined): string {
  if (!s) {
    return 'any';
  }
  if (s.enum) {
    const vals = s.enum.map(v => JSON.stringify(v)).join(', ');
    return vals.length > 48 ? `enum (${s.enum.length})` : `enum ${vals}`;
  }
  if (s.oneOf) {
    return `oneOf (${s.oneOf.length})`;
  }
  if (s.type === 'array') {
    return `array<${typeLabel(s.items)}>`;
  }
  if (Array.isArray(s.type)) {
    return s.type.join(' | ');
  }
  if (s.type === 'object') {
    return 'object';
  }
  return s.type ?? 'any';
}

interface Field {
  name: string;
  type: string;
  required: boolean;
  description?: string | undefined;
}
function fieldsOf(schema: Schema | undefined): Field[] | null {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return null;
  }
  const req = schema.required ?? [];
  return Object.entries(schema.properties).map(([name, sub]) => ({
    name,
    type: typeLabel(sub),
    required: req.includes(name),
    description: sub.description,
  }));
}

interface Row {
  path: string;
  method: string;
  op: Operation;
}
interface Group {
  tag: string;
  file: string;
  rows: Row[];
}

const MONO = 'var(--font-mono)';
const S = {
  page: {
    background: 'var(--color-bg-main)',
    color: 'var(--color-text-primary)',
    minHeight: '100vh',
    fontFamily: 'var(--font-body)',
    padding: 'clamp(var(--space-28), 6vw, var(--space-72))',
  } satisfies CSSProperties,
  back: {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-muted)',
    textDecoration: 'none',
    display: 'inline-block',
    marginBottom: 'var(--space-20)',
  } satisfies CSSProperties,
  kicker: {
    fontFamily: 'var(--style-kicker-font)',
    fontSize: 'var(--style-kicker-size)',
    fontWeight: 'var(--style-kicker-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--style-kicker-tracking)',
    textTransform: 'var(--style-kicker-case)' as CSSProperties['textTransform'],
    color: 'var(--color-accent-fg)',
    marginBottom: 'var(--space-12)',
  } satisfies CSSProperties,
  h1: {
    fontFamily: 'var(--style-heading-font)',
    fontSize: 'var(--text-fluid-xl)',
    fontWeight: 'var(--style-heading-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--style-heading-tracking)',
    margin: '0 0 var(--space-10)',
  } satisfies CSSProperties,
  sub: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-base)',
    maxWidth: '68ch',
    margin: '0 0 var(--space-6)',
    lineHeight: 'var(--leading-body)',
  } satisfies CSSProperties,
  regen: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    margin: '0 0 var(--space-32)',
  } satisfies CSSProperties,
  // ── Mapa domen (widok z góry) ──
  overview: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
    gap: 'var(--space-12)',
    maxWidth: 1040,
    marginBottom: 'var(--space-8)',
  } satisfies CSSProperties,
  ovCard: {
    display: 'block',
    background: 'var(--color-surface-card)',
    border: 'var(--style-border-surface) solid var(--color-border)',
    borderRadius: 'var(--style-radius-surface)',
    padding: 'var(--space-14) var(--space-16)',
    textDecoration: 'none',
    color: 'inherit',
  } satisfies CSSProperties,
  ovLabel: {
    fontFamily: 'var(--style-heading-font)',
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--style-heading-weight)' as CSSProperties['fontWeight'],
    color: 'var(--color-text-primary)',
    margin: 0,
  } satisfies CSSProperties,
  ovFile: {
    fontFamily: MONO,
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-muted)',
    margin: 'var(--space-4) 0 0',
    overflowWrap: 'anywhere' as const,
  } satisfies CSSProperties,
  ovMeta: {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-tertiary)',
    marginTop: 'var(--space-8)',
  } satisfies CSSProperties,
  // ── Sekcja domeny ──
  section: {
    maxWidth: 1040,
    paddingTop: 'var(--space-28)',
    marginTop: 'var(--space-20)',
    borderTop: 'var(--style-border-divider) solid var(--color-divider)',
  } satisfies CSSProperties,
  domainH: {
    fontFamily: 'var(--style-heading-font)',
    fontSize: 'var(--text-fluid-panel-title)',
    fontWeight: 'var(--style-heading-weight)' as CSSProperties['fontWeight'],
    color: 'var(--color-text-primary)',
    margin: '0 0 var(--space-4)',
    letterSpacing: 'var(--style-heading-tracking)',
  } satisfies CSSProperties,
  domainFile: {
    fontFamily: MONO,
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-tertiary)',
    margin: '0 0 var(--space-16)',
    overflowWrap: 'anywhere' as const,
  } satisfies CSSProperties,
  // ── Wiersz endpointu (details, zwinięty) ──
  row: {
    background: 'var(--color-surface-card)',
    border: 'var(--style-border-surface) solid var(--color-border)',
    borderRadius: 'var(--style-radius-surface)',
    marginBottom: 'var(--space-10)',
    overflow: 'hidden',
  } satisfies CSSProperties,
  rowSummary: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    columnGap: 'var(--space-20)',
    rowGap: 'var(--space-6)',
    padding: 'var(--space-14) var(--space-16)',
    cursor: 'pointer',
    listStyle: 'none',
  } satisfies CSSProperties,
  // Lewa kolumna (chip + ścieżka) o STAŁEJ szerokości = najdłuższa ścieżka + chip;
  // flexBasis wstrzykiwany per-render (patrz leftCol). Dzięki temu opisy w prawej
  // kolumnie startują na jednej pionowej linii (najdłuższa ścieżka + columnGap 20px).
  rowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  chip: {
    fontFamily: MONO,
    fontSize: 'var(--style-label-size)',
    fontWeight: 'var(--style-label-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--style-label-tracking)',
    padding: 'var(--space-4) var(--space-10)',
    borderRadius: 'var(--style-radius-pill)',
    flexShrink: 0,
  } satisfies CSSProperties,
  path: {
    fontFamily: MONO,
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-primary)',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  rowText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 260,
    minWidth: 0,
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-base)',
    lineHeight: 'var(--leading-body)',
  } satisfies CSSProperties,
  // ── Rozwinięta zawartość ──
  body: {
    padding: '0 var(--space-16) var(--space-20)',
    borderTop: 'var(--style-border-divider) solid var(--color-divider)',
  } satisfies CSSProperties,
  desc: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-base)',
    lineHeight: 'var(--leading-body)',
    margin: 'var(--space-14) 0 var(--space-4)',
  } satisfies CSSProperties,
  sectionLabel: {
    fontFamily: 'var(--style-label-font)',
    fontSize: 'var(--style-label-size)',
    fontWeight: 'var(--style-label-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--style-label-tracking)',
    textTransform: 'var(--style-label-case)' as CSSProperties['textTransform'],
    color: 'var(--color-accent-fg)',
    margin: 'var(--space-16) 0 var(--space-8)',
  } satisfies CSSProperties,
  empty: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    fontStyle: 'italic' as const,
  } satisfies CSSProperties,
  tableWrap: { overflowX: 'auto' as const } satisfies CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 'var(--text-base)',
  } satisfies CSSProperties,
  th: {
    textAlign: 'left' as const,
    fontFamily: 'var(--style-label-font)',
    color: 'var(--color-text-tertiary)',
    fontWeight: 'var(--style-label-weight)' as CSSProperties['fontWeight'],
    padding: 'var(--space-4) var(--space-12) var(--space-8) 0',
    borderBottom: 'var(--style-border-divider) solid var(--color-border)',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  td: {
    padding: 'var(--space-8) var(--space-12) var(--space-8) 0',
    borderBottom: 'var(--style-border-divider) solid var(--color-divider)',
    verticalAlign: 'top' as const,
  } satisfies CSSProperties,
  fname: {
    fontFamily: MONO,
    color: 'var(--color-text-primary)',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  ftype: {
    fontFamily: MONO,
    color: 'var(--color-info-fg)',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  fdesc: {
    color: 'var(--color-text-secondary)',
    lineHeight: 'var(--leading-body)',
  } satisfies CSSProperties,
  reqYes: {
    color: 'var(--color-warning-fg)',
    fontSize: 'var(--text-base)',
  } satisfies CSSProperties,
  reqNo: {
    color: 'var(--color-text-disabled)',
    fontSize: 'var(--text-base)',
  } satisfies CSSProperties,
  rawToggle: {
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    marginTop: 'var(--space-16)',
  } satisfies CSSProperties,
  pre: {
    background: 'var(--color-surface-input)',
    border: 'var(--style-border-surface) solid var(--color-border)',
    borderRadius: 'var(--style-radius-surface)',
    padding: 'var(--space-14)',
    overflowX: 'auto' as const,
    fontSize: 'var(--text-base)',
    lineHeight: 'var(--leading-body)',
    color: 'var(--color-text-secondary)',
    marginTop: 'var(--space-10)',
  } satisfies CSSProperties,
};

function FieldTable({ fields }: { fields: Field[] }) {
  return (
    <div style={S.tableWrap}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Pole</th>
            <th style={S.th}>Typ</th>
            <th style={S.th}>Wymagane</th>
            <th style={S.th}>Opis</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(f => (
            <tr key={f.name}>
              <td style={{ ...S.td, ...S.fname }}>{f.name}</td>
              <td style={{ ...S.td, ...S.ftype }}>{f.type}</td>
              <td style={S.td}>
                <span style={f.required ? S.reqYes : S.reqNo}>
                  {f.required ? 'tak' : 'nie'}
                </span>
              </td>
              <td style={{ ...S.td, ...S.fdesc }}>{f.description ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointRow({ path, method, op, leftCol }: Row & { leftCol: number }) {
  const reqSchema = op.requestBody?.content['application/json'].schema;
  const params = op.parameters;
  const resSchema = op.responses['200']?.content?.['application/json'].schema;
  const errSchema = op.responses['4XX']?.content?.['application/json'].schema;
  const reqFields = fieldsOf(reqSchema);
  const resFields = fieldsOf(resSchema);
  const longer = op.description != null && op.description !== op.summary;

  return (
    <details style={S.row}>
      <summary style={S.rowSummary}>
        <span style={{ ...S.rowLeft, flexBasis: leftCol }}>
          <span
            style={{
              ...S.chip,
              ...(METHOD_TONE[method] ?? METHOD_TONE_FALLBACK),
            }}>
            {method.toUpperCase()}
          </span>
          <span style={S.path}>{path}</span>
        </span>
        <span style={S.rowText}>{op.summary}</span>
      </summary>
      <div style={S.body}>
        {longer && <p style={S.desc}>{op.description}</p>}

        <div style={S.sectionLabel}>Przyjmuje{params ? ' (query)' : ''}</div>
        {params ? (
          <FieldTable
            fields={params.map(p => ({
              name: p.name,
              type: typeLabel(p.schema),
              required: Boolean(p.required),
              description: p.description,
            }))}
          />
        ) : reqFields ? (
          <FieldTable fields={reqFields} />
        ) : (
          <div style={S.empty}>— bez treści żądania</div>
        )}

        <div style={S.sectionLabel}>Zwraca: 200</div>
        {resFields ? (
          <FieldTable fields={resFields} />
        ) : (
          <div style={S.empty}>{typeLabel(resSchema)}</div>
        )}

        <details>
          <summary style={S.rawToggle}>
            Pełny schemat (request, response, error)
          </summary>
          <pre style={S.pre}>
            {JSON.stringify(
              {
                request: reqSchema ?? params ?? null,
                response: resSchema ?? null,
                error: errSchema ?? null,
              },
              null,
              2
            )}
          </pre>
        </details>
      </div>
    </details>
  );
}

function methodMix(rows: Row[]): string {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.method] = (counts[r.method] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([m, n]) => `${n} ${m.toUpperCase()}`)
    .join(', ');
}

export default function DevApiDocs({ spec }: Props) {
  const fileByTag = new Map<string, string>();
  for (const t of spec.tags ?? []) {
    fileByTag.set(t.name, t.description ?? '');
  }

  const groups: Group[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? 'inne';
      let group = groups.find(g => g.tag === tag);
      if (!group) {
        group = { tag, file: fileByTag.get(tag) ?? '', rows: [] };
        groups.push(group);
      }
      group.rows.push({ path, method, op });
    }
  }
  const totalEndpoints = groups.reduce((n, g) => n + g.rows.length, 0);
  // Stała szerokość lewej kolumny = najdłuższa ścieżka (mono ~9.7px/znak) + chip/gap,
  // liczona globalnie (nie per-domena), by opisy w KAŻDYM wierszu całej strony
  // startowały na jednej pionowej linii (najdłuższa ścieżka + columnGap 20px).
  const maxPathLen = groups.reduce(
    (m, g) => g.rows.reduce((mm, r) => Math.max(mm, r.path.length), m),
    0
  );
  const leftCol = Math.round(maxPathLen * 9.7 + 66);

  return (
    <>
      <Head>
        <title>Dev — mapa API</title>
        <meta name='robots' content='noindex,nofollow' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </Head>
      <div style={S.page}>
        <Link href='/dev' style={S.back}>
          ← /dev
        </Link>
        <div style={S.kicker}>SaaS-FRAMEWORK: dev, mapa api</div>
        <h1 style={S.h1}>{spec.info.title}</h1>
        <p style={S.sub}>{spec.info.description}</p>
        <p style={S.regen}>
          {groups.length} domen, {totalEndpoints} endpointów, regeneracja:{' '}
          <code style={{ fontFamily: MONO }}>npm run dev:gen-openapi</code>
        </p>

        <div style={S.overview}>
          {groups.map(g => (
            <a key={g.tag} href={`#${slug(g.tag)}`} style={S.ovCard}>
              <p style={S.ovLabel}>{g.tag}</p>
              <p style={S.ovFile}>{g.file.split(', ')[0]}</p>
              <div style={S.ovMeta}>
                {g.rows.length} endpointów: {methodMix(g.rows)}
              </div>
            </a>
          ))}
        </div>

        {groups.map(g => (
          <section key={g.tag} id={slug(g.tag)} style={S.section}>
            <h2 style={S.domainH}>{g.tag}</h2>
            <p style={S.domainFile}>{g.file}</p>
            {g.rows.map(r => (
              <EndpointRow
                key={r.op.operationId}
                path={r.path}
                method={r.method}
                op={r.op}
                leftCol={leftCol}
              />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export const getStaticProps: GetStaticProps<Props> = async ({ locale }) => {
  if (!ARE_DEV_ROUTES_ENABLED()) {
    return { notFound: true };
  }
  const resolved = locale ?? 'pl';
  const messages = await getI18nMessages(resolved);
  const specPath = join(
    process.cwd(),
    'src/application/api-docs/openapi.generated.json'
  );
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Spec;
  return { props: { messages, spec } };
};
