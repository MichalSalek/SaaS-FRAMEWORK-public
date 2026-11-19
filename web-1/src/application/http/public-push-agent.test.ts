import { expect, it, vi } from 'vitest';
import { Agent, request } from 'node:https';
import { createServer } from 'node:net';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { createPublicPushLookup } from './public-push-agent';

const lookupResult = async (
  addresses: LookupAddress[],
  options: LookupOptions = { all: true }
) => {
  const resolve = vi.fn(async () => addresses);
  const lookup = createPublicPushLookup(resolve);
  const result = await new Promise<{
    error: Error | null;
    address: string | LookupAddress[];
    family: number | undefined;
  }>(done => {
    lookup('push.example.test', options, (error, address, family) => {
      done({ error, address, family });
    });
  });
  expect(resolve).toHaveBeenCalledTimes(1);
  return result;
};

it.each([
  ['127.0.0.1', 4],
  ['10.0.0.1', 4],
  ['169.254.169.254', 4],
  ['100.64.0.1', 4],
  ['192.168.1.1', 4],
  ['::1', 6],
  ['fd00::1', 6],
  ['fe80::1', 6],
  ['::ffff:127.0.0.1', 6],
] as const)('rejects a private DNS destination %s', async (address, family) => {
  expect((await lookupResult([{ address, family }])).error).toBeInstanceOf(
    Error
  );
});

it('pins public DNS answers and supports both Node lookup callback shapes', async () => {
  const addresses = [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];
  expect(await lookupResult(addresses)).toMatchObject({
    error: null,
    address: addresses,
  });
  expect(await lookupResult(addresses, { family: 4 })).toEqual({
    error: null,
    address: '8.8.8.8',
    family: 4,
  });
  expect(
    (await lookupResult([...addresses, { address: '127.0.0.1', family: 4 }]))
      .error
  ).toBeInstanceOf(Error);
});

it('blocks the real HTTPS socket before connecting to a private DNS address', async () => {
  let connections = 0;
  const server = createServer(socket => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing local fixture');
  }
  const agent = new Agent({
    lookup: createPublicPushLookup(async () => [
      { address: '127.0.0.1', family: 4 },
    ]),
  });
  try {
    const error = await new Promise<Error>(done => {
      const req = request({
        hostname: 'push.example.test',
        port: address.port,
        agent,
      });
      req.setTimeout(1000, () =>
        req.destroy(new Error('Local fixture timeout'))
      );
      req.on('error', done);
      req.end();
    });
    expect(connections).toBe(0);
    expect(error.message).toContain('public addresses');
  } finally {
    agent.destroy();
    await new Promise<void>(done => server.close(() => done()));
  }
});
