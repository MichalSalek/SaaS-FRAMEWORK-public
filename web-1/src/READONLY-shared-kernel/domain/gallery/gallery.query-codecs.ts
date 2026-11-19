import type { QueryField } from '../../application/contracts/query-fields';

/**
 * The client sends an array. The serializer repeats the key. A comma-joined string and a repeated
 * key both decode to the same string array.
 */
export const idList = (): QueryField<
  readonly string[],
  string[] | undefined
> => ({
  decode: raw => {
    const ids: string[] = [];
    const add = (value: string) => {
      for (const part of value.split(',')) {
        if (part.length > 0) {
          ids.push(part);
        }
      }
    };
    if (typeof raw === 'string') {
      add(raw);
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        add(item);
      }
    }
    return ids.length > 0 ? ids : undefined;
  },
});

/**
 * A present query number, including NaN and fractions. Missing or empty stays absent.
 * QUERY_FIELD.int would floor and fall back, which hides the 400 the public schema owns.
 */
export const strictNumber = (): QueryField<number, number | undefined> => ({
  decode: raw => {
    if (typeof raw !== 'string' || raw.length === 0) {
      return undefined;
    }
    return Number(raw);
  },
});

/** Client must send it. Missing or repeated becomes '' so the schema's min(1) still 400s. */
export const presentString = (): QueryField<string, string> & {
  readonly required: true;
} => ({
  required: true,
  decode: raw => (typeof raw === 'string' ? raw : ''),
});
