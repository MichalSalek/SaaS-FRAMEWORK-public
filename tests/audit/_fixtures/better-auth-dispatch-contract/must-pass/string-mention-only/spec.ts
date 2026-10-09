// Nazwa testu CYTUJE pilnowane pole. To proza w literale, nie odczyt — strażnik,
// który się na tym wywraca, karze za opisanie własnej reguły (realny przebieg S121).
type FixtureCtx = { readonly context?: { readonly [k: string]: unknown } };
declare const describe: (name: string, fn: () => void) => void;

export const spec = (): void => {
  describe('handleAuthFailure — kontrakt ctx.context.returned', () => {
    const label: string = 'czyta ctx.context.responseHeaders przez akcesor';
    void label;
  });
};
export const unused = (_ctx: FixtureCtx): null => null;
