export const NAIL_LENGTHS = Object.freeze({
  SHORT: 'SHORT',
  MEDIUM: 'MEDIUM',
  LONG: 'LONG',
  XL: 'XL',
} as const);

export type NailLength = (typeof NAIL_LENGTHS)[keyof typeof NAIL_LENGTHS];
