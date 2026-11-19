/**
 * Type shim for the Next.js compiled @vercel/og Node.js entrypoint.
 *
 * `next/dist/compiled/@vercel/og/index.node` is an ESM internal that Next.js
 * bundles but does not expose in its public type surface. The Pages Router
 * Node.js OG image pattern (see pages/api/og/stylist/[identifier].ts) imports
 * `unstable_createNodejsStream` directly from it because the edge-only
 * `ImageResponse` API does not run in Node.js API routes.
 *
 * This declaration replaces a `@ts-ignore` on the import (project rule: no
 * `ts-ignore` / `any`). Signature mirrors @vercel/og's createNodejsStream:
 * a React element + Satori/Resvg options → a Node.js Readable PNG stream.
 */
declare module 'next/dist/compiled/@vercel/og/index.node' {
  import type { ReactElement } from 'react';
  import type { Readable } from 'node:stream';

  interface CreateNodejsStreamOptions {
    width?: number;
    height?: number;
    fonts?: ReadonlyArray<{
      name: string;
      data: ArrayBuffer | Buffer;
      weight?: number;
      style?: 'normal' | 'italic';
    }>;
    emoji?: string;
    debug?: boolean;
  }

  export function unstable_createNodejsStream(
    element: ReactElement,
    options?: CreateNodejsStreamOptions
  ): Promise<Readable>;
}

// The route loads the module through a native dynamic import with the full
// file name (`index.node.js`, see loadRenderer in the OG route), which Node's
// ESM resolver needs; this alias gives that specifier the same types.
declare module 'next/dist/compiled/@vercel/og/index.node.js' {
  export { unstable_createNodejsStream } from 'next/dist/compiled/@vercel/og/index.node';
}
