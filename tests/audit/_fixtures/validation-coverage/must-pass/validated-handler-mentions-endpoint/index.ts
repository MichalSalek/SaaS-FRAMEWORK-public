// Fixture standalone (no imports): each sample is copied alone into a mini project, and the tests
// tsconfig compiles _fixtures/, so the names a handler uses are declared here.
declare const defineHandler: (config: object) => unknown;
declare const defineEndpoint: (contract: string, config: object) => unknown;
declare const FIXTURE_CONTRACTS: { FIXTURE_OPERATION_WITH_A_LONG_NAME: string };
declare const APP_EVENTS: { COMMANDS: { FIXTURE: { FIXTURE_OP: string } } };
declare const VALIDATION_POLICY: { validators: { fixtureOp: () => object } };
declare const NO_VALIDATION: () => object;
declare const METHODS: { POST: string };

// Next step: move this route to defineEndpoint(FIXTURE_CONTRACTS.FIXTURE_OP) once the domain has contracts.
export default defineHandler({
  eventName: APP_EVENTS.COMMANDS.FIXTURE.FIXTURE_OP,
  method: 'post',
  validate: VALIDATION_POLICY.validators.fixtureOp,
  handle: async () => undefined,
});
