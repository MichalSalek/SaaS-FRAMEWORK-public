# Following a feature across the codebase

The pairing request is an example of how a feature connects a shared contract, an API operation and a frontend declaration. This is a reading guide for the exported sample.

## Contract

The [pairing contract](../.shared-kernel/domain/pairing/pairing.contracts.ts) defines endpoint details and request and response types. The [client declarations](../main/src/domain/pairing/pairingIO.possibilities.api.ts) derive calls from those definitions. Types help reveal mismatches during development, but they do not replace runtime validation or behavior tests.

## API and behavior

The [request handler](../web-1/src/pages/api/v1/pairing/request-pair/index.ts) binds the contract to an operation. [Pair request operations](../web-1/src/domain/pairing/operations/pair-request.operations.ts) handle state and access checks. The [contract tests](../web-1/src/test-utils/integration/pairing-contract.test.ts) check examples including a missing required field and a method mismatch. [Operation tests](../web-1/src/domain/pairing/operations/pair-request.operations.respond.test.ts) cover acceptance, rejection and limits.

## Verification limits

Different behavior needs different evidence: isolated tests can check decisions, while database concurrency requires a running database and concurrent requests. The [test guide](../tests/README.md) describes the included examples. This export omits parts of the runtime and toolchain.
