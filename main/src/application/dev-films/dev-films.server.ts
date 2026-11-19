import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { IS_DEVELOPMENT_ENV } from '../environment/environment.possibilities.api';
import { DEV_FILM_ASSETS } from './dev-films.contract';

const mimeTypes: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.srt': 'application/x-subrip; charset=utf-8',
};

type ByteRange = { start: number; end: number };

function parseRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) {
    return null;
  }
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  ) {
    return null;
  }
  if (first === null) {
    if (last === null || last === 0) {
      return null;
    }
    return { start: Math.max(size - last, 0), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) {
    return null;
  }
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

export async function serveDevFilm(
  req: IncomingMessage,
  res: ServerResponse,
  asset: string | string[] | undefined
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!IS_DEVELOPMENT_ENV()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }
  if (
    typeof asset !== 'string' ||
    !DEV_FILM_ASSETS.some(name => name === asset)
  ) {
    res.statusCode = 404;
    res.end();
    return;
  }

  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const directory = path.join(process.cwd(), 'src', '.dev-films');
    if ((await lstat(directory)).isSymbolicLink()) {
      throw new Error('Symlink directory');
    }
    const root = await realpath(directory);
    const candidate = path.join(directory, asset);
    const resolved = await realpath(candidate);
    if (path.dirname(resolved) !== root) {
      throw new Error('Outside asset directory');
    }
    file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) {
      throw new Error('Not a file');
    }

    const isVideo = path.extname(asset) === '.mp4';
    const rangeHeader =
      isVideo && req.method === 'GET' ? req.headers.range : undefined;
    const range = rangeHeader ? parseRange(rangeHeader, stat.size) : null;
    if (rangeHeader && !range) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.setHeader('Content-Type', mimeTypes[path.extname(asset)]);
    if (isVideo) {
      res.setHeader('Accept-Ranges', 'bytes');
    }
    if (range) {
      res.statusCode = 206;
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${stat.size}`
      );
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Length', stat.size);
    }
    if (req.method === 'HEAD' || stat.size === 0) {
      res.end();
      return;
    }
    await pipeline(file.createReadStream({ ...range, autoClose: false }), res);
  } catch (error) {
    if (res.destroyed) {
      return;
    }
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
    } else {
      res.statusCode = 404;
      res.end();
    }
  } finally {
    await file?.close();
  }
}
