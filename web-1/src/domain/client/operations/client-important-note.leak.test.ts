import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';

const SRC = path.resolve(__dirname, '../../..');
const KERNEL = path.resolve(SRC, '../../.shared-kernel');

const ALLOWED = new Set(
  [
    'domain/client/operations/client-important-note.operations.ts',
    'domain/private-notes/operations/private-notes-query.operations.ts',
    'domain/user/operations/export-user-data.collectors.extra.ts',
  ].map(rel => path.join(SRC, rel))
);

const SKIP_DIRS = new Set(['READONLY-shared-kernel', 'prisma', 'node_modules']);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return SKIP_DIRS.has(entry) ? [] : walk(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

type Responses<T> = T[keyof T] extends { RESPONSE: infer R } ? R : never;
type PrivateField<T, Depth extends 0[] = []> = T extends object
  ? Depth['length'] extends 8
    ? 'unverified-depth'
    : T extends readonly (infer Item)[]
      ? PrivateField<Item, [...Depth, 0]>
      : {
          [Key in keyof T]-?: Key extends 'important_note' | 'importantNote'
            ? Key
            : PrivateField<T[Key], [...Depth, 0]>;
        }[keyof T]
  : never;
type PublicClientDTO = Omit<
  CLIENT_DTO_API_V1,
  'CLIENT_GET_IMPORTANT_NOTE' | 'CLIENT_UPSERT_IMPORTANT_NOTE'
>;
type ClientResponses =
  | Responses<SESSION_CONTAINER_DTO_API_V1>
  | Responses<SESSION_DTO_API_V1>
  | Responses<PAIRING_DTO_API_V1>
  | Responses<PublicClientDTO>
  | Responses<MESSAGING_DTO_API_V1>;
// Inspect resolved response types, including nested arrays. Operation names may mention the
// stylist-only field. An unresolved object deeper than eight levels fails closed.
const safeResponseTypes: [PrivateField<ClientResponses>] extends [never]
  ? true
  : false = true;
const catchesNestedField: PrivateField<{ rows: { important_note: string }[] }> =
  'important_note';

describe('important note: no client-facing leak', () => {
  it('only the allowlisted backend files read the column', () => {
    const roots = ['domain', 'application', 'pages'].map(d =>
      path.join(SRC, d)
    );
    for (const root of roots) {
      expect(statSync(root).isDirectory()).toBe(true);
    }
    for (const allowed of ALLOWED) {
      expect(readFileSync(allowed, 'utf8')).toMatch(/important_note/);
    }
    const offenders = roots
      .flatMap(walk)
      .filter(file => !ALLOWED.has(file))
      .filter(file => !file.includes(`${path.sep}important-note${path.sep}`))
      .filter(file => /important_note/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('client-facing kernel DTOs never carry it', () => {
    const clientFacing = [
      'models/session-container/session-container.dto.ts',
      'models/session/session.dto.ts',
      'models/pairing/pairing.dto.ts',
      'models/client/client.dto.ts',
      'models/messaging/messaging.dto.ts',
    ].map(rel => path.join(KERNEL, rel));
    // Every path must exist: a renamed DTO must not turn this check green by silence.
    for (const file of clientFacing) {
      expect(statSync(file).isFile()).toBe(true);
    }
    expect(safeResponseTypes).toBe(true);
    expect(catchesNestedField).toBe('important_note');
    for (const contract of [
      CLIENT_CONTRACTS.CLIENT_GET_IMPORTANT_NOTE,
      CLIENT_CONTRACTS.CLIENT_UPSERT_IMPORTANT_NOTE,
    ]) {
      expect(contract.access).toBe('STYLIST');
      expect(contract.authCheck).toBe(true);
    }
  });
});
