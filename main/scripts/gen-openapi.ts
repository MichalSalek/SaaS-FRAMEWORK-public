/**
 * gen-openapi — generator dokumentacji API z DTO-SSOT (wszystkie 18 domen).
 *
 * Czyta kontrakt PROSTO ze źródła prawdy (bez adnotacji, bez utrzymania):
 *   1. Typy   — `*_DTO_API_V1` w @kernel/models/**  (REQUEST / RESPONSE / RESPONSE_ERROR)
 *   2. Ścieżka — ROUTES_API        w @kernel/domain/routing/routing.config
 *   3. Metoda  — API_HTTP_METHODS  w @kernel/domain/http/http-methods.config
 * Złączenie po WSPÓLNYM kluczu operacji = CZYSTA RÓWNOŚĆ (klucz DTO op === ROUTES_API
 * key === API_HTTP_METHODS key; konwencja AGENTS.md). Bez prefix-fallbacku; jedyny
 * wyjątek to jawny ROUTE_KEY_ALIASES (op współdzielący endpoint, np. SALON_STAFF).
 * Emituje OpenAPI 3.1 do src/application/api-docs/openapi.generated.json (artefakt do
 * renderu widoku architekta — Scalar/Redoc + natywne /dev/api), a NIE kontrakt gotowy
 * pod codegen/Postman: kody sukcesu są indykatywne (patrz niżej), nie per-op wierne.
 *
 * OGRANICZENIE (kody statusu): każda operacja jest dokumentowana jako 200 OK, choć część
 * komend zwraca 201 Created (`respondCreated` w web-1). Sygnał created/ok żyje wyłącznie
 * w kodzie handlera (web-1), poza SSOT tego generatora (kernel: DTO + ROUTES_API +
 * API_HTTP_METHODS — żaden nie koduje kodu sukcesu), więc świadomie ich nie różnicujemy.
 *
 * Uruchomienie (z katalogu main/):  npm run dev:gen-openapi
 *
 * Zero driftu: audyty tests/audit/{endpoint,dto}-completeness.sh wymuszają spójność
 * routing ↔ methods ↔ handler ↔ models po równości klucza, więc ten generator czyta
 * gwarantowany SSOT.
 */
import * as ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = resolve(HERE, '..');
const KERNEL = resolve(MAIN_ROOT, 'src/READONLY-shared-kernel');

// ── Zasięg AUTO-DISKOWANY: każdy plik models/**/*.dto.ts z typem `*_DTO_API_V1`
// staje się domeną. Nowa domena (nowy plik .dto.ts) pojawia się SAMA po regen —
// zero listy do utrzymania. Join operacji = czysta równość (klucz DTO op ===
// ROUTES_API key === API_HTTP_METHODS key; konwencja AGENTS.md, strażnik dto-
// completeness), z jawnym ROUTE_KEY_ALIASES dla op współdzielących endpoint.
// LABELS = ładne PL etykiety; nowa domena bez wpisu → humanize(prefix).
const LABELS: Record<string, string> = {
  ACCOUNT: 'Konto', ADMIN: 'Administracja', CLIENT: 'Klient', EMAIL: 'E-mail',
  EVENT_LOG: 'Dziennik zdarzeń', FAVORITE: 'Ulubione', GALLERY: 'Galeria',
  MODERATION: 'Moderacja', NEWSLETTER: 'Newsletter', PAIRING: 'Parowanie (QR)',
  PRICING: 'Cennik', PUBLIC: 'Publiczne', SALON_STAFF: 'Zespół salonu',
  SESSION_CONTAINER: 'Sesje zdjęciowe', SESSION: 'Sesje (auth)', SUPPORT: 'Wsparcie',
  USER: 'Użytkownik', VISIT: 'Wizyty',
};

type Domain = { tag: string; label: string; dtoType: string; file: string };

function walkDtoFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkDtoFiles(p));
    else if (entry.endsWith('.dto.ts') && !entry.startsWith('db_models')) out.push(p);
  }
  return out;
}

function discoverDomains(): Domain[] {
  const domains: Domain[] = [];
  for (const file of walkDtoFiles(resolve(KERNEL, 'models'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/export type ([A-Z_]+_DTO_API_V1)\b/g)) {
      const dtoType = m[1];
      const prefix = dtoType.replace(/_DTO_API_V1$/, '');
      domains.push({
        tag: prefix.toLowerCase().replace(/_/g, '-'),
        label: LABELS[prefix] ?? humanize(prefix),
        dtoType,
        file,
      });
    }
  }
  // Deterministyczny porządek (bez Date/random) — alfabetycznie po tagu.
  return domains.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

const DOMAINS: Domain[] = discoverDomains();

// Op współdzielące endpoint innego op (1-trasa/N-op) — jawny alias route-key (mirror
// ROUTE_ALIASES z http.endpoints.ts). NIE prefix-fallback — deterministyczna równość.
const ROUTE_KEY_ALIASES: Record<string, string> = {
  SALON_STAFF_INVITE: 'SALON_STAFF',
  SALON_STAFF_GET_ALL: 'SALON_STAFF',
};
// Op bez własnego endpointu /api/v1 (placeholder trzymający inwariant event↔DTO):
// USER_LOGOUT = logout out-of-band (Better Auth) → nie dokumentowany jako endpoint.
const SKIP_OPS = new Set<string>(['USER_LOGOUT']);

// OPENAPI_OUT override → strażnik świeżości (openapi-fresh.sh) regeneruje do TEMP
// i diffuje z committed, nie mutując artefaktu (wzorzec jak dto-completeness --out).
const OUT_FILE = process.env.OPENAPI_OUT ?? resolve(MAIN_ROOT, 'src/application/api-docs/openapi.generated.json');

type JsonSchema = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// TS Type → JSON Schema (Compiler API rozwiązuje Pick<>/indexed-access/unie za nas)
// ─────────────────────────────────────────────────────────────────────────────
function makeConverter(checker: ts.TypeChecker) {
  function isUndefinedLike(t: ts.Type): boolean {
    return (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;
  }
  function isNullLike(t: ts.Type): boolean {
    return (t.flags & ts.TypeFlags.Null) !== 0;
  }

  function convert(type: ts.Type, depth = 0): JsonSchema {
    if (depth > 10) return {};

    // Prymitywy
    if (type.flags & ts.TypeFlags.StringLiteral)
      return { type: 'string', enum: [(type as ts.StringLiteralType).value] };
    if (type.flags & ts.TypeFlags.NumberLiteral)
      return { type: 'number', enum: [(type as ts.NumberLiteralType).value] };
    if (type.flags & (ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Boolean))
      return { type: 'boolean' };
    if (type.flags & ts.TypeFlags.String) return { type: 'string' };
    if (type.flags & ts.TypeFlags.Number) return { type: 'number' };
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};

    // Tablice
    if (checker.isArrayType(type)) {
      const el = checker.getTypeArguments(type as ts.TypeReference)[0];
      return { type: 'array', items: el ? convert(el, depth + 1) : {} };
    }

    // Unie (w tym `X | null`, `X | undefined`, unie literałów, oneOf obiektów)
    if (type.isUnion()) {
      const parts = type.types.filter(t => !isUndefinedLike(t) && !isNullLike(t));
      const nullable = type.types.some(isNullLike);

      if (parts.length && parts.every(t => t.flags & ts.TypeFlags.StringLiteral))
        return withNull(
          { type: 'string', enum: parts.map(t => (t as ts.StringLiteralType).value) },
          nullable,
        );
      if (parts.length && parts.every(t => t.flags & ts.TypeFlags.NumberLiteral))
        return withNull(
          { type: 'number', enum: parts.map(t => (t as ts.NumberLiteralType).value) },
          nullable,
        );
      if (parts.length === 1) return withNull(convert(parts[0], depth + 1), nullable);
      if (parts.length === 0) return nullable ? { type: 'null' } : {};
      return withNull({ oneOf: parts.map(t => convert(t, depth + 1)) }, nullable);
    }

    // Intersekcje (np. RESPONSE_ERROR = Record<keyof Req,string> & DetailedErrorGeneric)
    if (type.isIntersection()) {
      const merged: JsonSchema = { type: 'object', properties: {}, required: [] as string[] };
      for (const part of type.types) {
        const sub = convert(part, depth + 1);
        if (sub.type === 'object') {
          Object.assign(merged.properties as object, sub.properties ?? {});
          (merged.required as string[]).push(...((sub.required as string[]) ?? []));
          if (sub.additionalProperties) merged.additionalProperties = sub.additionalProperties;
        }
      }
      if (!(merged.required as string[]).length) delete merged.required;
      return merged;
    }

    // Obiekty
    if (type.flags & ts.TypeFlags.Object) {
      const props = type.getProperties();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const prop of props) {
        const decl = prop.valueDeclaration ?? prop.declarations?.[0];
        const propType = decl
          ? checker.getTypeOfSymbolAtLocation(prop, decl)
          : (checker as unknown as { getDeclaredTypeOfSymbol(s: ts.Symbol): ts.Type }).getDeclaredTypeOfSymbol(prop);
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
        const schema = convert(propType, depth + 1);
        const doc = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
        if (doc) schema.description = doc;
        properties[prop.name] = schema;
        if (!optional) required.push(prop.name);
      }

      const out: JsonSchema = { type: 'object', properties };
      if (required.length) out.required = required;

      const strIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String);
      if (strIndex) out.additionalProperties = convert(strIndex.type, depth + 1);
      return out;
    }

    return { description: checker.typeToString(type) };
  }

  return convert;
}

function withNull(schema: JsonSchema, nullable: boolean): JsonSchema {
  if (!nullable) return schema;
  if (schema.type && !schema.oneOf) return { ...schema, type: [schema.type, 'null'] };
  return { oneOf: [...((schema.oneOf as unknown[]) ?? [schema]), { type: 'null' }] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Program TS + ekstrakcja operacji z typu `*_DTO_API_V1`
// ─────────────────────────────────────────────────────────────────────────────
function loadOperations() {
  const program = ts.createProgram(
    DOMAINS.map(d => d.file),
    {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
  );
  const checker = program.getTypeChecker();
  const convert = makeConverter(checker);

  const byDomain: Record<
    string,
    Array<{
      op: string;
      summary: string;
      description: string | null;
      request: JsonSchema;
      response: JsonSchema;
      error: JsonSchema;
    }>
  > = {};

  for (const domain of DOMAINS) {
    const source = program.getSourceFile(domain.file);
    if (!source) throw new Error(`Nie wczytano źródła: ${domain.file}`);

    let aliasType: ts.Type | undefined;
    ts.forEachChild(source, node => {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === domain.dtoType
      ) {
        aliasType = checker.getTypeAtLocation(node.name);
      }
    });
    if (!aliasType) throw new Error(`Nie znaleziono typu ${domain.dtoType} w ${domain.file}`);

    const ops: Array<{
      op: string;
      summary: string;
      description: string | null;
      request: JsonSchema;
      response: JsonSchema;
      error: JsonSchema;
    }> = [];
    for (const opSymbol of aliasType.getProperties()) {
      const decl = opSymbol.valueDeclaration ?? opSymbol.declarations?.[0];
      if (!decl) continue;
      const opType = checker.getTypeOfSymbolAtLocation(opSymbol, decl);

      const member = (name: string): ts.Type | undefined => {
        const sym = opType.getProperty(name);
        const mdecl = sym?.valueDeclaration ?? sym?.declarations?.[0];
        return sym && mdecl ? checker.getTypeOfSymbolAtLocation(sym, mdecl) : undefined;
      };

      const reqType = member('REQUEST');
      const resType = member('RESPONSE');
      const errType = member('RESPONSE_ERROR');

      // Opis: JSDoc /** */, a jeśli brak — wiodące komentarze // nad operacją
      // (DTO trzyma sporo domenowego kontekstu w // — cenne dla widoku architekta).
      const jsdoc = ts.displayPartsToString(opSymbol.getDocumentationComment(checker)).trim();
      const raw = jsdoc || leadingComment(decl);
      const summary = raw ? firstLine(raw) : humanize(opSymbol.name);
      const description = raw && raw.length > summary.length ? collapse(raw) : null;

      ops.push({
        op: opSymbol.name,
        summary,
        description,
        request: reqType ? convert(reqType) : { description: 'brak (undefined)' },
        response: resType ? convert(resType) : {},
        error: errType ? convert(errType) : {},
      });
    }
    byDomain[domain.tag] = ops;
  }

  return byDomain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Złączenie z rejestrami ścieżki/metody + montaż OpenAPI 3.1
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const [{ ROUTES_API }, { API_HTTP_METHODS }] = await Promise.all([
    import(pathToFileURL(resolve(KERNEL, 'domain/routing/routing.config.ts')).href) as Promise<{ ROUTES_API: Record<string, string> }>,
    import(pathToFileURL(resolve(KERNEL, 'domain/http/http-methods.config.ts')).href) as Promise<{ API_HTTP_METHODS: Record<string, string> }>,
  ]);

  const byDomain = loadOperations();

  const paths: Record<string, Record<string, unknown>> = {};
  const missing: string[] = [];
  const domainCount: Record<string, number> = {};
  let mapped = 0;
  let total = 0;

  for (const domain of DOMAINS) {
    // Join po kluczu operacji = CZYSTA RÓWNOŚĆ (klucz DTO op === ROUTES_API key ===
    // API_HTTP_METHODS key; konwencja AGENTS.md, strażnik: audit dto-completeness).
    // Prefix-fallback usunięty po standaryzacji kluczy. Jedyny wyjątek to jawny
    // ROUTE_KEY_ALIASES (op współdzielący endpoint) — nadal deterministyczny.
    for (const entry of byDomain[domain.tag]) {
      if (SKIP_OPS.has(entry.op)) continue;
      total++;
      const routeKey = ROUTE_KEY_ALIASES[entry.op] ?? entry.op;
      const path = ROUTES_API[routeKey];
      const method = (API_HTTP_METHODS[entry.op] ?? '').toLowerCase();
      if (!path || !method) {
        missing.push(`${domain.tag}.${entry.op} (path=${path ?? '∅'} method=${method || '∅'})`);
        continue;
      }
      mapped++;
      domainCount[domain.label] = (domainCount[domain.label] ?? 0) + 1;

      const isGet = method === 'get';
      const hasReq = entry.request.type === 'object' && entry.request.properties;

      const operation: Record<string, unknown> = {
        operationId: entry.op,
        tags: [domain.label],
        summary: entry.summary || humanize(entry.op),
        ...(entry.description ? { description: entry.description } : {}),
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: entry.response } },
          },
          '4XX': {
            description: 'Błąd walidacji lub biznesowy',
            content: { 'application/json': { schema: entry.error } },
          },
        },
      };

      if (hasReq && isGet) {
        // GET z payloadem → parametry query
        const props = entry.request.properties as Record<string, JsonSchema>;
        const req = (entry.request.required as string[]) ?? [];
        operation.parameters = Object.entries(props).map(([name, schema]) => ({
          name,
          in: 'query',
          required: req.includes(name),
          schema,
          ...(schema.description ? { description: schema.description } : {}),
        }));
      } else if (hasReq) {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: entry.request } },
        };
      }

      paths[path] ??= {};
      // Fail-loud na kolizji path+method (R2): dwa op na ten sam endpoint+metodę =
      // cichy overwrite jednego z nich. Zwykle zły ROUTE_KEY_ALIAS albo metody.
      const clash = paths[path][method] as { operationId?: string } | undefined;
      if (clash) {
        throw new Error(
          `Kolizja OpenAPI: ${method.toUpperCase()} ${path} zmapowane dwukrotnie ` +
            `(${clash.operationId ?? '?'} vs ${entry.op}). Sprawdź ROUTE_KEY_ALIASES / metody.`,
        );
      }
      paths[path][method] = operation;
    }
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'nailfolio — mapa API',
      version: '1',
      description:
        'Widok architekta: endpointy pogrupowane wg domen (plików .dto.ts). ' +
        'Generowane z DTO-SSOT (@kernel/models/**) złączonego z ROUTES_API i API_HTTP_METHODS ' +
        'po równości klucza operacji — nie edytować ręcznie. Zasięg: wszystkie 18 domen. ' +
        'UWAGA: kody sukcesu są indykatywne — każda operacja pokazana jako 200 OK, choć część ' +
        'komend zwraca 201 Created; sygnał created/ok żyje w handlerze (web-1), poza tym SSOT.',
    },
    servers: [{ url: '/', description: 'same-origin (web-1 API)' }],
    // Grupy = pliki .dto.ts. description niesie ścieżkę źródła + licznik.
    tags: DOMAINS.map(d => ({
      name: d.label,
      description: `${d.file.replace(KERNEL + '/', '')}, ${domainCount[d.label] ?? 0} endpointów`,
    })),
    paths,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  console.log(`✓ OpenAPI: ${mapped}/${total} operacji zmapowanych → ${OUT_FILE.replace(MAIN_ROOT + '/', '')}`);
  // Fail-loud na nieoczekiwany missing (R1): op bez trasy/metody, który NIE jest
  // w SKIP_OPS ani ROUTE_KEY_ALIASES = realny rozjazd. Exit≠0 → strażnik
  // openapi-fresh (i każdy regen) pęka, zamiast po cichu gubić endpoint z mapy.
  if (missing.length) {
    console.error(`✗ ${missing.length} op bez trasy/metody (nie w SKIP_OPS/ROUTE_KEY_ALIASES):`);
    for (const m of missing) console.error(`   · ${m}`);
    console.error('  Dodaj klucz do ROUTES_API + API_HTTP_METHODS, albo wpis do SKIP_OPS/ROUTE_KEY_ALIASES.');
    process.exit(1);
  }
}

function humanize(op: string): string {
  return op
    .toLowerCase()
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Wiodące komentarze (// lub /* */) tuż nad deklaracją operacji → czysty tekst.
function leadingComment(decl: ts.Node): string {
  const sf = decl.getSourceFile();
  const full = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(full, decl.getFullStart()) ?? [];
  return ranges
    .map(r => full.slice(r.pos, r.end))
    .join('\n')
    .replace(/\/\*+|\*+\//g, '')
    .replace(/^\s*\/\/ ?/gm, '')
    .replace(/^\s*\* ?/gm, '')
    .trim();
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstLine(text: string): string {
  const flat = collapse(text);
  // Pierwsze zdanie: granica = . ! ? + spacja + WIELKA litera (prawdziwy koniec
  // zdania). NIE tniemy na ':' (wprowadza treść, np. „Widok admina: …") ani na
  // skrótach („art. 17", „np.") — bez wielkiej litery po kropce nie ma splitu.
  const m = flat.match(/^(.+?[.!?])\s+\p{Lu}/u);
  const sentence = m ? m[1] : flat;
  return sentence.length > 160 ? sentence.slice(0, 159).trimEnd() + '…' : sentence;
}

main().catch(err => {
  console.error('✗ gen-openapi:', err);
  process.exit(1);
});
