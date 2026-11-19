import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { Agent } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  privateV4.addSubnet(address, prefix);
}

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const specialV6 = new BlockList();
specialV6.addSubnet('2001::', 23, 'ipv6');
specialV6.addSubnet('2001:db8::', 32, 'ipv6');
specialV6.addSubnet('2002::', 16, 'ipv6');
specialV6.addSubnet('3fff::', 20, 'ipv6');

const isPublic = (address: string): boolean => {
  const family = isIP(address);
  return family === 4
    ? !privateV4.check(address)
    : family === 6 &&
        globalV6.check(address, 'ipv6') &&
        !specialV6.check(address, 'ipv6');
};

/** Resolve at connection time and hand Node the checked addresses, avoiding DNS rebinding. */
export function createPublicPushLookup(
  resolve: (hostname: string) => Promise<LookupAddress[]> = hostname =>
    lookup(hostname, { all: true })
): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname)
      .then(addresses => {
        const family =
          options.family === 'IPv4'
            ? 4
            : options.family === 'IPv6'
              ? 6
              : options.family;
        const selected = addresses.filter(
          item => !family || item.family === family
        );
        if (
          !selected.length ||
          addresses.some(item => !isPublic(item.address))
        ) {
          callback(
            new Error('Push endpoint must resolve to public addresses'),
            []
          );
          return;
        }
        const first = selected[0];
        if (options.all) {
          callback(null, selected);
        } else if (first) {
          callback(null, first.address, first.family);
        }
      })
      .catch(error =>
        callback(
          error instanceof Error ? error : new Error('Push DNS lookup failed'),
          []
        )
      );
  };
}

export const createPublicPushAgent = () =>
  new Agent({ keepAlive: false, lookup: createPublicPushLookup() });
