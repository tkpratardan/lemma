// Bundles mcp/server.ts (+ everything it imports) into one self-contained
// ../bin/lemma-mcp.mjs, so a plugin fetched straight from git (no npm
// install, no node_modules) still has a working MCP server. Mirrors
// extensions/vscode/esbuild.js, which solves the identical problem for the
// packaged .vsix.
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['mcp/server.ts'],
  bundle: true,
  outfile: '../bin/lemma-mcp.mjs',
  platform: 'node',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  // Some bundled deps (e.g. y-websocket's transitive tree) still call
  // require() under an ESM output; this makes require() resolve there too.
  banner: { js: "import { createRequire as __lemmaCreateRequire } from 'module';\nconst require = __lemmaCreateRequire(import.meta.url);" },
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
