import valueParser from 'postcss-value-parser';
import {
  colorFromChannels,
  legacyVariableName,
  literalChannels,
  mixChannelExpressions,
  parseColorLiteral,
  type ColorChannels,
} from './color-space.ts';

export type ColorValueOptions = {
  resolveVariable: (name: string, fallback?: ColorChannels) => ColorChannels;
  colorChannels?: boolean;
};

type Node = valueParser.Node;
type FunctionNode = valueParser.FunctionNode;

const significant = (nodes: readonly Node[]): Node[] =>
  nodes.filter(node => node.type !== 'space' && node.type !== 'comment');

function commaGroups(nodes: readonly Node[]): Node[][] {
  const groups: Node[][] = [[]];
  for (const node of nodes) {
    if (node.type === 'div' && node.value === ',') {
      groups.push([]);
    } else {
      groups[groups.length - 1]?.push(node);
    }
  }
  return groups;
}

/** Comments are CSS whitespace for color parsing, but are retained in emitted values. */
const colorText = (node: Node): string =>
  valueParser.stringify(node, child =>
    child.type === 'comment' ? ' ' : undefined
  );

function colorComments(node: Node): string {
  if (node.type === 'comment') {
    return valueParser.stringify(node);
  }
  return node.type === 'function' ? node.nodes.map(colorComments).join('') : '';
}

const UNSUPPORTED_COLORS = new Set([
  'oklab',
  'lab',
  'lch',
  'color',
  'device-cmyk',
]);
const RELATIVE_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
function assertSupported(node: FunctionNode): void {
  const name = node.value.toLowerCase();
  const first = significant(node.nodes)[0];
  if (
    UNSUPPORTED_COLORS.has(name) ||
    (RELATIVE_FUNCTIONS.has(name) &&
      first?.type === 'word' &&
      first.value.toLowerCase() === 'from')
  ) {
    throw new Error(`Unsupported CSS color function: ${name}`);
  }
}

const PERCENT = /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?%$/i;

/**
 * Converts only modern colors. The caller supplies variable channels; ordinary structural
 * variables are traversed for fallback colors but are never resolved as colors themselves.
 */
export function transformCssColorValue(
  value: string,
  options: ColorValueOptions
): { legacy: string; changed: boolean; channels?: ColorChannels } {
  const parsed = valueParser(value);
  const replacements = new Map<Node, string>();
  const colors = new Map<Node, ColorChannels>();

  function variable(node: FunctionNode): ColorChannels {
    if (node.unclosed) {
      throw new Error('Unclosed CSS color variable');
    }
    const groups = commaGroups(node.nodes);
    const names = significant(groups[0] ?? []);
    if (groups.length > 2 || names.length !== 1 || names[0]?.type !== 'word') {
      throw new Error('Invalid CSS color variable');
    }
    const name = names[0].value;
    legacyVariableName(name);
    const fallback =
      groups.length === 2 ? endpoint(groups[1] ?? []) : undefined;
    return options.resolveVariable(name, fallback);
  }

  function endpoint(nodes: readonly Node[]): ColorChannels {
    const items = significant(nodes);
    if (items.length !== 1) {
      throw new Error('Unresolvable CSS color endpoint');
    }
    const node = items[0];
    if (node.type === 'function') {
      if (node.unclosed) {
        throw new Error('Unclosed CSS color endpoint');
      }
      assertSupported(node);
      const name = node.value.toLowerCase();
      if (name === 'var') {
        return variable(node);
      }
      if (name === 'color-mix') {
        return mix(node);
      }
      if (name === 'oklch') {
        return oklch(node);
      }
    }
    if (node.type === 'word' && node.value.toLowerCase() === 'currentcolor') {
      throw new Error('currentColor cannot be resolved as a mix endpoint');
    }
    const color = parseColorLiteral(colorText(node));
    if (!color) {
      throw new Error('Unresolvable CSS color endpoint');
    }
    return literalChannels(color);
  }

  function oklch(node: FunctionNode): ColorChannels {
    if (node.unclosed) {
      throw new Error('Unclosed OKLCH color');
    }
    const color = parseColorLiteral(colorText(node));
    if (!color) {
      throw new Error('Unsupported or invalid OKLCH color');
    }
    return literalChannels(color);
  }

  function stop(nodes: readonly Node[]): {
    color: ColorChannels;
    weight?: number;
  } {
    const items = significant(nodes);
    if (items.length === 1) {
      return { color: endpoint(items) };
    }
    if (
      items.length !== 2 ||
      items[1]?.type !== 'word' ||
      !PERCENT.test(items[1].value)
    ) {
      throw new Error('Invalid CSS color mix stop or weight');
    }
    const first = nodes.indexOf(items[0] as Node);
    const second = nodes.indexOf(items[1]);
    if (
      !nodes
        .slice(first + 1, second)
        .some(node => node.type === 'space' || node.type === 'comment')
    ) {
      throw new Error('CSS color mix weight must follow a separator');
    }
    const weight = Number(items[1].value.slice(0, -1));
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new Error('Invalid CSS color mix weight');
    }
    return { color: endpoint([items[0] as Node]), weight };
  }

  function mix(node: FunctionNode): ColorChannels {
    if (node.unclosed) {
      throw new Error('Unclosed CSS color mix');
    }
    const groups = commaGroups(node.nodes);
    const space = significant(groups[0] ?? []);
    if (
      groups.length !== 3 ||
      space.length !== 2 ||
      space[0]?.type !== 'word' ||
      space[0].value.toLowerCase() !== 'in' ||
      space[1]?.type !== 'word' ||
      !['oklch', 'srgb'].includes(space[1].value.toLowerCase())
    ) {
      throw new Error('Unsupported CSS color mix interpolation');
    }
    const left = stop(groups[1] ?? []);
    const right = stop(groups[2] ?? []);
    const leftWeight =
      left.weight ?? (right.weight === undefined ? 50 : 100 - right.weight);
    const rightWeight =
      right.weight ?? (left.weight === undefined ? 50 : 100 - left.weight);
    const total = leftWeight + rightWeight;
    if (total <= 0) {
      throw new Error('Invalid CSS color mix weights');
    }
    return mixChannelExpressions(
      left.color,
      right.color,
      leftWeight / total,
      rightWeight / total,
      Math.min(total / 100, 1)
    );
  }

  function visit(nodes: readonly Node[]): void {
    for (const node of nodes) {
      if (node.type !== 'function') {
        continue;
      }
      assertSupported(node);
      const name = node.value.toLowerCase();
      if (name === 'oklch' || name === 'color-mix') {
        const channels = name === 'oklch' ? oklch(node) : mix(node);
        colors.set(node, channels);
        replacements.set(
          node,
          colorComments(node) + colorFromChannels(channels)
        );
      } else {
        visit(node.nodes);
      }
    }
  }

  const root = significant(parsed.nodes);
  const only = root.length === 1 ? root[0] : undefined;
  if (
    options.colorChannels &&
    only?.type === 'function' &&
    only.value.toLowerCase() === 'var'
  ) {
    const channels = variable(only);
    colors.set(only, channels);
    replacements.set(only, colorComments(only) + colorFromChannels(channels));
  } else {
    visit(parsed.nodes);
  }
  const legacy = valueParser.stringify(parsed.nodes, node =>
    replacements.get(node)
  );
  const channels =
    options.colorChannels && only
      ? (colors.get(only) ??
        (() => {
          const color = parseColorLiteral(colorText(only));
          return color ? literalChannels(color) : undefined;
        })())
      : undefined;
  return channels
    ? { legacy, changed: legacy !== value, channels }
    : { legacy, changed: legacy !== value };
}
