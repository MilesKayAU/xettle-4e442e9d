/**
 * Parser Parity Test
 * 
 * Ensures the embedded parser in fetch-amazon-settlements (Deno edge function)
 * is byte-identical to the canonical browser parser in settlement-parser.ts.
 *
 * Checks:
 * 1. PARSER_VERSION must match
 * 2. CATEGORY_MAP must have identical keys and values
 * 3. EXPECTED_SIGNS must match
 *
 * If this test fails, a settlement parsed via CSV upload vs. Amazon API
 * could produce different accounting totals — a silent correctness bug.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const BROWSER_PARSER_PATH = path.resolve(__dirname, '../../utils/settlement-parser.ts');
const EDGE_PARSER_PATH = path.resolve(__dirname, '../../../supabase/functions/fetch-amazon-settlements/index.ts');
const VALIDATION_SWEEP_PATH = path.resolve(__dirname, '../../../supabase/functions/run-validation-sweep/index.ts');

function extractConst(source: string, name: string): string | null {
  // Match: const NAME = 'value'; or const NAME = "value";
  const re = new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`);
  const match = source.match(re);
  return match ? match[1] : null;
}

function extractMapKeys(source: string, mapName: string): string[] {
  // Extract all quoted keys from a Record<string, string> = { ... } block
  const blockStart = source.indexOf(`const ${mapName}`);
  if (blockStart === -1) return [];

  let braceCount = 0;
  let started = false;
  let blockContent = '';
  for (let i = blockStart; i < source.length; i++) {
    if (source[i] === '{') { braceCount++; started = true; }
    if (source[i] === '}') { braceCount--; }
    if (started) blockContent += source[i];
    if (started && braceCount === 0) break;
  }

  const keyRe = /['"]([^'"]+)['"]\s*:/g;
  const keys: string[] = [];
  let m;
  while ((m = keyRe.exec(blockContent)) !== null) {
    keys.push(m[1]);
  }
  return keys.sort();
}

function extractMapEntries(source: string, mapName: string): Record<string, string> {
  const blockStart = source.indexOf(`const ${mapName}`);
  if (blockStart === -1) return {};

  let braceCount = 0;
  let started = false;
  let blockContent = '';
  for (let i = blockStart; i < source.length; i++) {
    if (source[i] === '{') { braceCount++; started = true; }
    if (source[i] === '}') { braceCount--; }
    if (started) blockContent += source[i];
    if (started && braceCount === 0) break;
  }

  const entryRe = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
  const entries: Record<string, string> = {};
  let m;
  while ((m = entryRe.exec(blockContent)) !== null) {
    entries[m[1]] = m[2];
  }
  return entries;
}

describe('Parser Version Parity', () => {
  const browserSource = fs.readFileSync(BROWSER_PARSER_PATH, 'utf-8');
  const edgeSource = fs.readFileSync(EDGE_PARSER_PATH, 'utf-8');

  it('PARSER_VERSION must match between browser and edge function', () => {
    const browserVersion = extractConst(browserSource, 'PARSER_VERSION');
    const edgeVersion = extractConst(edgeSource, 'PARSER_VERSION');
    expect(browserVersion).toBeTruthy();
    expect(edgeVersion).toBeTruthy();
    expect(edgeVersion).toBe(browserVersion);
  });

  it('PARSER_VERSION must match in run-validation-sweep', () => {
    const browserVersion = extractConst(browserSource, 'PARSER_VERSION');
    const sweepSource = fs.readFileSync(VALIDATION_SWEEP_PATH, 'utf-8');
    const clientVersion = extractConst(sweepSource, 'CLIENT_PARSER_VERSION');
    const edgeVersion = extractConst(sweepSource, 'EDGE_PARSER_VERSION');
    expect(clientVersion).toBe(browserVersion);
    expect(edgeVersion).toBe(browserVersion);
  });

  it('CATEGORY_MAP keys must be identical', () => {
    const browserKeys = extractMapKeys(browserSource, 'CATEGORY_MAP');
    const edgeKeys = extractMapKeys(edgeSource, 'CATEGORY_MAP');
    expect(browserKeys).toEqual(edgeKeys);
  });

  it('CATEGORY_MAP values must be identical for each key', () => {
    const browserMap = extractMapEntries(browserSource, 'CATEGORY_MAP');
    const edgeMap = extractMapEntries(edgeSource, 'CATEGORY_MAP');
    expect(browserMap).toEqual(edgeMap);
  });

  it('EXPECTED_SIGNS must match', () => {
    const browserSigns = extractMapEntries(browserSource, 'EXPECTED_SIGNS');
    const edgeSigns = extractMapEntries(edgeSource, 'EXPECTED_SIGNS');
    // EXPECTED_SIGNS uses numeric values not strings, extract differently
    const extractSigns = (src: string): Record<string, string> => {
      const start = src.indexOf('const EXPECTED_SIGNS');
      if (start === -1) return {};
      let braceCount = 0, started = false, block = '';
      for (let i = start; i < src.length; i++) {
        if (src[i] === '{') { braceCount++; started = true; }
        if (src[i] === '}') { braceCount--; }
        if (started) block += src[i];
        if (started && braceCount === 0) break;
      }
      const re = /['"]([^'"]+)['"]\s*:\s*(-?\d)/g;
      const result: Record<string, string> = {};
      let m;
      while ((m = re.exec(block)) !== null) result[m[1]] = m[2];
      return result;
    };
    expect(extractSigns(browserSource)).toEqual(extractSigns(edgeSource));
  });
});
