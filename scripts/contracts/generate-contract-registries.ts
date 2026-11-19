/**
 * generate-contract-registries: writes the legacy registries from the kernel API contracts.
 * `npm run system:contracts` regenerates; `-- --check` exits 1 when a region or file is stale.
 * Contract fields → generated output:
 *   key + group + kind  → APP_EVENTS.<COMMANDS|QUERIES>.<group>   (region events:<KIND>:<group>)
 *   route               → ROUTES_API                              (region routes)
 *   method              → API_HTTP_METHODS                        (region methods)
 *   access              → role-permission layers                  (regions grants:<layer>)
 *   limiterTier strict  → RATE_LIMIT_CONFIG.STRICT_ENDPOINTS      (region strict-routes, web-1)
 *   whole domain        → models/<area>/<area>.dto.ts             (whole file, or part files when one file would exceed the line ceiling)
 *
 * A region is the text between `// <generated:contracts:ID>` and `// </generated:contracts:ID>`.
 * A domain whose event group has no region yet fails with the markers to add. Output goes
 * through prettier so `--check` compares formatted text.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import {
  API_CONTRACT_LIST,
  CONTRACT_DOMAINS,
} from '../../.shared-kernel/application/contracts/api-contracts.registry';
import type {
  ApiContract,
  ContractAccess,
} from '../../.shared-kernel/application/contracts/contract.types';
import {
  applyGeneratedChanges,
  extractContractManual,
  fillRegions,
  findIllegalContracts,
  quoteContractSummary,
} from './registry-regions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KERNEL = resolve(ROOT, '.shared-kernel');
const CHECK = process.argv.includes('--check');

const FILES = {
  events: resolve(KERNEL, 'domain/events/app-events.const.ts'),
  routes: resolve(KERNEL, 'domain/routing/routing.config.ts'),
  methods: resolve(KERNEL, 'domain/http/http-methods.config.ts'),
  grants: resolve(KERNEL, 'application/role-permissions.ts'),
  strict: resolve(ROOT, 'web-1/src/application/http/rate-limit.middleware.ts'),
} as const;

/** Role-permission layers each access level is granted in (role-permissions.ts layering). */
const GRANT_LAYERS: Record<ContractAccess, readonly string[]> = {
  PUBLIC: ['PUBLIC'],
  PUBLIC_NO_GRANT: [],
  LOGGED_IN: ['LOGGED_IN'],
  STYLIST: ['STYLIST'],
  CLIENT: ['CLIENT'],
  STYLIST_AND_CLIENT: ['STYLIST', 'CLIENT'],
  ADMIN: [],
};
const ALL_LAYERS = ['PUBLIC', 'LOGGED_IN', 'STYLIST', 'CLIENT'] as const;

const eventRef = (c: ApiContract): string => {
  if (c.kind === 'CONFIRMATION') {
    return `APP_EVENTS.CONFIRMATIONS.${c.key}`;
  }
  const bucket = c.kind === 'COMMAND' ? 'COMMANDS' : 'QUERIES';
  return `APP_EVENTS.${bucket}.${c.group}.${c.key}`;
};

/** Region id → generated lines (without indentation). */
const buildRegions = (): Map<string, Map<string, string[]>> => {
  const byFile = new Map<string, Map<string, string[]>>();
  const add = (file: string, id: string, line?: string): void => {
    const regions = byFile.get(file) ?? new Map<string, string[]>();
    byFile.set(file, regions);
    const lines = regions.get(id) ?? [];
    regions.set(id, lines);
    if (line !== undefined) {
      lines.push(line);
    }
  };
  // Every fixed region exists even when no contract fills it, so a stale entry is removed.
  add(FILES.routes, 'routes');
  add(FILES.methods, 'methods');
  add(FILES.strict, 'strict-routes');
  for (const layer of ALL_LAYERS) {
    add(FILES.grants, `grants:${layer}`);
  }
  for (const c of API_CONTRACT_LIST) {
    if (c.kind === 'COMMAND' || c.kind === 'QUERY') {
      const bucket = c.kind === 'COMMAND' ? 'COMMANDS' : 'QUERIES';
      add(FILES.events, `events:${bucket}:${c.group}`, `${c.key}: '${c.key}',`);
    }
    add(FILES.routes, 'routes', `${c.key}: \`\${API_VER}${c.path}\`,`);
    add(FILES.methods, 'methods', `${c.key}: '${c.method}',`);
    for (const layer of GRANT_LAYERS[c.access]) {
      add(FILES.grants, `grants:${layer}`, `${eventRef(c)},`);
    }
    if (c.limiterTier === 'strict') {
      add(FILES.strict, 'strict-routes', `ROUTES_API.${c.key},`);
    }
  }
  return byFile;
};

/**
 * Entries only a contract may produce: outside the generated region a hand-written grant of a
 * contract operation or a hand-listed strict route of a contract would widen access or change the
 * limiter tier behind the contract's back.
 */
const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forbiddenOutside = (file: string): RegExp[] => {
  if (file === FILES.grants) {
    return API_CONTRACT_LIST.map(c => new RegExp(`${escape(eventRef(c))}\\b`));
  }
  if (file === FILES.strict) {
    return API_CONTRACT_LIST.map(
      c => new RegExp(`ROUTES_API\\.${escape(c.key)}\\b`)
    );
  }
  return [];
};

const DTO_PART_LINE_BUDGET = 300;

const dtoOutputs = (
  domain: (typeof CONTRACT_DOMAINS)[number]
): Map<string, string> => {
  const dtoPath = resolve(KERNEL, domain.dto.file);
  const toKernel = (p: string): string => {
    const rel = relative(dirname(dtoPath), resolve(KERNEL, p)).replace(
      /\.ts$/,
      ''
    );
    return rel.startsWith('.') ? rel : `./${rel}`;
  };
  const contracts: Readonly<Record<string, ApiContract>> = domain.contracts;
  const t = domain.typeName;
  const blockList = Object.entries(contracts).map(
    ([key, contract]) => `  /** ${quoteContractSummary(contract.summary)} */
  ${key}: {
    REQUEST: ContractRequest<${t}['${key}']>;
    RESPONSE: ContractResponse<${t}['${key}']>;
    RESPONSE_ERROR: ContractResponseError<${t}['${key}']>;
    IO_CLIENT_FUNCTION: ContractIOClientFunction<${t}['${key}']>;
  };`
  );
  const manual = extractContractManual(
    existsSync(dtoPath) ? readFileSync(dtoPath, 'utf8') : ''
  );
  const prefix = manual === null ? '' : `${manual}\n\n`;
  const extraName = `${domain.dto.typeName}_EXTRA`;
  const hasExtra =
    manual !== null && manual.includes(`export type ${extraName}`);
  const header = `// GENERATED by \`npm run system:contracts\` from ${domain.source}.
// Do not edit: change the contract and regenerate. Legacy DTO view for existing consumers.
import type {
  ContractIOClientFunction,
  ContractRequest,
  ContractResponse,
  ContractResponseError,
} from '${toKernel('application/contracts/contract.types.ts')}';
import type { ${t} } from '${toKernel(domain.source)}';
`;
  const singleBody = blockList.join('\n');
  const singleDecl = hasExtra
    ? `export type ${domain.dto.typeName} = {\n${singleBody}\n} & ${extraName};`
    : `export type ${domain.dto.typeName} = {\n${singleBody}\n};`;
  const single = `${prefix}${header}\n${singleDecl}\n`;
  const out = new Map<string, string>();
  if (single.split('\n').length <= 340) {
    out.set(dtoPath, single);
    return out;
  }
  const chunks: string[][] = [];
  let current: string[] = [];
  let lines = 0;
  for (const block of blockList) {
    const size = block.split('\n').length + 1;
    if (current.length > 0 && lines + size > DTO_PART_LINE_BUDGET) {
      chunks.push(current);
      current = [];
      lines = 0;
    }
    current.push(block);
    lines += size;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  const stem =
    domain.dto.file
      .replace(/\.dto\.ts$/, '')
      .split('/')
      .pop() ?? 'part';
  const partTypes = chunks.map(
    (_, index) => `${domain.dto.typeName}_PART_${index + 1}`
  );
  chunks.forEach((chunk, index) => {
    const partType =
      partTypes[index] ?? `${domain.dto.typeName}_PART_${index + 1}`;
    const partPath = resolve(
      dirname(dtoPath),
      `${stem}-part-${index + 1}.dto.ts`
    );
    out.set(
      partPath,
      `${header}\nexport type ${partType} = {\n${chunk.join('\n')}\n};\n`
    );
  });
  const partImports = partTypes
    .map(
      (partType, index) =>
        `import type { ${partType} } from './${stem}-part-${index + 1}.dto';`
    )
    .join('\n');
  const joined = partTypes.join(' &\n  ');
  const splitDecl = hasExtra
    ? `export type ${domain.dto.typeName} =\n  ${joined} &\n  ${extraName};`
    : `export type ${domain.dto.typeName} =\n  ${joined};`;
  out.set(dtoPath, `${prefix}${partImports}\n\n${splitDecl}\n`);
  return out;
};

const format = async (file: string, text: string): Promise<string> => {
  const config = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(text, { ...config, filepath: file });
};

const main = async (): Promise<void> => {
  const problems: string[] = [];
  const outputs = new Map<string, string>();
  const staleParts: string[] = [];

  problems.push(...findIllegalContracts(API_CONTRACT_LIST));
  for (const [file, regions] of buildRegions()) {
    const source = readFileSync(file, 'utf8');
    const filled = fillRegions(
      relative(ROOT, file),
      source,
      regions,
      forbiddenOutside(file)
    );
    problems.push(...filled.problems);
    outputs.set(file, await format(file, filled.text));
  }
  for (const domain of CONTRACT_DOMAINS) {
    for (const [file, text] of dtoOutputs(domain)) {
      outputs.set(file, await format(file, text));
    }
    const dtoPath = resolve(KERNEL, domain.dto.file);
    const dir = dirname(dtoPath);
    const stem =
      domain.dto.file
        .replace(/\.dto\.ts$/, '')
        .split('/')
        .pop() ?? '';
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(`${stem}-part-`) || !name.endsWith('.dto.ts')) {
        continue;
      }
      const full = resolve(dir, name);
      if (outputs.has(full)) {
        continue;
      }
      if (CHECK) {
        problems.push(`${relative(ROOT, full)} is a stale DTO part file`);
      } else {
        staleParts.push(full);
      }
    }
  }
  if (problems.length > 0) {
    console.error(
      `✗ rejestry z kontraktów: problemy (${problems.length})\n  ${problems.join('\n  ')}`
    );
    process.exit(1);
  }

  const stale: string[] = [];
  const writes = new Map<string, string>();
  for (const [file, text] of outputs) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (current === text) {
      continue;
    }
    stale.push(relative(ROOT, file));
    if (!CHECK) {
      writes.set(file, text);
    }
  }
  if (CHECK && stale.length > 0) {
    console.error(
      `✗ rejestry wygenerowane z kontraktów są nieświeże (kontrakt zmieniony bez regeneracji):\n  ${stale.join('\n  ')}\n` +
        '  Napraw: npm run system:contracts, potem npm run system:kernel'
    );
    process.exit(1);
  }
  if (!CHECK)
    applyGeneratedChanges(writes, staleParts, {
      read: file => (existsSync(file) ? readFileSync(file, 'utf8') : null),
      write: (file, text) => writeFileSync(file, text),
      remove: file => {
        if (existsSync(file)) unlinkSync(file);
      },
    });
  console.log(
    CHECK
      ? `✓ rejestry z kontraktów świeże (kontrakty: ${API_CONTRACT_LIST.length}, pliki: ${outputs.size})`
      : `✓ rejestry z kontraktów zapisane (kontrakty: ${API_CONTRACT_LIST.length}, zmienione pliki: ${stale.length} z ${outputs.size})`
  );
};

void main();
