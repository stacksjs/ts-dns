/**
 * `sideEffects: false` is deliberately absent from package.json.
 *
 * With it, Bun 1.3.14 eliminates modules reached only through re-exports and
 * still emits their names in the export list, so the bundle exports bindings
 * that were never declared -- `error: "La" is not declared in this file`. It
 * builds cleanly and throws on import, which is how @stacksjs/dnsx@0.2.3
 * shipped. Verified by toggling that flag alone: 1 undeclared identifier with
 * it, 0 without.
 */

import { Logger } from '@stacksjs/clarity'
import { dts } from 'bun-plugin-dtsx'

const logger = new Logger('dnsx:build')
await logger.info('Building...')

// Library entry. A single entrypoint lands the output at `dist/index.js` (which
// is what package.json `exports` + `module` point at). Building `src/index.ts`
// and `bin/cli.ts` together instead makes Bun preserve the source tree and emit
// `dist/src/index.js`, leaving the package importable as types only.
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  plugins: [dts()],
})

// CLI entry → dist/bin/cli.js (the `bin` fallback; the shipped binary is built
// separately by `bun run compile`).
await Bun.build({
  entrypoints: ['./bin/cli.ts'],
  outdir: './dist/bin',
  format: 'esm',
  target: 'node',
  minify: true,
})

await logger.success('Built')
