/**
 * Guardrail Tests — Canonical Action Invariants
 * 
 * These tests ensure:
 * 1. REQUIRED_CATEGORIES stays in sync between client and server
 * 2. No direct table writes bypass canonical actions (grep-style)
 * 3. No direct edge function invokes bypass canonical wrappers
 * 4. Support tier computation is correct
 * 
 * Scoped to src/ only (excludes supabase/, tests, actions/).
 * Prints exact file path + matching line number on failure for easy fixing.
 */

import { describe, it, expect } from 'vitest';
import { REQUIRED_CATEGORIES } from '@/actions/xeroReadiness';
import { computeSupportTier, getAutomationEligibility } from '@/policy/supportPolicy';
import fs from 'fs';
import path from 'path';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SRC_DIR = path.resolve(__dirname, '../../');

interface Violation {
  file: string;
  line: number;
  content: string;
}

function findTsFiles(dir: string, excludeDirs: string[] = []): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', ...excludeDirs].includes(entry.name)) continue;
      files.push(...findTsFiles(fullPath, excludeDirs));
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Files that are ALLOWED to write directly to tables or invoke edge functions.
 * Everything else must go through src/actions/*.
 */
const ALLOWED_FILES = [
  // Canonical action modules (they ARE the source of truth)
  'actions/settlements.ts',
  'actions/marketplaces.ts',
  'actions/xeroPush.ts',
  'actions/repost.ts',
  'actions/xeroReadiness.ts',
  'actions/scopeConsent.ts',
  'actions/index.ts',
  // Integration files (auto-generated, read-only)
  'integrations/',
  // Policy module (read-only constants, no DB writes)
  'policy/',
];

function isAllowed(filePath: string): boolean {
  return ALLOWED_FILES.some(allowed => filePath.includes(allowed));
}

function scanForPattern(pattern: RegExp, excludeDirs: string[] = ['actions']): Violation[] {
  const violations: Violation[] = [];
  const files = findTsFiles(SRC_DIR, excludeDirs);

  for (const file of files) {
    if (isAllowed(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push({
          file: path.relative(SRC_DIR, file),
          line: i + 1,
          content: lines[i].trim(),
        });
      }
    }
  }
  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations.map(v => `  ${v.file}:${v.line} → ${v.content}`).join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('REQUIRED_CATEGORIES sync check', () => {
  it('client and server REQUIRED_CATEGORIES must match', () => {
    const serverFilePath = path.resolve(__dirname, '../../../supabase/functions/sync-settlement-to-xero/index.ts');
    const serverCode = fs.readFileSync(serverFilePath, 'utf-8');

    const match = serverCode.match(/const REQUIRED_CATEGORIES\s*=\s*\[([^\]]+)\]/);
    expect(match, 'REQUIRED_CATEGORIES not found in sync-settlement-to-xero').toBeTruthy();

    const serverCategories = match![1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    const clientCategories = [...REQUIRED_CATEGORIES];
    expect(serverCategories).toEqual(clientCategories);
  });
});

describe('Canonical action guardrails', () => {
  it('no direct settlement delete cascades outside canonical actions', () => {
    const files = findTsFiles(SRC_DIR, ['actions']);
    const violations: Violation[] = [];

    for (const file of files) {
      if (isAllowed(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (
        content.includes("from('settlement_lines').delete()") &&
        content.includes("from('settlements').delete()")
      ) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("from('settlements').delete()")) {
            violations.push({
              file: path.relative(SRC_DIR, file),
              line: i + 1,
              content: lines[i].trim(),
            });
          }
        }
      }
    }

    expect(violations, `Direct settlement delete cascades found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct settlements.update({ status: }) outside canonical actions', () => {
    const violations = scanForPattern(/from\('settlements'\)\.update\(\{[^}]*status:/);
    expect(violations, `Direct settlement status updates found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct settlements.update({ is_hidden: }) outside canonical actions', () => {
    const violations = scanForPattern(/from\('settlements'\)\.update\(\{[^}]*is_hidden:/);
    expect(violations, `Direct settlement visibility updates found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct settlements.update({ bank_verified: }) outside canonical actions', () => {
    const violations = scanForPattern(/from\('settlements'\)\.update\(\{[^}]*bank_verified:/);
    expect(violations, `Direct bank verification updates found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct invoke of sync-settlement-to-xero outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]sync-settlement-to-xero['"]/);
    expect(violations, `Direct sync-settlement-to-xero invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct invoke of auto-post-settlement outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]auto-post-settlement['"]/);
    expect(violations, `Direct auto-post-settlement invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no UI files implement their own tier computation (must use supportPolicy)', () => {
    // Guard against local tier/gating logic in components
    const violations = scanForPattern(/computeSupportTier|AU_VALIDATED_RAILS/, ['actions', 'policy']);
    expect(violations, `Local tier computation found outside policy module:\n${formatViolations(violations)}`).toEqual([]);
  });
});

describe('Support tier computation', () => {
  it('AU rail + AU_GST → SUPPORTED', () => {
    expect(computeSupportTier({ rail: 'amazon_au', taxProfile: 'AU_GST' })).toBe('SUPPORTED');
  });

  it('AU rail + non-AU tax → EXPERIMENTAL', () => {
    expect(computeSupportTier({ rail: 'amazon_au', taxProfile: 'EXPORT_NO_GST' })).toBe('EXPERIMENTAL');
  });

  it('unknown rail → UNSUPPORTED', () => {
    expect(computeSupportTier({ rail: 'unknown_rail', taxProfile: 'AU_GST', knownRail: false })).toBe('UNSUPPORTED');
  });

  it('AUTHORISED blocked outside SUPPORTED tier', () => {
    const result = getAutomationEligibility({
      tier: 'EXPERIMENTAL',
      taxMode: 'AU_GST_STANDARD',
      supportAcknowledgedAt: '2026-01-01',
      isAutopost: false,
    });
    expect(result.authorisedAllowed).toBe(false);
  });

  it('AUTHORISED allowed for SUPPORTED tier', () => {
    const result = getAutomationEligibility({
      tier: 'SUPPORTED',
      taxMode: 'AU_GST_STANDARD',
      supportAcknowledgedAt: null,
      isAutopost: false,
    });
    expect(result.authorisedAllowed).toBe(true);
  });
});
