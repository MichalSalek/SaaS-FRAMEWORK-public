import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildVersion } from './build-version.mjs';

const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), 'build', '--webpack'],
  {
    stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_BUILD_VERSION: buildVersion() },
  }
);
child.on('error', error => {
  process.stderr.write(`Nie udało się uruchomić buildu: ${error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
