import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceInspectionCode } from '../mcp/sourceInspection.js';

function embeddedConfig(code: string): Record<string, unknown> {
  const matched = code.match(/_lemma_json\.loads\(("(?:\\.|[^"\\])*")\)/);
  assert.ok(matched);
  return JSON.parse(JSON.parse(matched[1])) as Record<string, unknown>;
}

test('source inspection recipes are durable, bounded, and safely encode paths', () => {
  const code = sourceInspectionCode({
    view: 'head',
    path: 'data/a "quoted" file.csv',
    headerRow: 'auto',
    rows: 5,
    maxColumns: 20,
  });
  assert.match(code, /# Lemma deterministic source head/);
  assert.match(code, /_lemma_pd\.read_csv/);
  assert.match(code, /"cp1252"/);
  assert.match(code, /_lemma_source_observation/);
  assert.match(code, /_lemma_pd\.isna\(value\)/);
  assert.equal(embeddedConfig(code).path, 'data/a "quoted" file.csv');
  assert.doesNotMatch(code, /subprocess|os\.system/);
});

test('JSON mappings become key/value tables and batch failures stay local', () => {
  const code = sourceInspectionCode({
    view: 'batch',
    requests: [
      { view: 'head', path: 'mapping.json', headerRow: 'auto', rows: 5, maxColumns: 20 },
      { view: 'head', path: 'legacy.csv', headerRow: 'auto', rows: 5, maxColumns: 20 },
    ],
  });
  assert.match(code, /columns=\["key", "value"\]/);
  assert.match(code, /def observe\(item\)/);
  assert.match(code, /"error": f/);
});

test('spreadsheet inspection exposes sheets, raw previews, and header candidates', () => {
  const code = sourceInspectionCode({
    view: 'schema',
    path: 'data/climate.xlsx',
    sheet: 0,
    headerRow: 'auto',
    maxColumns: 30,
  });
  assert.match(code, /sheet_names/);
  assert.match(code, /header_candidates/);
  assert.match(code, /raw_preview/);
  assert.equal(embeddedConfig(code).headerRow, 'auto');
});

test('batch requests are atomic and later cells invoke the installed helper compactly', () => {
  const request = {
    view: 'batch' as const,
    requests: [
      { view: 'schema' as const, path: 'a.csv', headerRow: 'auto' as const, maxColumns: 20 },
      { view: 'head' as const, path: 'b.xlsx', sheet: 'Data', headerRow: 4, rows: 5, maxColumns: 20 },
    ],
  };
  const first = sourceInspectionCode(request);
  const later = sourceInspectionCode(request, { includeHelper: false });
  assert.match(first, /def _lemma_inspect_source/);
  assert.match(first, /def _lemma_compact_source_observation/);
  assert.match(first, /max_chars=3000/);
  assert.match(first, /_lemma_source_summary = _lemma_compact_source_observation/);
  assert.doesNotMatch(later, /def _lemma_inspect_source/);
  assert.ok(later.length < 1000);
  assert.equal(embeddedConfig(later).view, 'batch');
});

test('inventory recipes cap files and make hashing explicit', () => {
  const code = sourceInspectionCode({
    view: 'inventory',
    paths: ['data', 'more/**/*.csv'],
    hashContents: false,
    maxFiles: 40,
  });
  assert.match(code, /item\["maxFiles"\]/);
  assert.match(code, /item\["hashContents"\]/);
  assert.equal(embeddedConfig(code).maxFiles, 40);
});
