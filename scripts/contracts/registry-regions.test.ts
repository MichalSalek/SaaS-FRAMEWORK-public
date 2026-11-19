// Run: npm run test:contracts-generator (also run by audit:generated-fresh).
import './operation-census.test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientDeleteCrmNoteSchema as clientDeleteFromClient,
  clientUpsertCrmNoteSchema as clientCrmFromClient,
  clientUpsertImportantNoteSchema as clientImportantFromClient,
} from '../../.shared-kernel/domain/client/client.contract-schemas';
import {
  clientDeleteCrmNoteSchema as clientDeleteFromVisit,
  clientUpsertCrmNoteSchema as clientCrmFromVisit,
  clientUpsertImportantNoteSchema as clientImportantFromVisit,
} from '../../.shared-kernel/domain/visit/crm-note.schemas';
import {
  applyGeneratedChanges,
  extractContractManual,
  fillRegions,
  findIllegalContracts,
  quoteContractSummary,
} from './registry-regions';
import {
  QUERY_FIELD,
  decodeQueryFields,
  type QueryClientInput,
  type QueryField,
} from '../../.shared-kernel/application/contracts/query-fields';

type RequiredId = QueryField<string, string | undefined> & {
  readonly required: true;
};
type OptionalQ = QueryField<string, string | undefined>;
type RequiredInput = QueryClientInput<{ id: RequiredId; q: OptionalQ }>;
type Expect<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

/** Client input: `id` is mandatory, `q` is optional. A missing required key does not type-check. */
export type QueryRequirednessProof = [
  Expect<Extends<{ id: string }, RequiredInput>>,
  Expect<Extends<{ id: string; q?: string }, RequiredInput>>,
  Expect<Extends<{ q: string }, RequiredInput> extends true ? false : true>,
  Expect<Extends<{ id?: string }, RequiredInput> extends true ? false : true>,
];

const FILE = [
  'export const CLIENT = [',
  '  APP_EVENTS.QUERIES.PAIRING.OTHER,',
  '  // <generated:contracts:grants:CLIENT> from the API contracts; do not edit',
  '  APP_EVENTS.COMMANDS.FAVORITE.STALE,',
  '  // </generated:contracts:grants:CLIENT>',
  '];',
].join('\n');
const regions = new Map([
  ['grants:CLIENT', ['APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_ADD_RECORD,']],
]);
const grant = /APP_EVENTS\.COMMANDS\.FAVORITE\.FAVORITE_ADD_RECORD\b/;

test('a region is rewritten with the generated lines and its indentation', () => {
  const { text, problems } = fillRegions('f.ts', FILE, regions, [grant]);
  assert.deepEqual(problems, []);
  assert.match(
    text,
    /\n {2}APP_EVENTS\.COMMANDS\.FAVORITE\.FAVORITE_ADD_RECORD,\n/
  );
  assert.doesNotMatch(text, /STALE/);
});

test('a contract grant written by hand outside its region fails', () => {
  const handGrant = FILE.replace(
    '  APP_EVENTS.QUERIES.PAIRING.OTHER,',
    '  APP_EVENTS.QUERIES.PAIRING.OTHER,\n  APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_ADD_RECORD,'
  );
  const { problems } = fillRegions('f.ts', handGrant, regions, [grant]);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /f\.ts:3: .*poza regionem/);
});

test('a strict route of a contract listed by hand fails, a mention in a comment does not', () => {
  const strict = /ROUTES_API\.FAVORITE_GET_RECORDS\b/;
  const src = [
    '  STRICT: [',
    '    // ROUTES_API.FAVORITE_GET_RECORDS stays default (contract)',
    '    ROUTES_API.FAVORITE_GET_RECORDS,',
    '    // <generated:contracts:strict-routes> x',
    '    // </generated:contracts:strict-routes>',
    '  ],',
  ].join('\n');
  const { problems } = fillRegions(
    'rl.ts',
    src,
    new Map([['strict-routes', []]]),
    [strict]
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /rl\.ts:3:/);
});

test('missing, unclosed and unknown regions are reported', () => {
  assert.match(
    fillRegions('f.ts', 'const a = 1;', regions).problems[0] ?? '',
    /brak regionu grants:CLIENT/
  );
  assert.match(
    fillRegions(
      'f.ts',
      '// <generated:contracts:grants:CLIENT> x\n',
      regions
    ).problems.join(' '),
    /nie ma znacznika zamykającego/
  );
  assert.match(
    fillRegions(
      'f.ts',
      '// <generated:contracts:nope> x\n// </generated:contracts:nope>',
      new Map()
    ).problems[0] ?? '',
    /nie wypełnia żadne pole kontraktu/
  );
});

test('illegal kind/method/body/query combinations are refused', () => {
  const body = {};
  const ok = [
    {
      key: 'A_CMD',
      kind: 'COMMAND',
      method: 'POST',
      body,
      query: null,
      path: 'a/cmd',
    },
    {
      key: 'A_QRY',
      kind: 'QUERY',
      method: 'GET',
      body: null,
      query: null,
      path: 'a/q',
    },
    {
      key: 'A_PATCH',
      kind: 'COMMAND',
      method: 'PATCH',
      body,
      query: null,
      path: 'a/[id]/update',
    },
    {
      key: 'A_DEL',
      kind: 'COMMAND',
      method: 'DELETE',
      body,
      query: null,
      path: 'a/[id]/delete',
    },
    {
      key: 'A_CONFIRM',
      kind: 'CONFIRMATION',
      method: 'GET',
      body,
      query: null,
      path: 'user/delete/confirm',
      access: 'PUBLIC',
      authCheck: false,
    },
    {
      key: 'A_PUBLIC_OPEN',
      kind: 'QUERY',
      method: 'GET',
      body: null,
      query: null,
      path: 'pricing/get-plans',
      access: 'PUBLIC_NO_GRANT',
      authCheck: false,
    },
  ];
  assert.deepEqual(findIllegalContracts(ok), []);
  const bad = [
    { key: 'B1', kind: 'COMMAND', method: 'GET', body, query: null, path: 'b' },
    {
      key: 'B2',
      kind: 'COMMAND',
      method: 'POST',
      body: null,
      query: null,
      path: 'b',
    },
    {
      key: 'B3',
      kind: 'QUERY',
      method: 'POST',
      body: null,
      query: null,
      path: 'b',
    },
    { key: 'B4', kind: 'QUERY', method: 'GET', body, query: null, path: 'b' },
    { key: 'B5', kind: 'COMMAND', method: 'POST', body, query: {}, path: 'b' },
    {
      key: 'b6',
      kind: 'QUERY',
      method: 'GET',
      body: null,
      query: null,
      path: '/b',
    },
    {
      key: 'B7',
      kind: 'COMMAND',
      method: 'POST',
      body,
      query: null,
      querySchema: {},
      path: 'b',
    },
    {
      key: 'B8',
      kind: 'CONFIRMATION',
      method: 'POST',
      body,
      query: null,
      path: 'b',
    },
    {
      key: 'B9',
      kind: 'QUERY',
      method: 'GET',
      body: null,
      query: null,
      path: 'b',
      access: 'PUBLIC_NO_GRANT',
      authCheck: true,
    },
  ];
  const problems = findIllegalContracts(bad).join('\n');
  for (const expected of [
    'B1: COMMAND wymaga metody POST, PATCH albo DELETE',
    'B2: COMMAND wymaga schematu body',
    'B3: QUERY wymaga metody GET',
    'B4: QUERY nie ma body',
    'B5: COMMAND nie ma pól query',
    'b6: klucz operacji musi być UPPER_SNAKE',
    'b6: path musi być ścieżką względną',
    'B7: COMMAND nie ma schematu query',
    'B8: CONFIRMATION wymaga metody GET',
    'B9: PUBLIC_NO_GRANT wymaga authCheck: false',
  ]) {
    assert.ok(problems.includes(expected), `missing: ${expected}`);
  }
});

test('a DTO manual region is kept and a file without one stays generated-only', () => {
  const source = [
    '// <contracts:manual>',
    'export const KEEP = 1;',
    '// </contracts:manual>',
    'export type OLD = { dropped: true };',
  ].join('\n');
  assert.equal(
    extractContractManual(source),
    [
      '// <contracts:manual>',
      'export const KEEP = 1;',
      '// </contracts:manual>',
    ].join('\n')
  );
  assert.equal(extractContractManual('export type ONLY = {};'), null);
  assert.throws(
    () => extractContractManual('// <contracts:manual>\nexport const X = 1;\n'),
    /manual/i
  );
});

test('query codecs keep the lenient qStr/qInt/qBool/narrower behaviour', () => {
  const fields = {
    cursor: QUERY_FIELD.string(),
    take: QUERY_FIELD.int(20),
    thread_id: QUERY_FIELD.requiredString(),
    status: QUERY_FIELD.oneOf(['OPEN', 'CLOSED'] as const),
    awaiting_reply: QUERY_FIELD.bool(),
  };
  assert.deepEqual(decodeQueryFields(fields, {}), {
    take: 20,
  });
  assert.deepEqual(
    decodeQueryFields(fields, {
      take: '1.9',
      cursor: '',
      thread_id: ['a', 'b'],
      status: 'NOPE',
      awaiting_reply: 'false',
    }),
    { take: 1, awaiting_reply: false }
  );
  assert.deepEqual(
    decodeQueryFields(fields, {
      cursor: 'c1',
      thread_id: 'thr_1',
      status: 'OPEN',
      awaiting_reply: 'true',
      take: 'abc',
    }),
    {
      cursor: 'c1',
      take: 20,
      thread_id: 'thr_1',
      status: 'OPEN',
      awaiting_reply: true,
    }
  );
});

test('API summaries are quoted so Polish product text is a citation', () => {
  const quoted = quoteContractSummary(
    'Klientka dodaje stylistkę do zapisanych (zwraca id).'
  );
  assert.equal(
    quoted,
    '«Klientka dodaje stylistkę do zapisanych (zwraca id).»'
  );
  assert.equal(quoteContractSummary('a » b */ c'), '«a  b * / c»');
});

test('CRM note request schemas exist in one module', () => {
  assert.equal(clientCrmFromClient, clientCrmFromVisit);
  assert.equal(clientImportantFromClient, clientImportantFromVisit);
  assert.equal(clientDeleteFromClient, clientDeleteFromVisit);
});

test('malformed manual regions fail closed', () => {
  for (const source of [
    '// <contracts:manual>\nexport type Kept = string;',
    '// </contracts:manual>',
    '// <contracts:manual>\na\n// </contracts:manual>\n// <contracts:manual>\nb\n// </contracts:manual>',
  ])
    assert.throws(() => extractContractManual(source), /manual/i);
});

test('a failed generator write rolls back earlier writes and deletions', () => {
  const files = new Map<string, string>([
    ['a', 'old-a'],
    ['b', 'old-b'],
    ['stale', 'old-stale'],
  ]);
  let once = true;
  assert.throws(
    () =>
      applyGeneratedChanges(
        new Map([
          ['a', 'new-a'],
          ['b', 'new-b'],
        ]),
        ['stale'],
        {
          read: file => files.get(file) ?? null,
          write: (file, value) => {
            if (file === 'b' && once) {
              once = false;
              throw new Error('write failure');
            }
            files.set(file, value);
          },
          remove: file => {
            files.delete(file);
          },
        }
      ),
    /write failure/
  );
  assert.deepEqual(
    [...files.entries()],
    [
      ['a', 'old-a'],
      ['b', 'old-b'],
      ['stale', 'old-stale'],
    ]
  );
});
