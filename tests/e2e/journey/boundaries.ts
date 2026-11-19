// tests/e2e/journey/boundaries.ts
//
// The external boundaries of the journey and what replaces each. Everything the browser would send
// outside the two local servers goes through `installBoundaries`:
//   Cloudinary upload API -> FakeCloudinary: answers the unsigned upload with the vendor contract
//       { asset_id, public_id, secure_url, ... } after checking the request (file, preset, EXIF flag, folder)
//   Cloudinary CDN        -> FakeCloudinary: serves the uploaded bytes for any transformation of that
//       public_id; an unknown public_id is a 404
//   any other host        -> aborted and recorded; the spec asserts the list is empty
// Mail is replaced server-side (Mailpit, mail-sink.ts); Stripe, push, analytics, Turnstile and OAuth
// are absent by configuration (tests/ci/e2e-env.sh).
// A stand-in for the provider, not a proof of it: green means the app speaks the documented contract.
// E2E_BREAK (sabotage proving each step can go red): `upload` answers like a rejected unsigned upload
// (400 + error), `save` returns an address on a foreign cloud (the backend validator must refuse it).

import { randomBytes } from 'node:crypto';
import type { BrowserContext, Request, Route } from '@playwright/test';

/** The cloud the kernel validator pins (`.shared-kernel/policies/validation/validation.utils.ts`). */
export const CANONICAL_CLOUD = 'example-cloud';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

type StoredAsset = { bytes: Buffer; contentType: string };

type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  body: Buffer;
};

const parseMultipart = (request: Request): MultipartPart[] => {
  const header = request.headers()['content-type'] ?? '';
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(header);
  const body = request.postDataBuffer();
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker || !body) {
    return [];
  }
  const delimiter = Buffer.from(`--${marker}`);
  const parts: MultipartPart[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) {
      break;
    }
    const chunk = body.subarray(start + delimiter.length + 2, next - 2);
    const split = chunk.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = chunk.subarray(0, split).toString('utf8');
      const name = /name="([^"]*)"/.exec(head)?.[1] ?? '';
      const filename = /filename="([^"]*)"/.exec(head)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
      parts.push({
        name,
        ...(filename !== undefined ? { filename } : {}),
        ...(contentType !== undefined ? { contentType } : {}),
        body: chunk.subarray(split + 4),
      });
    }
    start = next;
  }
  return parts;
};

export class FakeCloudinary {
  readonly uploads: Array<{
    publicId: string;
    bytes: number;
    secureUrl: string;
  }> = [];
  /** Every upload request that reached the boundary, with the reason when it was refused. */
  readonly attempts: Array<{ accepted: boolean; reason?: string }> = [];
  readonly cdnHits: string[] = [];
  readonly blocked: string[] = [];
  private readonly assets = new Map<string, StoredAsset>();

  constructor(private readonly breakStep: string) {}

  async handleUpload(route: Route): Promise<void> {
    const request = route.request();
    const cors = { 'access-control-allow-origin': '*' };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'POST' },
      });
      return;
    }
    const url = new URL(request.url());
    const parts = parseMultipart(request);
    const field = (name: string): string | undefined =>
      parts.find(p => p.name === name)?.body.toString('utf8');
    const file = parts.find(p => p.name === 'file');
    // The request contract the app must keep (galleryIO.possibilities.api.ts uploadImageToVendor_IO).
    const problems = [
      url.pathname.endsWith('/image/upload') ? null : `path ${url.pathname}`,
      request.method() === 'POST' ? null : `method ${request.method()}`,
      file && file.body.length > 0 ? null : 'no file part',
      field('upload_preset') === 'ml_default'
        ? null
        : `upload_preset=${field('upload_preset')}`,
      field('flags') === 'strip_profile'
        ? null
        : `flags=${field('flags')} (EXIF strip missing)`,
      field('folder') ? null : 'no folder',
    ].filter((p): p is string => p !== null);

    if (problems.length > 0 || this.breakStep === 'upload' || !file) {
      this.attempts.push({
        accepted: false,
        reason: problems.join('; ') || 'E2E_BREAK=upload',
      });
      await route.fulfill({
        status: 400,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message:
              problems.join('; ') ||
              'Upload preset not found (E2E_BREAK=upload)',
          },
        }),
      });
      return;
    }

    const folder = field('folder') ?? 'nailfolio';
    const publicId = `${folder}/e2e-${randomBytes(6).toString('hex')}`;
    const contentType = file.contentType ?? 'image/jpeg';
    const format =
      contentType.split('/')[1] === 'png'
        ? 'png'
        : contentType.split('/')[1] === 'webp'
          ? 'webp'
          : 'jpg';
    const version = Math.floor(Date.now() / 1000);
    const cloud = this.breakStep === 'save' ? 'not-our-cloud' : CANONICAL_CLOUD;
    // DECISION: the address carries the CANONICAL cloud although the request went to the fake cloud
    // name the build was given (e2e-env.sh). The kernel validator pins the canonical cloud, and the
    // build must NOT carry the real cloud name: if interception ever failed, the browser would
    // upload to a non-existent cloud, never to the production account.
    const secureUrl = `https://res.cloudinary.com/${cloud}/image/upload/v${version}/${publicId}.${format}`;
    this.assets.set(publicId, { bytes: Buffer.from(file.body), contentType });
    this.uploads.push({ publicId, bytes: file.body.length, secureUrl });
    this.attempts.push({ accepted: true });
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({
        asset_id: randomBytes(16).toString('hex'),
        public_id: publicId,
        version,
        format,
        resource_type: 'image',
        type: 'upload',
        bytes: file.body.length,
        secure_url: secureUrl,
        url: secureUrl.replace('https://', 'http://'),
        original_filename: file.filename ?? 'blob',
      }),
    });
  }

  async handleCdn(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    this.cdnHits.push(url.pathname);
    // /<cloud>/image/upload/[transformations/]v<version>/<public_id>.<ext>
    const match = /\/image\/upload\/(?:.*\/)?v\d+\/(.+)\.[a-z0-9]+$/i.exec(
      url.pathname
    );
    const asset = match?.[1] ? this.assets.get(match[1]) : undefined;
    if (!asset) {
      await route.fulfill({ status: 404, body: 'not found (fake CDN)' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: asset.contentType,
      body: asset.bytes,
    });
  }
}

/** Route every non-local request of the context through the fakes or the block list. */
export async function installBoundaries(
  context: BrowserContext,
  fake: FakeCloudinary
): Promise<void> {
  await context.route(
    url => !LOCAL_HOSTS.has(url.hostname),
    async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'api.cloudinary.com') {
        await fake.handleUpload(route);
        return;
      }
      if (url.hostname === 'res.cloudinary.com') {
        await fake.handleCdn(route);
        return;
      }
      fake.blocked.push(
        `${route.request().method()} ${url.origin}${url.pathname}`
      );
      await route.abort('blockedbyclient');
    }
  );
}
