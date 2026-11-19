// Bounded static model of a shell script: commands, comments, and literal words.
// A name inside echo/printf quotes is a word, not a call. A function header is
// not a call. Command substitutions are calls. Nothing here executes the script.
import { markerIn, type MarkerState } from './_ts';

export interface ShellCommand {
  readonly name: string;
  readonly args: readonly string[];
  readonly line: number;
  readonly fn: string | null;
}

export interface ShellEmail {
  readonly addr: string;
  readonly line: number;
  /** A sentence that mentions an address, not an account binding or a bare address. */
  readonly prose: boolean;
}

export interface ShellModel {
  readonly commands: readonly ShellCommand[];
  readonly comments: ReadonlyMap<number, string>;
  readonly functions: ReadonlySet<string>;
  readonly emails: readonly ShellEmail[];
}

const ADDR =
  /[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?@example\.com/g;

const STRUCTURAL = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'for',
  'in',
  'case',
  'esac',
  'select',
  'time',
  'coproc',
]);

interface Build {
  commands: ShellCommand[];
  comments: Map<number, string>;
  functions: Set<string>;
  emails: ShellEmail[];
}

export function shellModel(text: string): ShellModel {
  const build: Build = {
    commands: [],
    comments: new Map(),
    functions: new Set(),
    emails: [],
  };
  scan(text, 0, null, build);
  return build;
}

/** Comment marker state for one 1-based line. A string never counts. */
export function shellMarker(
  model: ShellModel,
  marker: string,
  line: number
): MarkerState {
  return markerIn(model.comments, marker, line, line);
}

export function shellMarkerAnywhere(
  model: ShellModel,
  marker: string
): { state: MarkerState; bareLine: number } {
  let sawReason = false;
  let bareLine = 0;
  for (const line of model.comments.keys()) {
    const state = shellMarker(model, marker, line);
    if (state === 'reason') {
      sawReason = true;
    } else if (state === 'bare' && bareLine === 0) {
      bareLine = line;
    }
  }
  if (sawReason) {
    return { state: 'reason', bareLine };
  }
  if (bareLine !== 0) {
    return { state: 'bare', bareLine };
  }
  return { state: 'none', bareLine: 0 };
}

/**
 * Commands that can run: top-level commands, plus the body of a function that
 * a reachable command actually invokes. A defined-but-uncalled function does
 * not count.
 */
export function reachableCommands(model: ShellModel): readonly ShellCommand[] {
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const command of model.commands) {
    if (command.fn === null) {
      queue.push(command.name);
    }
  }
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || !model.functions.has(name) || reached.has(name)) {
      continue;
    }
    reached.add(name);
    for (const command of model.commands) {
      if (command.fn === name) {
        queue.push(command.name);
      }
    }
  }
  return model.commands.filter(
    command => command.fn === null || reached.has(command.fn)
  );
}

export function commandInvokes(model: ShellModel, name: string): boolean {
  return reachableCommands(model).some(command => command.name === name);
}

/** `[ "$live_build_id" = "$BUILD_ID" ]` — a real comparison, not two words in a string. */
export function comparesLiveBuildId(model: ShellModel): boolean {
  return reachableCommands(model).some(command => {
    if (command.name !== '[' && command.name !== '[[' && command.name !== 'test') {
      return false;
    }
    const args = command.args.filter(arg => arg !== ']' && arg !== ']]');
    const op = args.some(arg => arg === '=' || arg === '==' || arg === '!=');
    const build = args.some(arg => /^\$\{?BUILD_ID\}?$/.test(arg));
    const live = args.some(
      arg =>
        /^\$\{?[A-Za-z0-9_]*build_id[A-Za-z0-9_]*\}?$/i.test(arg) &&
        !/^\$\{?BUILD_ID\}?$/i.test(arg)
    );
    return op && build && live;
  });
}

function scan(
  text: string,
  lineOffset: number,
  fn: string | null,
  build: Build
): void {
  const src = text.replace(/\r\n/g, '\n');
  let i = 0;
  let line = 1 + lineOffset;
  let fnDepth = 0;
  const fnAtDepth: (string | null)[] = [fn];

  const currentFn = (): string | null => fnAtDepth[fnDepth] ?? fn;

  const noteComment = (startLine: number, body: string): void => {
    build.comments.set(
      startLine,
      `${build.comments.get(startLine) ?? ''} ${body}`
    );
  };

  const skipBreak = (): void => {
    while (i < src.length) {
      const ch = src[i] ?? '';
      if (ch === '\\' && src[i + 1] === '\n') {
        i += 2;
        line += 1;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === ';' || ch === '\n') {
        if (ch === '\n') {
          line += 1;
        }
        i += 1;
        continue;
      }
      if (ch === '#') {
        const startLine = line;
        i += 1;
        let body = '';
        while (i < src.length && src[i] !== '\n') {
          body += src[i];
          i += 1;
        }
        noteComment(startLine, body);
        continue;
      }
      break;
    }
  };

  const recordEmails = (word: string, wordLine: number): void => {
    const found = word.match(ADDR) ?? [];
    if (found.length === 0) {
      return;
    }
    const left = word.split('=')[0] ?? '';
    const binding = /email/i.test(left);
    const tokens = word.trim().split(/\s+/);
    for (const addr of found) {
      const exact = word.trim() === addr;
      const prose = !binding && !exact && tokens.length > 2;
      build.emails.push({ addr, line: wordLine, prose });
    }
  };

  const takeSubst = (): void => {
    // i at '$' of $(
    i += 2;
    const start = i;
    const startLine = line;
    let depth = 1;
    let quote: "'" | '"' | null = null;
    while (i < src.length && depth > 0) {
      const ch = src[i] ?? '';
      if (quote) {
        if (quote === '"' && ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
        } else if (ch === '\n') {
          line += 1;
        }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === '\n') {
        line += 1;
      }
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      }
      i += 1;
    }
    const inner = src.slice(start, Math.max(start, i - 1));
    scan(inner, startLine - 1, currentFn(), build);
  };

  const readWord = (): { text: string; line: number } | null => {
    while (i < src.length) {
      const ch = src[i] ?? '';
      if (ch === '\\' && src[i + 1] === '\n') {
        i += 2;
        line += 1;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        i += 1;
        continue;
      }
      if (ch === '#') {
        const startLine = line;
        i += 1;
        let body = '';
        while (i < src.length && src[i] !== '\n') {
          body += src[i];
          i += 1;
        }
        noteComment(startLine, body);
        continue;
      }
      break;
    }
    if (i >= src.length) {
      return null;
    }
    const ch = src[i] ?? '';
    if (
      ch === '\n' ||
      ch === ';' ||
      ch === '|' ||
      ch === '&' ||
      ch === '(' ||
      ch === ')' ||
      ch === '<' ||
      ch === '>' ||
      ch === '{' ||
      ch === '}'
    ) {
      return null;
    }
    const startLine = line;
    let textWord = '';
    while (i < src.length) {
      const cur = src[i] ?? '';
      if (
        cur === ' ' ||
        cur === '\t' ||
        cur === '\r' ||
        cur === '\n' ||
        cur === ';' ||
        cur === '|' ||
        cur === '&' ||
        cur === '(' ||
        cur === ')' ||
        cur === '<' ||
        cur === '>' ||
        cur === '{' ||
        cur === '}' ||
        cur === '#'
      ) {
        break;
      }
      if (cur === '\\' && src[i + 1] === '\n') {
        i += 2;
        line += 1;
        continue;
      }
      if (cur === "'") {
        i += 1;
        while (i < src.length && src[i] !== "'") {
          textWord += src[i];
          if (src[i] === '\n') {
            line += 1;
          }
          i += 1;
        }
        if (src[i] === "'") {
          i += 1;
        }
        continue;
      }
      if (cur === '"') {
        i += 1;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < src.length) {
            const next = src[i + 1] ?? '';
            textWord += next;
            if (next === '\n') {
              line += 1;
            }
            i += 2;
            continue;
          }
          if (src[i] === '$' && src[i + 1] === '(' && src[i + 2] !== '(') {
            takeSubst();
            continue;
          }
          textWord += src[i];
          if (src[i] === '\n') {
            line += 1;
          }
          i += 1;
        }
        if (src[i] === '"') {
          i += 1;
        }
        continue;
      }
      if (cur === '$' && src[i + 1] === '(' && src[i + 2] !== '(') {
        takeSubst();
        continue;
      }
      if (cur === '`') {
        i += 1;
        const start = i;
        const startLineInner = line;
        while (i < src.length && src[i] !== '`') {
          if (src[i] === '\n') {
            line += 1;
          }
          i += 1;
        }
        const inner = src.slice(start, i);
        if (src[i] === '`') {
          i += 1;
        }
        scan(inner, startLineInner - 1, currentFn(), build);
        continue;
      }
      textWord += cur;
      i += 1;
    }
    if (textWord === '' && startLine === line && i >= src.length) {
      return null;
    }
    recordEmails(textWord, startLine);
    return { text: textWord, line: startLine };
  };

  const atParenPair = (): boolean => {
    let j = i;
    while (j < src.length && (src[j] === ' ' || src[j] === '\t')) {
      j += 1;
    }
    return src[j] === '(' && src[j + 1] === ')';
  };

  const consumeParenPair = (): void => {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) {
      i += 1;
    }
    if (src[i] === '(' && src[i + 1] === ')') {
      i += 2;
    }
  };

  const openFunction = (name: string): void => {
    build.functions.add(name);
    consumeParenPair();
    skipBreak();
    if (src[i] === '{') {
      i += 1;
      fnDepth += 1;
      fnAtDepth[fnDepth] = name;
    }
  };

  while (i < src.length) {
    skipBreak();
    if (i >= src.length) {
      break;
    }
    if (src[i] === '{') {
      i += 1;
      fnDepth += 1;
      fnAtDepth[fnDepth] = currentFn();
      continue;
    }
    if (src[i] === '}') {
      i += 1;
      if (fnDepth > 0) {
        fnAtDepth[fnDepth] = null;
        fnDepth -= 1;
      }
      continue;
    }
    if (src[i] === '(' || src[i] === ')') {
      i += 1;
      continue;
    }
    if (
      src[i] === '|' ||
      src[i] === '&' ||
      src[i] === '<' ||
      src[i] === '>' ||
      src[i] === ';' ||
      src[i] === '\n'
    ) {
      if (src[i] === '<' || src[i] === '>') {
        while (src[i] === '<' || src[i] === '>') {
          i += 1;
        }
        readWord();
        continue;
      }
      if (src[i] === '\n') {
        line += 1;
      }
      i += 1;
      continue;
    }
    const first = readWord();
    if (!first) {
      if (src[i] === '\n') {
        line += 1;
      }
      if (i < src.length) {
        i += 1;
      }
      continue;
    }
    if (first.text === 'function') {
      const name = readWord();
      if (name && name.text !== '') {
        openFunction(name.text);
      }
      continue;
    }
    if (first.text !== '' && atParenPair() && !first.text.startsWith('-')) {
      openFunction(first.text);
      continue;
    }
    if (first.text === '!') {
      continue;
    }
    if (STRUCTURAL.has(first.text)) {
      continue;
    }
    let name = first.text;
    const args: string[] = [];
    const cmdLine = first.line;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) {
      const next = readWord();
      if (!next) {
        continue;
      }
      name = next.text;
      if (name === '!') {
        continue;
      }
      if (STRUCTURAL.has(name)) {
        continue;
      }
    }
    while (i < src.length) {
      const ch = src[i] ?? '';
      if (
        ch === '\n' ||
        ch === ';' ||
        ch === '|' ||
        ch === '&' ||
        ch === '{' ||
        ch === '}' ||
        ch === '(' ||
        ch === ')'
      ) {
        break;
      }
      if (ch === '<' || ch === '>') {
        while (src[i] === '<' || src[i] === '>') {
          i += 1;
        }
        readWord();
        continue;
      }
      const word = readWord();
      if (!word) {
        break;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text) && args.length === 0) {
        continue;
      }
      args.push(word.text);
    }
    if (name !== '') {
      build.commands.push({
        name,
        args,
        line: cmdLine,
        fn: currentFn(),
      });
    }
  }
}
