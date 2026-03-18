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
  'actions/settlements.ts',
  'actions/marketplaces.ts',
  'actions/xeroPush.ts',
  'actions/repost.ts',
  'actions/xeroReadiness.ts',
  'actions/scopeConsent.ts',
  'actions/xeroInvoice.ts',
  'actions/xeroAccounts.ts',
  'actions/coaCoverage.ts',
  'actions/coaClone.ts',
  'actions/accountMappings.ts',
  'actions/index.ts',
  'integrations/',
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

  it('no direct invoke of fetch-xero-invoice outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]fetch-xero-invoice['"]/);
    expect(violations, `Direct fetch-xero-invoice invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct invoke of rescan-xero-invoice-match outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]rescan-xero-invoice-match['"]/);
    expect(violations, `Direct rescan-xero-invoice-match invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct invoke of preview-xettle-invoice-payload outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]preview-xettle-invoice-payload['"]/);
    expect(violations, `Direct preview-xettle-invoice-payload invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct writes to xero_invoice_cache outside canonical actions', () => {
    const violations = scanForPattern(/from\(['"]xero_invoice_cache['"]\)\.\s*(?:insert|upsert|update|delete)/);
    expect(violations, `Direct xero_invoice_cache writes found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no local preview builder exists outside canonical actions', () => {
    // Prevent drift: no component should have its own buildXettlePreviewPayload
    const violations = scanForPattern(/buildXettlePreviewPayload/);
    expect(violations, `Local preview builder found outside canonical actions:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no UI files implement their own tier computation (must use supportPolicy)', () => {
    const violations = scanForPattern(/AU_VALIDATED_RAILS/, ['actions', 'policy']);
    expect(violations, `Local tier computation found outside policy module:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no raw DOM content patterns passed to AI context', () => {
    const violations = scanForPattern(/innerHTML|outerHTML|document\.body|\.innerText/, ['actions', 'ai']);
    // Filter to only AI-related files to avoid false positives on DOM manipulation
    const aiRelated = violations.filter(v => 
      v.file.includes('ai-assistant') || v.file.includes('use-ai-assistant') || v.file.includes('AiContext')
    );
    expect(aiRelated, `Raw DOM patterns found in AI-related files:\n${formatViolations(aiRelated)}`).toEqual([]);
  });

  it('no direct invoke of ai-assistant tools outside edge function', () => {
    // Tool names should not appear as direct function calls in components
    const violations = scanForPattern(/getPageReadinessSummary|getInvoiceStatusByXeroInvoiceId|getSettlementStatus/, ['actions', 'ai']);
    const componentViolations = violations.filter(v => 
      !v.file.includes('toolRegistry') && !v.file.includes('test')
    );
    expect(componentViolations, `Direct AI tool calls found outside registry:\n${formatViolations(componentViolations)}`).toEqual([]);
  });

  it('no direct invoke of refresh-xero-coa outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]refresh-xero-coa['"]/);
    expect(violations, `Direct refresh-xero-coa invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct writes to xero_chart_of_accounts outside canonical actions', () => {
    const violations = scanForPattern(/from\(['"]xero_chart_of_accounts['"]\)\.\s*(?:insert|upsert|update|delete)/);
    expect(violations, `Direct xero_chart_of_accounts writes found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct writes to xero_tax_rates outside canonical actions', () => {
    const violations = scanForPattern(/from\(['"]xero_tax_rates['"]\)\.\s*(?:insert|upsert|update|delete)/);
    expect(violations, `Direct xero_tax_rates writes found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct invoke of create-xero-accounts outside canonical actions', () => {
    const violations = scanForPattern(/functions\.invoke\(['"]create-xero-accounts['"]/);
    expect(violations, `Direct create-xero-accounts invocations found:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('no direct settlements.insert() outside canonical actions and settlement-engine', () => {
    // settlement-engine.ts is allowed because it calls applySourcePriority post-insert
    const violations = scanForPattern(
      /from\(['"]settlements['"]\)\.insert\(/,
      ['actions'],
    ).filter(v =>
      !v.file.includes('settlement-engine.ts') &&
      !v.file.includes('settlement-components.ts')
    );
    expect(violations, `Direct settlements.insert() found outside canonical paths:\n${formatViolations(violations)}`).toEqual([]);
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
