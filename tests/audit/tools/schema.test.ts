// Tests for tools/schema.ts: temp mini trees holding only the files each check reads.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { type CheckResult } from './_lib';
import {
  ARCHIVE_CONFIG,
  GENERATED_DTO,
  GENERATOR_CONFIG,
  LOGS_SCHEMA,
  MAIN_SCHEMA,
  PRICING_CONFIG,
  checkArchiveCascade,
  checkEnumGenerated,
  checkEnumMirrors,
  checkFkIndex,
  checkPricingParity,
  checkRedundantIndex,
} from './schema';
import { PRISMA_FK_INDEX_SAMPLES } from './_retired-fixtures';

const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function miniTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-schema-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function messages(check: CheckResult): string[] {
  return check.findings.map(f => `${f.file}:${f.line} ${f.message}`);
}

// ── fk-index ────────────────────────────────────────────────────────────────────────────────

function fk(schema: string): CheckResult {
  const check = checkFkIndex(miniTree({ [MAIN_SCHEMA]: schema }));
  assert.deepEqual(check.errors, []);
  return check;
}

void describe('schema:fk-index', () => {
  const kind = (k: 'must-fail' | 'must-pass'): [string, string][] =>
    Object.entries(PRISMA_FK_INDEX_SAMPLES[k]);
  for (const [name, text] of kind('must-fail')) {
    void it(`fixture must-fail/${name} is reported`, () => {
      assert.ok(messages(fk(text)).some(m => m.includes('MISSING FK INDEX')));
    });
  }
  for (const [name, text] of kind('must-pass')) {
    void it(`fixture must-pass/${name} passes`, () => {
      assert.deepEqual(messages(fk(text)), []);
    });
  }
  const parent = 'model Parent {\n  id String @id\n  kids Kid[]\n}\n';
  void it('reports a FK with no index at all, at the relation line', () => {
    const msgs = messages(
      fk(
        `${parent}model Kid {\n  id String @id\n  parent_id String\n  parent Parent @relation(fields: [parent_id], references: [id])\n}\n`
      )
    );
    assert.deepEqual(msgs.length, 1);
    assert.match(msgs[0] ?? '', /:8 MISSING FK INDEX Kid\.parent_id/);
  });
  void it('reports a FK that is only the SECOND column of an index', () => {
    const msgs = messages(
      fk(
        `${parent}model Kid {\n  id String @id\n  a String\n  parent_id String\n  parent Parent @relation(fields: [parent_id], references: [id])\n  @@index([a, parent_id])\n}\n`
      )
    );
    assert.equal(msgs.length, 1);
  });
  void it('reads a named relation', () => {
    const msgs = messages(
      fk(
        `${parent}model Kid {\n  id String @id\n  parent_id String\n  parent Parent @relation("Named", fields: [parent_id], references: [id])\n}\n`
      )
    );
    assert.equal(msgs.length, 1);
  });
  void it('a @unique or @@index in a comment covers nothing (prose)', () => {
    const msgs = messages(
      fk(
        `${parent}model Kid {\n  id String @id\n  parent_id String // @unique\n  /// @@index([parent_id])\n  parent Parent @relation(fields: [parent_id], references: [id])\n  // @@index([parent_id])\n}\n`
      )
    );
    assert.equal(msgs.length, 1);
  });
  void it('accepts @@index, @@unique, @@id first column and a field @unique / @id', () => {
    for (const idx of [
      '@@index([parent_id(sort: Desc), id])',
      '@@unique([parent_id, id])',
      '@@id([parent_id, id])',
    ]) {
      assert.deepEqual(
        messages(
          fk(
            `${parent}model Kid {\n  id String\n  parent_id String\n  parent Parent @relation(fields: [parent_id], references: [id])\n  ${idx}\n}\n`
          )
        ),
        []
      );
    }
    assert.deepEqual(
      messages(
        fk(
          `${parent}model Kid {\n  id String @id\n  parent_id String @unique\n  parent Parent @relation(fields: [parent_id], references: [id])\n}\n`
        )
      ),
      []
    );
  });
  void it('an unparsable schema is an error, never a pass', () => {
    const check = checkFkIndex(
      miniTree({ [MAIN_SCHEMA]: 'model Broken {\n  id String @id\n' })
    );
    assert.equal(check.errors.length, 1);
  });
  void it('a missing schema is an error', () => {
    assert.equal(checkFkIndex(miniTree({ 'x.txt': '' })).errors.length, 1);
  });
});

// ── redundant-index ─────────────────────────────────────────────────────────────────────────

function redundant(
  main: string,
  logs = 'model L {\n  id Int @id\n}\n'
): CheckResult {
  const check = checkRedundantIndex(
    miniTree({ [MAIN_SCHEMA]: main, [LOGS_SCHEMA]: logs })
  );
  assert.deepEqual(check.errors, []);
  return check;
}
const model = (body: string): string =>
  `model M {\n  id String @id\n  a String\n  b String\n  c String\n${body}\n}\n`;

void describe('schema:redundant-index', () => {
  void it('reports a strict left prefix of another @@index', () => {
    const msgs = messages(
      redundant(model('  @@index([a])\n  @@index([a, b])'))
    );
    assert.equal(msgs.length, 1);
    assert.match(
      msgs[0] ?? '',
      /:6 REDUNDANT INDEX M @@index\(\[a\]\) is covered by index \[a, b\]/
    );
  });
  void it('reports a prefix of a @@unique, of a @@id and of the field @id', () => {
    assert.equal(
      messages(redundant(model('  @@index([a])\n  @@unique([a, b])'))).length,
      1
    );
    assert.equal(
      messages(
        redundant(
          `model M {\n  a String\n  b String\n  @@index([a])\n  @@id([a, b])\n}\n`
        )
      ).length,
      1
    );
    assert.equal(messages(redundant(model('  @@index([id])'))).length, 1);
  });
  void it('reports the same list as a unique (the unique IS that index) and a duplicate @@index once', () => {
    assert.equal(
      messages(
        redundant(
          `model M {\n  id String @id\n  a String @unique\n  @@index([a])\n}\n`
        )
      ).length,
      1
    );
    const dup = messages(
      redundant(model('  @@index([a, b])\n  @@index([a, b])'))
    );
    assert.equal(dup.length, 1);
    assert.match(dup[0] ?? '', /:7 /);
  });
  void it('scans the app-logs schema too', () => {
    assert.equal(
      messages(redundant(model(''), model('  @@index([b])\n  @@index([b, c])')))
        .length,
      1
    );
  });
  void it('legal: different sort, different leading column, wider plain index, non-btree', () => {
    assert.deepEqual(
      messages(
        redundant(model('  @@index([a])\n  @@index([a(sort: Desc), b])'))
      ),
      []
    );
    assert.deepEqual(
      messages(redundant(model('  @@index([b])\n  @@index([a, b])'))),
      []
    );
    assert.deepEqual(
      messages(redundant(model('  @@index([a, b])\n  @@unique([a])'))),
      []
    );
    assert.deepEqual(
      messages(
        redundant(
          model(
            '  @@index([a(ops: raw("gin_trgm_ops"))], type: Gin)\n  @@index([a, b])'
          )
        )
      ),
      []
    );
    assert.deepEqual(
      messages(
        redundant(model('  @@index([a], type: Hash)\n  @@index([a, b])'))
      ),
      []
    );
  });
  void it('escape with a reason (trailing or on a comment line above) is accepted, a bare one is not', () => {
    assert.deepEqual(
      messages(
        redundant(
          model(
            '  @@index([a]) // redundant-index-allow: hot path\n  @@index([a, b])'
          )
        )
      ),
      []
    );
    assert.deepEqual(
      messages(
        redundant(
          model(
            '  // redundant-index-allow: hot path\n  @@index([a])\n  @@index([a, b])'
          )
        )
      ),
      []
    );
    const bare = messages(
      redundant(
        model('  @@index([a]) // redundant-index-allow:\n  @@index([a, b])')
      )
    );
    assert.equal(bare.length, 1);
    assert.match(bare[0] ?? '', /without a reason/);
  });
  void it('a marker inside a string value, or on a code line above, does not escape', () => {
    assert.equal(
      messages(
        redundant(
          model(
            '  @@index([a], map: "redundant-index-allow: x")\n  @@index([a, b])'
          )
        )
      ).length,
      1
    );
    assert.equal(
      messages(
        redundant(
          model(
            '  c2 String // redundant-index-allow: x\n  @@index([a])\n  @@index([a, b])'
          )
        )
      ).length,
      1
    );
  });
  void it('a commented-out wider index covers nothing (prose)', () => {
    assert.deepEqual(
      messages(redundant(model('  @@index([a])\n  // @@index([a, b])'))),
      []
    );
  });
});

// ── enum-generated / enum-mirrors / pricing-parity ──────────────────────────────────────────

const SCHEMA_ENUMS = `enum NailLength {
  SHORT
  // DECISION note between members does not count
  LONG
}

enum StaffRole {
  OWNER
  EMPLOYEE
}

enum EventLogType {
  ACCOUNT
  LOGIN
}

enum PricingPlan {
  FREE
  PRO
}
`;
const GENERATED = `export const NailLengthValue = Object.freeze({
  SHORT: 'SHORT',
  LONG: 'LONG'
} as const)
export const StaffRoleValue = Object.freeze({ OWNER: 'OWNER', EMPLOYEE: 'EMPLOYEE' } as const)
export const EventLogTypeValue = Object.freeze({ ACCOUNT: 'ACCOUNT', LOGIN: 'LOGIN' } as const)
`;
const KERNEL_FILES: Record<string, string> = {
  '.shared-kernel/domain/gallery/nail-length.config.ts':
    "export const NAIL_LENGTHS = Object.freeze({\n  SHORT: 'SHORT',\n  LONG: 'LONG',\n} as const);\n",
  '.shared-kernel/domain/user-and-account/staff_accounts.config.ts':
    "export const STAFF_ROLES = ['OWNER', 'EMPLOYEE'] as const;\n",
  '.shared-kernel/domain/admin/admin.config.ts':
    "export const TIMELINE_EVENT_TYPES = ['ACCOUNT', 'LOGIN'] as const;\n",
  [PRICING_CONFIG]:
    "export const PricingPlanValue = Object.freeze({\n  FREE: 'FREE',\n  PRO: 'PRO',\n} as const);\n",
  [GENERATOR_CONFIG]:
    "export const SKIP_ENUMS: ReadonlySet<string> = new Set([\n  'PricingPlan', // kernel owns it\n])\n",
};

function enumTree(overrides: Record<string, string> = {}): string {
  return miniTree({
    [MAIN_SCHEMA]: SCHEMA_ENUMS,
    [GENERATED_DTO]: GENERATED,
    ...KERNEL_FILES,
    ...overrides,
  });
}

void describe('schema:enum-generated', () => {
  void it('passes when the generated mirror matches (comments inside the enum ignored)', () => {
    const check = checkEnumGenerated(enumTree());
    assert.deepEqual(check.errors, []);
    assert.deepEqual(messages(check), []);
    assert.equal(check.sites, 3);
  });
  void it('reports drift, a missing <Enum>Value and a stale <X>Value', () => {
    const drift = messages(
      checkEnumGenerated(
        enumTree({
          [GENERATED_DTO]: GENERATED.replace(
            "LONG: 'LONG'",
            "LONG: 'LONG',\n  XL: 'XL'"
          ),
        })
      )
    );
    assert.equal(drift.length, 1);
    assert.match(drift[0] ?? '', /NailLength DRIFT.*extra XL/);
    const missing = messages(
      checkEnumGenerated(
        enumTree({
          [GENERATED_DTO]: GENERATED.replace(
            /export const StaffRoleValue.*\n/,
            ''
          ),
        })
      )
    );
    assert.match(missing.join('\n'), /no StaffRoleValue/);
    const stale = messages(
      checkEnumGenerated(
        enumTree({
          [GENERATED_DTO]: `${GENERATED}export const GoneValue = Object.freeze({ A: 'A' } as const)\n`,
        })
      )
    );
    assert.match(stale.join('\n'), /GoneValue has no enum Gone/);
  });
  void it('a value present only in a comment of the generated file does not count', () => {
    const msgs = messages(
      checkEnumGenerated(
        enumTree({
          [GENERATED_DTO]: GENERATED.replace("LONG: 'LONG'", "// LONG: 'LONG'"),
        })
      )
    );
    assert.match(msgs.join('\n'), /NailLength DRIFT.*missing LONG/);
  });
});

void describe('schema:enum-mirrors', () => {
  void it('discovers the hand-written mirrors and passes when they match', () => {
    const check = checkEnumMirrors(enumTree());
    assert.deepEqual(check.errors, []);
    assert.deepEqual(messages(check), []);
    assert.equal(check.sites, 3);
  });
  void it('reports a mirror with an extra value and one with a missing value (discovered, not listed)', () => {
    const msgs = messages(
      checkEnumMirrors(
        enumTree({
          '.shared-kernel/domain/x/other.config.ts':
            'export const LENGTHS_UI = ["SHORT", "LONG", "XL"];\nconst ROLES = Object.freeze({ a: \'OWNER\', b: \'EMPLOYEE\', c: \'MANAGER\' });\n',
          '.shared-kernel/domain/admin/admin.config.ts':
            "export const TIMELINE_EVENT_TYPES = ['ACCOUNT', 'LOGIN', 'GALLERY'] as const;\n",
        })
      )
    );
    assert.equal(msgs.length, 3);
    assert.match(msgs.join('\n'), /NailLength DRIFT.*LENGTHS_UI: extra XL/);
    assert.match(msgs.join('\n'), /StaffRole DRIFT.*ROLES: extra MANAGER/);
    assert.match(
      msgs.join('\n'),
      /EventLogType DRIFT.*TIMELINE_EVENT_TYPES: extra GALLERY/
    );
  });
  void it('a list derived from <Enum>Value is not a mirror; a list in prose is not a mirror', () => {
    const check = checkEnumMirrors(
      enumTree({
        '.shared-kernel/domain/x/derived.ts':
          "export const L = [NailLengthValue.SHORT, 'LONG', 'XL'] as const;\n// const P = ['SHORT', 'LONG', 'XL'];\nconst s = \"['SHORT', 'LONG', 'XL']\";\n",
      })
    );
    assert.deepEqual(messages(check), []);
    assert.equal(check.sites, 3);
  });
  void it('an anchor that discovery no longer finds is an error', () => {
    const check = checkEnumMirrors(
      enumTree({
        '.shared-kernel/domain/admin/admin.config.ts':
          'export const TIMELINE_EVENT_TYPES = EVENT_KEYS;\n',
      })
    );
    assert.equal(check.errors.length, 1);
    assert.match(check.errors[0] ?? '', /ANCHOR LOST: TIMELINE_EVENT_TYPES/);
  });
});

void describe('schema:pricing-parity', () => {
  void it('passes when the schema enum equals PricingPlanValue and SKIP_ENUMS names it', () => {
    const check = checkPricingParity(enumTree());
    assert.deepEqual(check.errors, []);
    assert.deepEqual(messages(check), []);
    assert.equal(check.sites, 2);
  });
  void it('reports drift both ways', () => {
    const kernelExtra = messages(
      checkPricingParity(
        enumTree({
          [PRICING_CONFIG]:
            KERNEL_FILES[PRICING_CONFIG]?.replace(
              "PRO: 'PRO',",
              "PRO: 'PRO',\n  SCALE: 'SCALE',"
            ) ?? '',
        })
      )
    );
    assert.match(kernelExtra.join('\n'), /PricingPlan DRIFT.*missing SCALE/);
    const schemaExtra = messages(
      checkPricingParity(
        enumTree({
          [MAIN_SCHEMA]: SCHEMA_ENUMS.replace('  PRO\n}', '  PRO\n  STUDIO\n}'),
        })
      )
    );
    assert.match(schemaExtra.join('\n'), /extra STUDIO/);
  });
  void it("SKIP_ENUMS naming 'PricingPlan' only in a comment does not count", () => {
    const msgs = messages(
      checkPricingParity(
        enumTree({
          [GENERATOR_CONFIG]:
            "export const SKIP_ENUMS: ReadonlySet<string> = new Set([\n  // 'PricingPlan',\n])\n",
        })
      )
    );
    assert.match(msgs.join('\n'), /SKIP_ENUMS no longer lists 'PricingPlan'/);
  });
});

// ── archive-cascade ─────────────────────────────────────────────────────────────────────────

const ARCHIVE_SCHEMA = `model User {
  id              String          @id
  stylist_account StylistAccount? @relation("StylistAccountRelation")
  client_account  ClientAccount?  @relation("ClientAccountRelation")
  sessions        Session[]
  announcements   Announcement[]
  notifications   Notification[]
}

model StylistAccount {
  account_id         String  @id
  created_by_user_id String  @unique
  created_by_user    User    @relation("StylistAccountRelation", fields: [created_by_user_id], references: [id], onDelete: Cascade)
  gallery_record     Photo[]
}

model ClientAccount {
  client_account_id  String @id
  created_by_user_id String @unique
  created_by_user    User   @relation("ClientAccountRelation", fields: [created_by_user_id], references: [id], onDelete: Cascade)
}

model Session {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Announcement {
  id                 String  @id
  created_by_user_id String?
  created_by_user    User?   @relation(fields: [created_by_user_id], references: [id], onDelete: SetNull)
}

model Notification {
  id      String @id
  user_id String
  user    User   @relation(fields: [user_id], references: [id], onDelete: Cascade)
}

model Photo {
  id         String         @id
  account_id String
  account    StylistAccount @relation(fields: [account_id], references: [account_id], onDelete: Cascade)
}
`;
const ALLOW = { 'User.notifications': 'ephemeral rows' };
const ENABLER = `export const userRelationsArchiveEnabler = {
  sessions: { select: { id: true } },
  stylist_account: {
    include: {
      gallery_record: true,
    },
  },
  client_account: true,
};
`;

function archive(schema = ARCHIVE_SCHEMA, enabler = ENABLER): CheckResult {
  return checkArchiveCascade(
    miniTree({ [MAIN_SCHEMA]: schema, [ARCHIVE_CONFIG]: enabler }),
    ALLOW
  );
}

void describe('schema:archive-cascade', () => {
  void it('passes: cascade children archived at their place, allowlisted one skipped, SetNull survivor not required', () => {
    const check = archive();
    assert.deepEqual(check.errors, []);
    assert.deepEqual(messages(check), []);
    // sessions, stylist_account, client_account, notifications (allowlisted), gallery_record
    assert.equal(check.sites, 5);
  });
  void it('reports a User child missing from the enabler', () => {
    const msgs = messages(
      archive(
        ARCHIVE_SCHEMA,
        ENABLER.replace('  sessions: { select: { id: true } },\n', '')
      )
    );
    assert.equal(msgs.length, 1);
    assert.match(
      msgs[0] ?? '',
      /User\.sessions: cascade child NOT archived at userRelationsArchiveEnabler /
    );
  });
  void it('reports a StylistAccount child listed at the WRONG level (the old name-only scan accepted it)', () => {
    const enabler = ENABLER.replace(
      '  stylist_account: {\n    include: {\n      gallery_record: true,\n    },\n  },',
      '  stylist_account: true,\n  gallery_record: true,'
    );
    const msgs = messages(archive(ARCHIVE_SCHEMA, enabler));
    assert.equal(msgs.length, 1);
    assert.match(
      msgs[0] ?? '',
      /StylistAccount\.gallery_record: .*stylist_account\.include/
    );
  });
  void it('reports a child switched off with false, and a key present only in a comment or a string', () => {
    assert.equal(
      messages(
        archive(
          ARCHIVE_SCHEMA,
          ENABLER.replace(
            'sessions: { select: { id: true } }',
            'sessions: false'
          )
        )
      ).length,
      1
    );
    const prose = ENABLER.replace(
      '  sessions: { select: { id: true } },\n',
      "  // sessions: true,\n  note: 'sessions: true',\n"
    );
    assert.equal(messages(archive(ARCHIVE_SCHEMA, prose)).length, 1);
  });
  void it('a new cascade child (one-to-one included) without archive is reported', () => {
    const schema = ARCHIVE_SCHEMA.replace(
      '  notifications   Notification[]\n',
      '  notifications   Notification[]\n  profile         Profile?\n'
    ).concat(
      'model Profile {\n  id      String @id\n  user_id String @unique\n  user    User   @relation(fields: [user_id], references: [id], onDelete: Cascade)\n}\n'
    );
    assert.match(
      messages(archive(schema)).join('\n'),
      /User\.profile: cascade child NOT archived/
    );
  });
  void it('a dead allowlist entry is an error', () => {
    const schema = ARCHIVE_SCHEMA.replace(
      '  notifications   Notification[]\n',
      ''
    );
    const check = archive(schema.replace(/model Notification \{[^}]*\}\n/, ''));
    assert.match(
      check.errors.join('\n'),
      /ARCHIVE_ALLOWLIST entry User\.notifications names no cascade child/
    );
  });
  void it('a missing enabler const is an error', () => {
    assert.match(
      archive(ARCHIVE_SCHEMA, 'export const other = {};\n').errors.join('\n'),
      /no object literal userRelationsArchiveEnabler/
    );
  });
});
