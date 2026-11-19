# Plan: [feature name]

> Archival example: recorded proposals and statuses are not a current roadmap or instructions for this export.

**Status:** pending, in progress, partial or awaiting verification.
**Dependencies:** prerequisite code, environment setup or product decisions.

## Purpose

Describe the user behavior being added or corrected and the reason for the change.
State what is outside the scope.

## Current behavior

Link the relevant contract, operation, screen and existing tests. Distinguish
observed behavior from assumptions that still need checking.

## Implementation

1. Define the business rule and resource access.
2. Update the schema and migration strategy if needed.
3. Define and synchronize the shared contract.
4. Implement the API operation, error mapping and handler.
5. Implement the client declaration, hooks and interface.
6. Add the relevant verification and documentation changes.

Replace these steps with concrete paths and acceptance conditions for the feature.

## Verification

- [ ] The affected applications typecheck.
- [ ] Relevant behavior and failure paths are checked.
- [ ] Applicable audits and builds pass.
- [ ] Browser, database or device checks cover behavior outside mocked tests.

## Release and documentation

Record migration and deployment order, environment dependencies and affected
documents. Track code completion separately from deployment and manual acceptance.
After completion, update the roadmap and summarize the result in the change history.
