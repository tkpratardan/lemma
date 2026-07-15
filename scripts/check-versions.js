#!/usr/bin/env node
// Version-consistency guard: every version-bearing manifest must share one
// pinned X.Y.Z, and on a release-tag CI run that version must equal the tag
// (mutual agreement alone can't catch an un-bumped release).

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PINNED_SEMVER = /^\d+\.\d+\.\d+$/;

// Every file that declares the project version. Add new host manifests here
// so a future ecosystem can't drift unnoticed.
const VERSION_FILES = [
  'package.json',                   // npx/npm entry point — what users install
  'src/package.json',               // MCP core (private, internal-only)
  'src/package-lock.json',          // lockfile mirror of src/package.json's version
  '.claude-plugin/plugin.json',     // Claude Code plugin
  '.codex-plugin/plugin.json',      // Codex plugin
  '.github/plugin/plugin.json',     // Copilot CLI plugin
  'gemini-extension.json',          // Gemini CLI / Antigravity extension
];

function readVersion(relPath) {
  try {
    const raw = fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw).version;
  } catch (e) {
    throw new Error(`${relPath}: ${e.message}`);
  }
}

let failed = false;
const versions = VERSION_FILES.map((relPath) => {
  const version = readVersion(relPath);
  if (typeof version !== 'string' || !PINNED_SEMVER.test(version)) {
    console.error(`${relPath}: version must be a pinned X.Y.Z semver, got ${JSON.stringify(version)}`);
    failed = true;
  }
  return [relPath, version];
});

const distinct = [...new Set(versions.map(([, v]) => v))];
if (distinct.length > 1) {
  console.error('Version mismatch — every manifest must share one version:');
  for (const [relPath, version] of versions) console.error(`  ${version}\t${relPath}`);
  failed = true;
}
const shared = distinct.length === 1 ? distinct[0] : null;

// On a release-tag push, CI sets GITHUB_REF_TYPE=tag and GITHUB_REF_NAME=vX.Y.Z.
// The shared version must equal the tag — mutual agreement alone can't catch
// tagging a release whose version files were never bumped.
if (shared && process.env.GITHUB_REF_TYPE === 'tag') {
  const tag = process.env.GITHUB_REF_NAME || '';
  const tagVersion = tag.replace(/^v/, '');
  if (PINNED_SEMVER.test(tagVersion) && tagVersion !== shared) {
    console.error(`release tag ${tag} does not match version ${shared}; bump the version files before tagging`);
    failed = true;
  }
}

if (failed) {
  console.error('Align every version field above before releasing.');
  process.exit(1);
}

console.log(`All ${VERSION_FILES.length} version files pinned at ${shared}.`);
