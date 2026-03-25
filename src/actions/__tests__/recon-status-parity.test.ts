/**
 * Guardrail test: Ensures no file outside the canonical helper
 * uses legacy reconciliation_status string comparisons.
 *
 * If this test fails, you're bypassing the canonical gap check.
 * Use `isGapBlocking()` or `isReconSafeForPush()` from canonical-recon-status.ts instead.
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

const CANONICAL_FILE = 'canonical-recon-status.ts';
const ALLOWED_FILES = [
  CANONICAL_FILE,
  'recon-status-parity.test.ts', // this test file
  'run-validation-sweep',        // edge function (server-side, has its own gap logic)
];

// Legacy patterns that should not appear outside the canonical helper
const LEGACY_PATTERNS = [
  /reconciliation_status\s*===?\s*['"]matched['"]/,
  /reconciliation_status\s*===?\s*['"]reconciled['"]/,
];

describe('Canonical reconciliation status enforcement', () => {
  const srcFiles = collectTsFiles(path.resolve(__dirname, '../../'));

  it('no file outside the canonical helper uses legacy reconciliation_status string checks', () => {
    const violations: string[] = [];

    for (const file of srcFiles) {
      const basename = path.basename(file);
      const relPath = path.relative(path.resolve(__dirname, '../../'), file);
      if (ALLOWED_FILES.some(a => relPath.includes(a) || basename.includes(a))) continue;

      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of LEGACY_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${relPath} matches ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
