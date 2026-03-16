/**
 * COA Clone — Canonical action for cloning Xero COA structure to a new marketplace.
 *
 * This is the ONLY approved path for COA cloning.
 * UI must not call create-xero-accounts directly for clone operations.
 *
 * Flow: UI → coaClone action → createXeroAccounts → edge function → Xero API
 *
 * Safety gates:
 * - Requires admin role (enforced by edge function)
 * - Requires PIN verification (enforced by UI caller)
 * - Tax type inherited from template (warning shown if non-AU_GST profile)
 * - Codes generated via accountCodePolicy (centralized)
 * - Clone does NOT change support tier or push gating
 */

import { createXeroAccounts, type CreateXeroAccountInput } from './xeroAccounts';
import {
  findTemplateAccounts,
  generateNewAccountName,
  type TemplateAccount,
} from './coaCoverage';
import {
  generateNextCode,
  getAccountTypeForCategory,
  type CodeGenerationInput,
} from '@/policy/accountCodePolicy';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Categories that are typically Amazon-specific */
const AMAZON_SPECIFIC_CATEGORIES = new Set(['FBA Fees', 'Storage Fees']);

export const CLONE_CATEGORIES = [
  'Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements',
  'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees',
] as const;

export interface CloneAccountRow {
  category: string;
  enabled: boolean;
  templateCode: string;
  templateName: string;
  newCode: string;
  newName: string;
  type: string;
  taxType: string | null;
}

export interface ClonePreviewInput {
  templateMarketplace: string;
  targetMarketplace: string;
  coaAccounts: { account_code: string | null; account_name: string; account_type: string | null; tax_type: string | null; is_active: boolean }[];
  existingCodes: string[];
}

export interface CloneExecuteInput {
  rows: CloneAccountRow[];
}

export interface CloneResult {
  success: boolean;
  /** Map of category → created account code */
  createdMappings: Record<string, string>;
  errors: { code: string; error: string }[];
}

// ─── Preview (Pure Logic) ───────────────────────────────────────────────────

/**
 * Build preview rows for a COA clone operation.
 * Pure function — no side effects, no API calls.
 */
export function buildClonePreview(input: ClonePreviewInput): CloneAccountRow[] {
  const templateAccounts = findTemplateAccounts(
    input.templateMarketplace,
    input.coaAccounts as any,
  );

  const claimed = new Set<string>();
  const rows: CloneAccountRow[] = [];

  for (const cat of CLONE_CATEGORIES) {
    const templateAcc = templateAccounts.find(ta => ta.category === cat);
    if (!templateAcc) continue;

    // Generate code via policy
    const newCode = generateNextCode({
      existingCodes: input.existingCodes,
      accountType: templateAcc.type,
      batchClaimed: claimed,
    });
    claimed.add(newCode);

    const newName = generateNewAccountName(
      templateAcc.name,
      input.templateMarketplace,
      input.targetMarketplace,
    );

    const isAmazonSpecific = AMAZON_SPECIFIC_CATEGORIES.has(cat);
    const targetIsAmazon = input.targetMarketplace.toLowerCase().includes('amazon');

    rows.push({
      category: cat,
      enabled: isAmazonSpecific ? targetIsAmazon : true,
      templateCode: templateAcc.code,
      templateName: templateAcc.name,
      newCode,
      newName,
      type: templateAcc.type,
      taxType: templateAcc.taxType,
    });
  }

  return rows;
}

// ─── Execute (Calls Xero) ───────────────────────────────────────────────────

const MAX_BATCH = 10;

/**
 * Execute a COA clone — creates accounts in Xero via the canonical action.
 * Batches in groups of 10 (Xero limit).
 */
export async function executeCoaClone(input: CloneExecuteInput): Promise<CloneResult> {
  const enabledRows = input.rows.filter(r => r.enabled);

  if (enabledRows.length === 0) {
    return { success: false, createdMappings: {}, errors: [{ code: '', error: 'No accounts selected' }] };
  }

  const createdMappings: Record<string, string> = {};
  const allErrors: { code: string; error: string }[] = [];

  // Batch in groups of MAX_BATCH
  for (let i = 0; i < enabledRows.length; i += MAX_BATCH) {
    const batch = enabledRows.slice(i, i + MAX_BATCH);
    const accounts: CreateXeroAccountInput[] = batch.map(row => ({
      code: row.newCode,
      name: row.newName,
      type: row.type,
      tax_type: row.taxType || undefined,
    }));

    const result = await createXeroAccounts(accounts);

    if (!result.success) {
      allErrors.push({ code: '', error: result.error || 'Batch creation failed' });
      // Don't continue if a batch fails entirely
      break;
    }

    if (result.errors) {
      allErrors.push(...result.errors);
    }

    if (result.created) {
      for (const created of result.created) {
        const matchingRow = batch.find(r => r.newCode === created.code);
        if (matchingRow) {
          createdMappings[matchingRow.category] = created.code;
        }
      }
    }
  }

  return {
    success: Object.keys(createdMappings).length > 0,
    createdMappings,
    errors: allErrors,
  };
}
