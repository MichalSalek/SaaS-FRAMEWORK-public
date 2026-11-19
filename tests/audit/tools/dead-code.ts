// dead-code — unreachable files and unused exports in main/src, web-1/src and .shared-kernel.
//
// Successor of tests/audit/dead-code.sh and tests/audit/dead-exports.sh. Baseline is 0: a new
// finding fails; deliberate surface goes on an allowlist WITH a reason, and every allowlist entry
// must still exempt something today. A missing tool or unreadable output is an ERROR.
// Four checks, each with its own floor:
//  1. main-files: knip `files` over main/ (main/knip.json). Only TRACKED files count; an untracked
//     file is another live session's WIP.
//  2. web-1-exports: ts-prune over web-1/tsconfig.json (DECISION: kept on ts-prune, the tool web-1
//     has installed). Filters: src/pages/**, "(used in module)", `default`, `.d.ts`, `satisfies`
//     artifact, READONLY kernel copy. WEB1_ALLOWLIST is path-anchored.
//  3. kernel-exports: liveness is repo-wide because consumers import READONLY copies: an exported
//     name is LIVE when an identifier of that name occurs in web-1/src, main/src, tests or scripts,
//     or more than once inside the kernel. AST only: a name left in a comment or string is DEAD.
//  4. main-exports: knip `exports,types` over main/ (`ignoreExportsUsedInFile`), MAIN_ALLOWLIST.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertPaths,
  gitRepositoryEnv,
  newCheck,
  parseTs,
  projectRoot,
  readText,
  report,
  walk,
  type CheckResult,
  type Finding,
  type MutableCheck,
} from './_lib';
import { isTestOrDecl } from './_ts';

export const MAIN = 'main';
export const WEB1 = 'web-1';
export const KERNEL = '.shared-kernel';
export const KNIP_CONFIG = 'main/knip.json';
export const WEB1_TSCONFIG = 'web-1/tsconfig.json';
export const KERNEL_GENERATED = 'models/db_models.generated.dto.ts';
export const KERNEL_CONSUMERS = [
  'web-1/src',
  'main/src',
  'tests',
  'scripts',
] as const;

/** Floors, measured 2026-10-23 on the real tree. */
export const FLOORS = {
  /** main/src source files, tests included (measured 1506). */
  mainFiles: 1000,
  /** export sites in web-1/src, pages and generated client excluded (measured 1660). */
  web1Exports: 1200,
  /** unique exported declaration names in .shared-kernel (measured 800, same as the shell grep). */
  kernelExports: 600,
  /** export sites in main/src (measured 2878). */
  mainExports: 2000,
} as const;

/**
 * web-1 exemptions, `src-relative path - name` → reason. Classes: (a) owner-retained future use
 * (DECISION at the definition), (b) framework entry point, (c) barrel re-export of kernel symbols,
 * (d) public-API create/verify pair with the counterpart wired, (e) pre-existing cohesive surface.
 */
export const WEB1_ALLOWLIST: Readonly<Record<string, string>> = {
  'src/domain/admin/admin.utils.api.ts - adminRevokeImpersonationBackup_IO':
    '(a) retained entry point for a future admin-UI kill switch (DECISION at the definition)',
  'src/instrumentation.ts - register':
    '(b) Next.js instrumentation hook, called by the runtime at boot',
  'src/application/http/http.types.ts - HTTPError':
    '(c) @app/http/http.types re-export of a kernel http type',
  'src/application/http/http.types.ts - HTTPSuccess':
    '(c) @app/http/http.types re-export of a kernel http type',
  'src/application/http/http.types.ts - DetailedErrorGeneric':
    '(c) re-export of a kernel type (DetailedErrorPayload base)',
  'src/application/http/http.types.ts - DetailedErrorPayload':
    '(c) re-export consumed by kernel DTOs via a relative application/http/http.types import',
  'src/application/interceptors/domain-interceptors.ts - GetCurrentUserOutputOptimistic':
    '(c) domain-interceptors barrel re-export used across source files',
  'src/application/stripe/stripe.config.ts - SUBSCRIPTION_STATUS':
    '(c) `export *` surfacing a kernel const',
  'src/application/stripe/stripe.config.ts - STRIPE_ACTIVE_STATUSES':
    '(c) `export *` surfacing a kernel const',
  'src/application/stripe/stripe.config.ts - PLAN_ID_MAP':
    '(c) `export *` surfacing a kernel const',
  'src/application/stripe/stripe.config.ts - PlanId':
    '(c) `export *` surfacing a kernel type',
  'src/application/stripe/stripe.config.ts - EMAIL_OFFERS':
    '(c) `export *` surfacing a kernel const',
  'src/domain/account/account.config.ts - StylistAccountWhereInput':
    '(c) `satisfies Prisma.StylistAccountWhereInput` type artifact of ts-prune, not a real export',
  'src/domain/session-container/operations/session-container.operations.ts - loadSessionDetail_IO':
    'ts-prune resolution artifact: imported and called in two sibling session-container operation files',
  'src/application/email-handler/newsletter-unsubscribe.token.ts - createNewsletterUnsubscribeToken':
    '(d) create side of the newsletter unsubscribe HMAC pair (verify side wired), kept for broadcasts',
  'src/domain/email/email.types.ts - parseEmailPreferences':
    '(e) email_preferences JSON parser, shadow of the PRMA rollback-safety column (DECISION at the definition)',
  'src/application/admin/admin.utils.api.ts - isEmailAddressProhibited':
    '(e) admin email-policy helper, public admin.utils.api surface',
  'src/domain/newsletter/operations/newsletter-subscribe.operations.ts - NewsletterSubscribeError':
    '(e) exported error-type alias on the newsletter-subscribe operation surface',
  'src/application/http/http.client.types.ts - IOClientFunctionReqResErr':
    '(e) generic IO client function type, public surface',
  'src/application/email-handler/email-template.content.ts - BodyGenerator':
    '(e) body-generator type, used in the same file by the BODY_TEMPLATES value type',
};

/** Kernel exemptions: whole-line pattern over `kernel-relative path - name` → reason. */
export const KERNEL_ALLOWLIST: readonly {
  readonly pattern: RegExp;
  readonly anchor: string;
  readonly reason: string;
}[] = [
  // DECISION: six kernel exports whose only "use" was prose (a comment or HTML text) that a grep
  // counts as a reference; the AST sweep calls them dead. Deleting them is a kernel edit. Each
  // entry is pinned to one name, so it turns into a stale-entry finding the day the export is
  // removed or gains a real consumer; it never exempts a new dead export.
  {
    pattern: /^domain\/http\/http-methods\.config\.ts - ApiHttpMethod$/,
    anchor: 'domain/http/http-methods.config.ts',
    reason:
      'alive only in /dev/architecture HTML text; delete in a kernel change',
  },
  {
    pattern:
      /^domain\/user-and-account\/role_switch\.config\.ts - getOppositeAccountType$/,
    anchor: 'domain/user-and-account/role_switch.config.ts',
    reason:
      'public helper for deriving a role',
  },
  {
    pattern:
      /^domain\/user-and-account\/staff_accounts\.config\.ts - isValidStaffRole$/,
    anchor: 'domain/user-and-account/staff_accounts.config.ts',
    reason: 'only a comment says it left the gate; delete in a kernel change',
  },
  {
    pattern:
      /^domain\/platform\/platform\.config\.ts - PLATFORM_GATE_BYPASS_STORAGE_KEY$/,
    anchor: 'domain/platform/platform.config.ts',
    reason:
      'pair of the allowlisted PLATFORM_GATE_BYPASS_PARAM (same bypass contract)',
  },
  {
    pattern:
      /^models\/user\/user\.dto\.ts - UserExportNotificationPreferences$/,
    anchor: 'models/user/user.dto.ts',
    reason: 'comment mentions only; delete in a kernel change',
  },
  {
    pattern: /^models\/user\/user\.types\.ts - UserWithRelationsExtended$/,
    anchor: 'models/user/user.types.ts',
    reason: 'comment mentions only; delete in a kernel change',
  },
  {
    pattern:
      /^policies\/validation\/[a-z0-9-]+\.validation\.ts - [A-Za-z0-9]+RequestSchemaBindings$/,
    anchor: 'policies/validation',
    reason:
      'compile-time zod/DTO binding guards: the type errors AT DECLARATION on drift, unused by design',
  },
  {
    pattern: /^domain\/routing\/routing\.types\.ts - ROUTES_[A-Z_]+$/,
    anchor: 'domain/routing/routing.types.ts',
    reason:
      'NAME/PATH/TYPE triple per route group, 1:1 with routing.config: holes would make the surface lie',
  },
  {
    pattern: /^models\/type_narrowing\.ts - is[A-Za-z]+Narrower$/,
    anchor: 'models/type_narrowing.ts',
    reason:
      'one is*Narrower per kernel union, a symmetric surface whose siblings are in use',
  },
  {
    pattern:
      /^domain\/session-container\/session-container\.types\.ts - isDraftSession$/,
    anchor: 'domain/session-container/session-container.types.ts',
    reason: 'session lifecycle predicate family (isActive/isTerminal in use)',
  },
  {
    pattern:
      /^domain\/user-and-account\/staff_accounts\.config\.ts - hasStaffPermission$/,
    anchor: 'domain/user-and-account/staff_accounts.config.ts',
    reason:
      'checker for the live staff-permission config; enforcement wiring pending, intended SSOT API',
  },
  {
    pattern:
      /^domain\/platform\/platform\.config\.ts - PLATFORM_GATE_BYPASS_PARAM$/,
    anchor: 'domain/platform/platform.config.ts',
    reason:
      'dormant platform-gate escape hatch, pair of PLATFORM_GATE_BYPASS_STORAGE_KEY',
  },
];

/** main exemptions, `main-relative path - name` → reason. */
export const MAIN_ALLOWLIST: Readonly<Record<string, string>> = {
  'src/application/date/date.utils.ts - formatDateLongPL':
    'symmetric pl-PL wrapper family over format*; siblings live, a hole in the triple would lie about the surface',
  'src/UI/shared/image/imageUpload.config.ts - AcceptedImageMimeType':
    'type derived from ACCEPTED_IMAGE_MIME_TYPES next to its predicate: typed surface of the same SSOT',
};

// ── External tools ─────────────────────────────────────────────────────────────────────────

export interface KnipResult {
  /** main-relative paths of unreachable files. */
  readonly files: string[];
  /** `main-relative path - name` of unused exports and types. */
  readonly exports: string[];
  /** Line of each export entry, when the reporter gives one. */
  readonly lines?: ReadonlyMap<string, number>;
}

/** Injectable runners, so tests feed recorded outputs instead of running knip and ts-prune. */
export interface Tools {
  knip(root: string): KnipResult;
  tsPrune(root: string): string;
  /** Subset of main-relative paths that git tracks in main/ (all of them when git is unavailable). */
  tracked(root: string, mainRelPaths: readonly string[]): Set<string>;
}

function bin(root: string, workspace: string, name: string): string {
  const file = path.join(root, workspace, 'node_modules', '.bin', name);
  if (!existsSync(file)) {
    throw new Error(
      `${workspace}/node_modules/.bin/${name} is missing (npm install in ${workspace}/): CANNOT MEASURE`
    );
  }
  return file;
}

// A file descriptor keeps stdout synchronous when a CLI calls process.exit before a pipe drains.
// Test: tests/audit/tools/dead-code.test.ts (large immediate exit and fatal status; not tool hangs).
function capture(
  file: string,
  args: readonly string[],
  cwd: string,
  findingsExit = false
): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nf-audit-output-'));
  const output = path.join(dir, 'stdout.txt');
  const fd = openSync(output, 'w', 0o600);
  const limit = 256 * 1024 * 1024;
  try {
    try {
      execFileSync(file, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: limit,
        stdio: ['ignore', fd, 'pipe'],
      });
    } catch (error) {
      if (
        !findingsExit ||
        (error as { status?: unknown }).status !== 1 ||
        statSync(output).size === 0
      )
        throw error;
    }
    if (statSync(output).size > limit)
      throw new Error('Audit tool output exceeds the measurement limit');
    return readFileSync(output, 'utf8');
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Parses knip's JSON reporter output (v6: `{ issues: [{ file, files, exports, types }] }`). */
export function parseKnip(json: string): KnipResult {
  const data = asRecord(JSON.parse(json));
  const issues = data?.issues;
  if (!Array.isArray(issues)) {
    throw new Error(
      'knip JSON has no `issues` array: reporter format changed, CANNOT MEASURE'
    );
  }
  const files: string[] = [];
  const exports: string[] = [];
  const lines = new Map<string, number>();
  for (const raw of issues) {
    const issue = asRecord(raw);
    const file = issue?.file;
    if (issue === undefined || typeof file !== 'string') {
      continue;
    }
    const fileIssues = issue.files;
    if (Array.isArray(fileIssues) && fileIssues.length > 0) {
      files.push(file);
    }
    for (const key of ['exports', 'types'] as const) {
      const list = issue[key];
      if (!Array.isArray(list)) {
        continue;
      }
      for (const item of list) {
        const record = asRecord(item);
        const name = record?.name;
        if (typeof name === 'string') {
          exports.push(`${file} - ${name}`);
          if (typeof record?.line === 'number') {
            lines.set(`${file} - ${name}`, record.line);
          }
        }
      }
    }
  }
  return {
    files: [...new Set(files)].sort(),
    exports: [...new Set(exports)].sort(),
    lines,
  };
}

export const realTools: Tools = {
  knip(root) {
    const knip = bin(root, MAIN, 'knip');
    const out = capture(
      knip,
      [
        '--include',
        'files,exports,types',
        '--no-progress',
        '--reporter',
        'json',
      ],
      path.join(root, MAIN),
      true
    );
    return parseKnip(out);
  },
  tsPrune(root) {
    const tsPrune = bin(root, WEB1, 'ts-prune');
    return capture(tsPrune, ['-p', 'tsconfig.json'], path.join(root, WEB1));
  },
  tracked(root, mainRelPaths) {
    if (mainRelPaths.length === 0) {
      return new Set();
    }
    // An inherited GIT_DIR (a submodule push) would point git at another repository.
    const env = gitRepositoryEnv();
    try {
      const out = execFileSync(
        'git',
        ['ls-files', '-z', '--', ...mainRelPaths],
        {
          cwd: path.join(root, MAIN),
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      return new Set(out.split('\0').filter(p => p !== ''));
    } catch {
      // Not a git work tree (a test mini tree): treat every file as tracked, never as WIP.
      return new Set(mainRelPaths);
    }
  },
};

// ── Shared ─────────────────────────────────────────────────────────────────────────────────

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      m => m.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}

function hasDefaultModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      m => m.kind === ts.SyntaxKind.DefaultKeyword
    )
  );
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      bindingNames(element.name, out);
    }
  }
}

/** Names a file exports through declarations (`export const|function|class|type|interface|enum`). */
export function exportedDeclarations(
  sf: ts.SourceFile
): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  for (const stmt of sf.statements) {
    if (!hasExportModifier(stmt) || hasDefaultModifier(stmt)) {
      continue;
    }
    const names: string[] = [];
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        bindingNames(decl.name, names);
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name !== undefined
    ) {
      names.push(stmt.name.text);
    }
    const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
    for (const name of names) {
      out.push({ name, line });
    }
  }
  return out;
}

/** Export sites of a workspace source root: declarations plus names in `export { … }` lists. */
function countExportSites(root: string, relDir: string, skip: RegExp): number {
  let sites = 0;
  for (const rel of walk(
    root,
    relDir,
    r => /\.tsx?$/.test(r) && !isTestOrDecl(r) && !skip.test(r)
  )) {
    const sf = parseTs(rel, readText(root, rel));
    sites += exportedDeclarations(sf).length;
    for (const stmt of sf.statements) {
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.exportClause !== undefined &&
        ts.isNamedExports(stmt.exportClause)
      ) {
        sites += stmt.exportClause.elements.length;
      }
    }
  }
  return sites;
}

function fail(check: MutableCheck, error: unknown): CheckResult {
  check.errors.push(error instanceof Error ? error.message : String(error));
  return check;
}

/** Allowlist entries (exact `path - name`) that exempt nothing today. */
function staleEntries(
  allow: readonly string[],
  raw: ReadonlySet<string>
): string[] {
  return allow.filter(entry => !raw.has(entry));
}

function finding(file: string, message: string, line = 1): Finding {
  return { file, line, message };
}

const READONLY = /(^|\/)READONLY-shared-kernel(\/|$)/;

// ── 1. main-files ──────────────────────────────────────────────────────────────────────────

export function checkMainFiles(
  root: string,
  knip: KnipResult | Error,
  tools: Tools
): CheckResult {
  const check: MutableCheck = newCheck(
    'dead-code:main-files',
    FLOORS.mainFiles,
    'main/src source files'
  );
  assertPaths(check, root, [`${MAIN}/src`, KNIP_CONFIG]);
  if (check.errors.length > 0) {
    return check;
  }
  check.sites = walk(
    root,
    `${MAIN}/src`,
    rel => /\.tsx?$/.test(rel) && !READONLY.test(rel)
  ).length;
  if (knip instanceof Error) {
    return fail(check, knip);
  }
  const tracked = tools.tracked(root, knip.files);
  for (const file of knip.files) {
    if (tracked.has(file)) {
      check.findings.push(
        finding(
          `${MAIN}/${file}`,
          'unreachable file (knip): delete it (git keeps history) or wire it to an entry'
        )
      );
    }
  }
  return check;
}

// ── 2. web-1-exports ───────────────────────────────────────────────────────────────────────

/** ts-prune output → `path - name` findings after the structural filters (volatile `:LINE` dropped). */
export function filterTsPrune(raw: string): string[] {
  const out = new Set<string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('src/pages/') ||
      trimmed.includes('(used in module)')
    ) {
      continue;
    }
    if (
      trimmed.endsWith(' - default') ||
      trimmed.endsWith(' - satisfies') ||
      /\.d\.ts:/.test(trimmed)
    ) {
      continue;
    }
    if (trimmed.includes('READONLY-shared-kernel')) {
      continue;
    }
    out.add(trimmed.replace(/:[0-9]+ - /, ' - '));
  }
  return [...out].sort();
}

/** Line of each `path - name` entry in raw ts-prune output (first occurrence). */
export function tsPruneLines(raw: string): Map<string, number> {
  const lines = new Map<string, number>();
  for (const line of raw.split('\n')) {
    const match = /^(.+):([0-9]+) - (.+)$/.exec(line.trim());
    if (
      match?.[1] !== undefined &&
      match[2] !== undefined &&
      match[3] !== undefined
    ) {
      const key = `${match[1]} - ${match[3]}`;
      if (!lines.has(key)) {
        lines.set(key, Number(match[2]));
      }
    }
  }
  return lines;
}

export function checkWeb1Exports(
  root: string,
  tsPruneOutput: string | Error
): CheckResult {
  const check: MutableCheck = newCheck(
    'dead-exports:web-1',
    FLOORS.web1Exports,
    'web-1/src exported names'
  );
  const allow = Object.keys(WEB1_ALLOWLIST);
  assertPaths(check, root, [
    `${WEB1}/src`,
    WEB1_TSCONFIG,
    ...[
      ...new Set(allow.map(entry => `${WEB1}/${entry.split(' - ')[0] ?? ''}`)),
    ],
  ]);
  if (check.errors.length > 0) {
    return check;
  }
  check.sites = countExportSites(
    root,
    `${WEB1}/src`,
    /(^|\/)(READONLY-shared-kernel|js-client|generated)(\/|$)|^web-1\/src\/pages\//
  );
  if (tsPruneOutput instanceof Error) {
    return fail(check, tsPruneOutput);
  }
  const structural = filterTsPrune(tsPruneOutput);
  const lines = tsPruneLines(tsPruneOutput);
  const raw = new Set(structural);
  for (const entry of staleEntries(allow, raw)) {
    check.findings.push(
      finding(
        `${WEB1}/${entry.split(' - ')[0] ?? ''}`,
        `dead allowlist anchor "${entry}": the export is alive or gone, remove the WEB1_ALLOWLIST entry`
      )
    );
  }
  for (const entry of structural) {
    if (WEB1_ALLOWLIST[entry] === undefined) {
      check.findings.push(
        finding(
          `${WEB1}/${entry.split(' - ')[0] ?? ''}`,
          `unused export ${entry.split(' - ')[1] ?? ''} (ts-prune): DELETE it (check web-1/src, main/src and tests for 0 references first), or allowlist deliberate surface with a reason`,
          lines.get(entry)
        )
      );
    }
  }
  return check;
}

// ── 3. kernel-exports ──────────────────────────────────────────────────────────────────────

function identifierCounts(
  root: string,
  relDirs: readonly string[],
  accept: (rel: string) => boolean
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const relDir of relDirs) {
    for (const rel of walk(root, relDir, r => /\.tsx?$/.test(r) && accept(r))) {
      const sf = parseTs(rel, readText(root, rel));
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          counts.set(node.text, (counts.get(node.text) ?? 0) + 1);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return counts;
}

export interface KernelSweep {
  /** Exported declaration names inspected (unique per name, like the shell guard). */
  readonly names: number;
  /** `kernel-relative path - name` of names with no use anywhere. */
  readonly dead: { readonly entry: string; readonly line: number }[];
}

const CONTRACT_DTO_EXPORT = /^[A-Z0-9_]+_DTO_API_V1$/;

/**
 * OpenAPI discovers `export type *_DTO_API_V1` by text and resolves it through the compiler
 * (main/scripts/gen-openapi.ts). The identifier is not imported. Only a type alias after the
 * `GENERATED by` marker in models/*.dto.ts is that view. A hand-written DTO stays subject to
 * the unused-export check. Test: dead-code.test.ts (generated view exempt; manual name is not).
 */
function reflectiveContractDtoNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const rel = sf.fileName.replace(/\\/g, '/');
  const marker = sf.getFullText().indexOf('GENERATED by');
  if (marker < 0 || !rel.includes('/models/') || !rel.endsWith('.dto.ts')) {
    return out;
  }
  for (const stmt of sf.statements) {
    if (
      stmt.getStart(sf) > marker &&
      ts.isTypeAliasDeclaration(stmt) &&
      hasExportModifier(stmt) &&
      CONTRACT_DTO_EXPORT.test(stmt.name.text)
    ) {
      out.add(stmt.name.text);
    }
  }
  return out;
}

export function sweepKernel(root: string): KernelSweep {
  const definitions = new Map<
    string,
    { rel: string; line: number; reflective: boolean }
  >();
  for (const rel of walk(root, KERNEL, r => r.endsWith('.ts'))) {
    const kernelRel = rel.slice(KERNEL.length + 1);
    if (kernelRel === KERNEL_GENERATED) {
      continue;
    }
    const sf = parseTs(rel, readText(root, rel));
    const reflective = reflectiveContractDtoNames(sf);
    for (const { name, line } of exportedDeclarations(sf)) {
      if (!definitions.has(name)) {
        definitions.set(name, {
          rel: kernelRel,
          line,
          reflective: reflective.has(name),
        });
      }
    }
  }
  const consumers = identifierCounts(
    root,
    KERNEL_CONSUMERS,
    rel => !READONLY.test(rel)
  );
  const inKernel = identifierCounts(root, [KERNEL], rel => rel.endsWith('.ts'));
  const dead: { entry: string; line: number }[] = [];
  for (const [name, def] of [...definitions].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (def.reflective) {
      continue;
    }
    if ((consumers.get(name) ?? 0) > 0 || (inKernel.get(name) ?? 0) > 1) {
      continue;
    }
    dead.push({ entry: `${def.rel} - ${name}`, line: def.line });
  }
  return { names: definitions.size, dead };
}

export function checkKernelExports(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'dead-exports:kernel',
    FLOORS.kernelExports,
    '.shared-kernel exported names'
  );
  assertPaths(check, root, [
    KERNEL,
    `${KERNEL}/${KERNEL_GENERATED}`,
    ...KERNEL_CONSUMERS,
    ...KERNEL_ALLOWLIST.map(a => `${KERNEL}/${a.anchor}`),
  ]);
  if (check.errors.length > 0) {
    return check;
  }
  const sweep = sweepKernel(root);
  check.sites = sweep.names;
  for (const allowed of KERNEL_ALLOWLIST) {
    if (!sweep.dead.some(d => allowed.pattern.test(d.entry))) {
      check.findings.push(
        finding(
          `${KERNEL}/${allowed.anchor}`,
          `dead allowlist pattern ${String(allowed.pattern)}: it exempts nothing today, remove it from KERNEL_ALLOWLIST`
        )
      );
    }
  }
  for (const { entry, line } of sweep.dead) {
    if (KERNEL_ALLOWLIST.some(a => a.pattern.test(entry))) {
      continue;
    }
    check.findings.push(
      finding(
        `${KERNEL}/${entry.split(' - ')[0] ?? ''}`,
        `unused export ${entry.split(' - ')[1] ?? ''} (no identifier use in web-1/src, main/src, tests, scripts or elsewhere in the kernel): DELETE it and run npm run system:kernel, or allowlist deliberate surface with a reason`,
        line
      )
    );
  }
  return check;
}

// ── 4. main-exports ────────────────────────────────────────────────────────────────────────

export function checkMainExports(
  root: string,
  knip: KnipResult | Error
): CheckResult {
  const check: MutableCheck = newCheck(
    'dead-exports:main',
    FLOORS.mainExports,
    'main/src exported names'
  );
  const allow = Object.keys(MAIN_ALLOWLIST);
  assertPaths(check, root, [
    `${MAIN}/src`,
    KNIP_CONFIG,
    ...[
      ...new Set(allow.map(entry => `${MAIN}/${entry.split(' - ')[0] ?? ''}`)),
    ],
  ]);
  if (check.errors.length > 0) {
    return check;
  }
  check.sites = countExportSites(root, `${MAIN}/src`, READONLY);
  if (knip instanceof Error) {
    return fail(check, knip);
  }
  const raw = new Set(knip.exports);
  for (const entry of staleEntries(allow, raw)) {
    check.findings.push(
      finding(
        `${MAIN}/${entry.split(' - ')[0] ?? ''}`,
        `dead allowlist anchor "${entry}": remove the MAIN_ALLOWLIST entry`
      )
    );
  }
  for (const entry of knip.exports) {
    if (MAIN_ALLOWLIST[entry] === undefined) {
      check.findings.push(
        finding(
          `${MAIN}/${entry.split(' - ')[0] ?? ''}`,
          `unused export ${entry.split(' - ')[1] ?? ''} (knip): DELETE it (or just the \`export\` keyword when used in the file), or allowlist deliberate surface with a reason`,
          knip.lines?.get(entry)
        )
      );
    }
  }
  return check;
}

export function run(root: string, tools: Tools = realTools): CheckResult[] {
  const attempt = <T>(fn: () => T): T | Error => {
    try {
      return fn();
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  const knip = attempt(() => tools.knip(root));
  const tsPrune = attempt(() => tools.tsPrune(root));
  return [
    checkMainFiles(root, knip, tools),
    checkWeb1Exports(root, tsPrune),
    checkKernelExports(root),
    checkMainExports(root, knip),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('dead-code', run(projectRoot())));
}
