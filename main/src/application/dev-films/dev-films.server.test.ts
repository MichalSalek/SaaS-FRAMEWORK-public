// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import {
  createServer,
  request,
  type Server,
  type IncomingHttpHeaders,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ENV_VARS } from '../environment/environment.config';
import { serveDevFilm } from './dev-films.server';

const environment = ENV_VARS as { NEXT_PUBLIC_NODE_ENV_MANUAL: string };
let root: string;
let server: Server;
let port: number;
let originalEnvironment: string;

function get(asset: string, options: { method?: string; range?: string } = {}) {
  return new Promise<{
    status: number;
    headers: IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/?asset=${encodeURIComponent(asset)}`,
        method: options.method ?? 'GET',
        headers: options.range ? { Range: options.range } : {},
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  originalEnvironment = environment.NEXT_PUBLIC_NODE_ENV_MANUAL;
  environment.NEXT_PUBLIC_NODE_ENV_MANUAL = 'DEVELOPMENT';
  root = await mkdtemp(path.join(os.tmpdir(), 'dev-films-'));
  const directory = path.join(root, 'src', '.dev-films');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'film-current.mp4'), '0123456789');
  await writeFile(path.join(directory, 'manifest.json'), '{"ok":true}');
  await writeFile(path.join(root, 'outside.jpg'), 'outside');
  await symlink(
    path.join(root, 'outside.jpg'),
    path.join(directory, 'film-current.jpg')
  );
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  server = createServer((req, res) => {
    const asset =
      new URL(req.url ?? '/', 'http://localhost').searchParams.get('asset') ??
      undefined;
    void serveDevFilm(req, res, asset);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  environment.NEXT_PUBLIC_NODE_ENV_MANUAL = originalEnvironment;
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve()))
  );
  await rm(root, { recursive: true, force: true });
});

describe('development film media', () => {
  it.each(['STAGING', 'PREVIEW', 'PRODUCTION'])(
    'returns 404 before resolving files in %s',
    async mode => {
      environment.NEXT_PUBLIC_NODE_ENV_MANUAL = mode;
      const cwd = vi.mocked(process.cwd);
      cwd.mockClear();
      const response = await get('film-current.mp4');
      expect(response.status).toBe(404);
      expect(cwd).not.toHaveBeenCalled();
      environment.NEXT_PUBLIC_NODE_ENV_MANUAL = 'DEVELOPMENT';
    }
  );

  it('allows only listed names and rejects missing files and escaping symlinks', async () => {
    for (const name of [
      'outside.jpg',
      '../outside.jpg',
      'film-current.mp4/../outside.jpg',
      'film-instruction.mp4',
      'film-current.jpg',
    ]) {
      expect((await get(name)).status).toBe(404);
    }
    const manifest = await get('manifest.json');
    expect(manifest.status).toBe(200);
    expect(manifest.body).toBe('{"ok":true}');
    expect(manifest.headers['content-type']).toBe(
      'application/json; charset=utf-8'
    );
    expect(manifest.headers['cache-control']).toBe('no-store');
    expect(manifest.headers['x-robots-tag']).toContain('nofollow');
    expect((await get('manifest.json', { method: 'POST' })).status).toBe(405);
  });

  it('streams the full video with media headers and supports HEAD', async () => {
    const response = await get('film-current.mp4');
    expect(response.status).toBe(200);
    expect(response.body).toBe('0123456789');
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-length']).toBe('10');
    const head = await get('film-current.mp4', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('10');
    expect(head.body).toBe('');
  });

  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-100', '89', 'bytes 8-9/10'],
    ['bytes=-100', '0123456789', 'bytes 0-9/10'],
  ])('serves %s', async (range, body, contentRange) => {
    const response = await get('film-current.mp4', { range });
    expect(response.status).toBe(206);
    expect(response.body).toBe(body);
    expect(response.headers['content-range']).toBe(contentRange);
    expect(response.headers['content-length']).toBe(String(body.length));
  });

  it('ignores range headers for HEAD and returns the full length without a body', async () => {
    const response = await get('film-current.mp4', {
      method: 'HEAD',
      range: 'bytes=2-5',
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-range']).toBeUndefined();
    expect(response.headers['content-length']).toBe('10');
    expect(response.body).toBe('');
  });

  it('continues serving requests after a client aborts a video stream', async () => {
    const size = 8 * 1024 * 1024;
    await writeFile(
      path.join(root, 'src', '.dev-films', 'film-instruction.mp4'),
      Buffer.alloc(size, 7)
    );
    const received = await new Promise<number>((resolve, reject) => {
      const req = request(
        { hostname: '127.0.0.1', port, path: '/?asset=film-instruction.mp4' },
        res => {
          res.once('data', (chunk: Buffer) => {
            res.destroy();
            resolve(chunk.length);
          });
          res.once('error', reject);
        }
      );
      req.once('error', reject);
      req.end();
    });
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(size);
    const next = await get('manifest.json');
    expect(next.status).toBe(200);
    expect(next.body).toBe('{"ok":true}');
  });

  it.each([
    'bytes=10-',
    'bytes=7-2',
    'bytes=-0',
    'bytes=0-1,3-4',
    'bytes=-',
    'items=0-1',
    'bytes=999999999999999999999-',
  ])('rejects invalid range %s', async range => {
    const response = await get('film-current.mp4', { range });
    expect(response.status).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */10');
  });
});
