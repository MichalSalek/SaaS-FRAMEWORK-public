import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVersion } from './build-version.mjs';

test('build stamp is derived once in UTC without worker clock differences', () => {
  const stamp = buildVersion(new Date('2026-10-08T01:59:59Z'));
  assert.equal(stamp, '20261008.0159');
  const environment = { NEXT_PUBLIC_BUILD_VERSION: stamp };
  const laterWorker = { ...environment };
  assert.equal(laterWorker.NEXT_PUBLIC_BUILD_VERSION, stamp);
});
