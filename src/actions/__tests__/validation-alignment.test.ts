/**
 * Guardrail: Ensures validation/settlement alignment is consistent sitewide.
 * 
 * These tests complement recon-status-parity.test.ts by checking that:
 * 1. No UI code reads `(s as any).reconciliation_difference` from settlements
 *    (that column doesn't exist — gap must come from validation or computed from fields)
 * 2. No UI code promotes settlement status (ingested → ready_to_push) from the dashboard
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function collectTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      collectTsFiles(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const ALLOWED_FILES = [
  'validation-alignment.test.ts',
  'canonical-recon-status.ts',
  'settlement-engine.ts', // internal computation helper
];

describe('Validation/settlement alignment guardrails', () => {
  const srcFiles = collectTsFiles(path.resolve(__dirname, '../../'));

  it('no UI component reads nonexistent reconciliation_difference from settlements via (s as any)', () => {
    const violations: string[] = [];
    const pattern = /\(s\s+as\s+any\)\.reconciliation_difference/;

    for (const file of srcFiles) {
      const relPath = path.relative(path.resolve(__dirname, '../../'), file);
      if (ALLOWED_FILES.some(a => relPath.includes(a))) continue;

      const content = fs.readFileSync(file, 'utf-8');
      if (pattern.test(content)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no dashboard component promotes ingested settlements to ready_to_push', () => {
    const violations: string[] = [];
    // Pattern: updating settlements status to ready_to_push from dashboard/UI code
    const pattern = /\.update\(\s*\{[^}]*status:\s*['"]ready_to_push['"]/;

    for (const file of srcFiles) {
      const relPath = path.relative(path.resolve(__dirname, '../../'), file);
      // Allow edge functions, actions, test files, and intentional repost modals
      if (relPath.includes('actions/') || relPath.includes('.test.') || relPath.includes('__tests__')) continue;
      // Allow the reconciliation engine (server-side logic) and SafeRepostModal (intentional repost)
      if (relPath.includes('reconciliation-engine') || relPath.includes('settlement-engine') || relPath.includes('SafeRepostModal')) continue;

      const content = fs.readFileSync(file, 'utf-8');
      if (pattern.test(content)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });
});
