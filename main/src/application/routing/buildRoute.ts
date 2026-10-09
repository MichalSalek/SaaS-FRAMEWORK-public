/**
 * buildRoute — type-safe path param interpolation for ROUTES_FRONT / ROUTES_API templates.
 *
 * Given a route template like '/app/gallery/[id]', TypeScript infers that params
 * `{ id: string }` are required. Templates without `[...]` accept an empty object.
 *
 * Usage:
 *   buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: '123' })   // '/app/photo/123'
 *   buildRoute(ROUTES_FRONT.BLOG_POST, { slug: 'hello' })  // '/blog/hello'
 *   buildRoute(ROUTES_FRONT.GALLERY)                       // '/app/gallery'
 */

/**
 * Recursively extracts all `[param]` names from a route template string as a
 * union of string literal types.
 *
 * ExtractParamNames<'/app/[type]/[id]'> → 'type' | 'id'
 * ExtractParamNames<'/app/gallery'>     → never
 */
type ExtractParamNames<T extends string> =
  T extends `${infer _Before}[${infer Param}]${infer Rest}`
    ? Param | ExtractParamNames<Rest>
    : never;

/**
 * Maps extracted param names to `{ [name]: string }`.
 * When T has no params, resolves to `Record<string, never>` (empty object type).
 */
type RouteParams<T extends string> = [ExtractParamNames<T>] extends [never]
  ? Record<string, never>
  : { [K in ExtractParamNames<T>]: string };

/**
 * buildRoute overloads:
 *   1. Template with params  → params object is required.
 *   2. Template without params → params argument is optional (may be omitted).
 */
export function buildRoute<T extends string>(
  template: T,
  ...args: [ExtractParamNames<T>] extends [never]
    ? [params?: Record<string, never>]
    : [params: RouteParams<T>]
): string {
  const params = args[0];
  if (params === undefined || Object.keys(params).length === 0) {
    return template;
  }
  let result: string = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`[${key}]`, encodeURIComponent(value));
  }
  return result;
}
