import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreferredSurface } from '../mcp/surface.js';

test('preferred surface flag takes precedence over environment', () => {
  assert.equal(resolvePreferredSurface(['node', 'server', '--surface=jupyter'], { LEMMA_SURFACE: 'vscode' }), 'jupyter');
});

test('preferred surface can be supplied through the environment', () => {
  assert.equal(resolvePreferredSurface(['node', 'server'], { LEMMA_SURFACE: 'pycharm' }), 'pycharm');
});

test('unspecified surface leaves lazy attachment without a preference', () => {
  assert.equal(resolvePreferredSurface(['node', 'server'], {}), undefined);
});

test('invalid surface fails instead of silently exposing no notebook tools', () => {
  assert.throws(() => resolvePreferredSurface(['node', 'server', '--surface=other'], {}), /Invalid preferred Lemma surface/);
});
