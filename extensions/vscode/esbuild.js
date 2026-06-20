// Bundles src/extension.ts (+ the shared ../../src/utils/ code it imports)
// into one dist/extension.js, avoiding node_modules in the packaged .vsix.
// Type-checking happens separately via `tsc --noEmit` (package.json's
// `typecheck` script) — esbuild itself does not type-check.
'use strict';

const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
