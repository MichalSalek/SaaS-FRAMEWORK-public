// Lets `node` run web-1 TypeScript sources directly (Node 24 strips types natively): the sources
// use extensionless relative imports, so a failed relative resolve retries with `.ts`; the
// tsconfig path aliases (@kernel, @app, @domain) map to their source roots.
import { registerHooks } from 'node:module';

const ALIASES = {
  '@kernel/': new URL('../../src/READONLY-shared-kernel/', import.meta.url),
  '@app/': new URL('../../src/application/', import.meta.url),
  '@domain/': new URL('../../src/domain/', import.meta.url),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const [prefix, root] of Object.entries(ALIASES)) {
      if (specifier.startsWith(prefix)) {
        const target = new URL(specifier.slice(prefix.length), root).href;
        return nextResolve(
          target.endsWith('.ts') ? target : `${target}.ts`,
          context
        );
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
