import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_CONTRACT_LIST } from '../../.shared-kernel/application/contracts/api-contracts.registry';
import { RAW_PROTOCOLS } from '../../.shared-kernel/application/contracts/raw-protocols';
import { API_HTTP_METHODS } from '../../.shared-kernel/domain/http/http-methods.config';
import { ROUTES_API } from '../../.shared-kernel/domain/routing/routing.config';
import { SALON_STAFF_CONTRACTS } from '../../.shared-kernel/domain/salon-staff/salon-staff.contracts';
import { censusOperations } from './operation-census';

const RAW_METHOD_KEYS = [
  'DEV_LOGIN',
  'EMAIL_UNSUBSCRIBE',
  'INTERNAL_HEALTH_PUBLIC',
  'INTERNAL_SWEEP_TICK',
  'NEWSLETTER_CONFIRM',
  'NEWSLETTER_UNSUBSCRIBE',
];

const live = () =>
  censusOperations({
    methodKeys: Object.keys(API_HTTP_METHODS),
    routeKeys: Object.keys(ROUTES_API),
    contractKeys: API_CONTRACT_LIST.map(contract => contract.key),
    rawProtocolIds: RAW_PROTOCOLS.map(protocol => protocol.id),
    parentRouteKeys: ['SALON_STAFF'],
  });

test('a new method key without a contract is a gap', () => {
  const report = censusOperations({
    methodKeys: ['NEW_JSON_OP', 'DEV_LOGIN'],
    routeKeys: ['NEW_JSON_OP', 'DEV_LOGIN', 'SALON_STAFF'],
    contractKeys: [],
    rawProtocolIds: ['DEV_LOGIN'],
    parentRouteKeys: ['SALON_STAFF'],
  });
  assert.deepEqual(report.missingContracts, ['NEW_JSON_OP']);
  assert.deepEqual(report.rawMethodKeys, ['DEV_LOGIN']);
  assert.deepEqual(report.unexpectedRouteKeys, ['NEW_JSON_OP']);
  assert.deepEqual(report.parentRouteProblems, []);
});

test('the live registries cover every eligible JSON operation', () => {
  const report = live();
  assert.deepEqual(report.missingContracts, []);
  assert.deepEqual(report.contractsMissingMethod, []);
  assert.deepEqual(report.contractsMissingRoute, []);
  assert.deepEqual(report.unexpectedRouteKeys, []);
  assert.deepEqual(report.parentRouteProblems, []);
  assert.deepEqual(report.rawMethodKeys, RAW_METHOD_KEYS);
  assert.deepEqual([...report.eligibleMethodKeys].sort(), API_CONTRACT_LIST.map(contract => contract.key).sort());
  assert.equal(new Set(report.eligibleMethodKeys).size, report.eligibleMethodKeys.length);
  assert.equal(new Set(API_CONTRACT_LIST.map(contract => contract.key)).size, API_CONTRACT_LIST.length);
  assert.equal(RAW_PROTOCOLS.length, 13);
  assert.equal(
    new Set(RAW_PROTOCOLS.map(protocol => protocol.id)).size,
    RAW_PROTOCOLS.length
  );
  assert.equal(
    ROUTES_API.SALON_STAFF,
    SALON_STAFF_CONTRACTS.SALON_STAFF_INVITE.route
  );
  assert.equal(
    ROUTES_API.SALON_STAFF,
    SALON_STAFF_CONTRACTS.SALON_STAFF_GET_ALL.route
  );
});
