# Contributing

## Setup

```bash
cd src && npm install && npm run build
```

Lemma's MCP server is pure TypeScript/Node — no Python setup needed to work
on it. The kernel it connects to (via `pycharm_connect`'s HTTP/WebSocket path,
or `jupyterlab_connect`'s REST/RTC path) lives in whatever Jupyter server the
user already has running; that's their environment to manage, not lemma's.

## Running tests

```bash
cd src && npm run build && npm test
```

`npm test` runs `node --test` against the compiled `dist/`, not the TypeScript
source directly, so build first if you've made any changes since the last one.

## Testing `bin/install.js` changes

`node bin/install.js --dry-run` previews every provider without writing
anything — use `--only <id>` to narrow to one.

Claude Code, Codex, Copilot, Antigravity/`agy`, Gemini CLI, and OpenClaw point
at the real published GitHub repo, not this checkout, so a local edit won't
show up for them until it's pushed. Set `LEMMA_DEV_LOCAL=1` to point those
providers at this checkout instead (mirrors how each host's own docs
distinguish a remote install from a local dev one, e.g. Gemini's
`extensions install` vs `extensions link`):

```bash
LEMMA_DEV_LOCAL=1 node bin/install.js --only claude-code
```

## Code style

Match the existing voice: short comments that explain *why* a piece of code
exists, not *what* it does. See any file under `src/` for the convention.
There's no separate style-guide file for this codebase; the skills in
`.claude/skills/` (`google-style-typescript`, `google-style-javascript`,
`google-style-python`) fill that role per language, scoped to this project's
own conventions where they're more specific.

## Releasing

Releases are manual for now (no CI/CD publish workflow yet; it'll come back
once the test suite is in better shape).

Claude Code, Codex, Copilot, Antigravity/`agy`, Gemini CLI, and OpenClaw all
install lemma as a plugin pointed directly at this GitHub repo — for those,
**the version bump + tag + push below is the actual release action**, not
`npm publish` (per `~/src/ponytail`'s own manifests: version stays pinned and
bumped every release across all three, not omitted for commit-SHA tracking —
a skipped bump means those hosts see no update, same as today). `npm publish`
still matters for the legacy `npm install -g @tkpratardan/lemma` path and for
hosts with no plugin route (Cursor, VS Code, Windsurf, Claude Desktop, which
read the installed npm package directly).

1. Update `docs/CHANGELOG.md`: move the `Unreleased` entries under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading.
2. Bump the version in all version-bearing files. `node scripts/check-versions.js`
   lists them and must pass (every manifest shares one `X.Y.Z`).
3. If `AGENTS.md` changed, regenerate the per-host rule copies:
   `node scripts/build-rule-copies.js`.
4. If any `skills/*/SKILL.md` changed, regenerate the OpenClaw copies:
   `node scripts/build-openclaw-skills.js`.
5. Rebuild `bin/lemma-mcp.mjs`, the committed, dependency-free bundle every
   plugin-route host actually runs. A plugin fetched straight from git gets
   no `node_modules` (it's never committed), so the MCP server has to carry
   its own dependencies inline rather than `import`ing them at runtime:

   ```bash
   cd src && npm run bundle && npm test
   ```

6. Publish to npm by hand (for the legacy/non-plugin install paths), from
   the repo root, not `src/` (`src/package.json` is `lemma-core`, the
   internal, unpublished TypeScript package; `@tkpratardan/lemma` at the
   root is the one that actually ships):

   ```bash
   npm publish --dry-run
   npm publish
   ```

7. Commit (including the rebuilt `bin/lemma-mcp.mjs`), then tag and push,
   the tag push is what every plugin-route host actually picks up:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
