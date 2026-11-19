# Structural checks


**English** | [Polski](README.pl.md)

The included audit sources illustrate checks for selected relationships and code patterns, including contracts, integration conventions and module boundaries. They complement tests and type checking; they do not prove overall correctness.

## Reading guide

- [Contract checks](tools/d1-contracts.ts) inspect relationships between contract definitions and application code.
- [Stripe checks](tools/stripe.ts) inspect selected integration patterns.
- [Contract check tests](tools/d1-contracts.test.ts) illustrate tests of the checking tools.

## Scope of this edition

`npm run audit:all` runs the checks listed in the [suite](run-all.sh). They cover kernel synchronization, contract-to-route bindings, database schemas, Stripe integration, CSS rules, translations and generated code, among other checks. The generator check compares contract registries, OpenAPI and Prisma DTOs with their sources. It also checks the generated page summaries against the published locales and article sources. Checks that require the complete deployment environment are outside the scope of this command.
