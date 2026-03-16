/**
 * Guardrail Tests — Canonical Action Invariants
 * 
 * These tests ensure:
 * 1. REQUIRED_CATEGORIES stays in sync between client and server
 * 2. No direct table writes bypass canonical actions (grep-style)
 */

import { describe, it, expect } from 'vitest';
import { REQUIRED_CATEGORIES } from '@/actions/xeroReadiness';
import fs from 'fs';
import path from 'path';

describe('REQUIRED_CATEGORIES sync check', () => {
  it('client and server REQUIRED_CATEGORIES must match', () => {
    // Read the server-side file
    const serverFilePath = path.resolve(__dirname, '../../../supabase/functions/sync-settlement-to-xero/index.ts');
    const serverCode = fs.readFileSync(serverFilePath, 'utf-8');

    // Extract REQUIRED_CATEGORIES from server code
    const match = serverCode.match(/const REQUIRED_CATEGORIES\s*=\s*\[([^\]]+)\]/);
    expect(match).toBeTruthy();

    const serverCategories = match![1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    const clientCategories = [...REQUIRED_CATEGORIES];

    expect(serverCategories).toEqual(clientCategories);
  });
});

describe('Canonical action guardrails', () => {
  const SRC_DIR = path.resolve(__dirname, '../../');

  function findTsxFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'actions') {
        files.push(...findTsxFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  // Files that are ALLOWED to write directly (canonical actions, engine, edge funcs)
  const ALLOWED_DIRECT_WRITE_FILES = [
    'actions/settlements.ts',
    'actions/marketplaces.ts',
    'actions/xeroPush.ts',
    'actions/repost.ts',
    'utils/settlement-engine.ts',   // legacy, will migrate incrementally
    'utils/marketplace-token-map.ts', // ghost cleanup
    'integrations/',
  ];

  function isAllowed(filePath: string): boolean {
    return ALLOWED_DIRECT_WRITE_FILES.some(allowed => filePath.includes(allowed));
  }

  it('no direct settlement delete cascades outside canonical actions', () => {
    const violations: string[] = [];
    const files = findTsxFiles(SRC_DIR);

    for (const file of files) {
      if (isAllowed(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      // Check for the pattern: from('settlement_lines').delete() followed by from('settlements').delete()
      if (
        content.includes("from('settlement_lines').delete()") &&
        content.includes("from('settlements').delete()")
      ) {
        violations.push(path.relative(SRC_DIR, file));
      }
    }

    expect(violations).toEqual([]);
  });

  it('no direct settlements.update({ status: }) outside canonical actions', () => {
    const violations: string[] = [];
    const files = findTsxFiles(SRC_DIR);
    const directStatusPattern = /from\('settlements'\)\.update\(\{[^}]*status:/;

    for (const file of files) {
      if (isAllowed(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (directStatusPattern.test(content)) {
        violations.push(path.relative(SRC_DIR, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
