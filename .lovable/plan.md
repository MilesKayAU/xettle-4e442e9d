

## Why the Duplicate Happened

The root cause is simple: the codebase has no **utility index** that I'm forced to consult before writing new logic. The existing `ARCHITECTURE.md` and `.lovable/audit.md` describe the system at a high level, but they don't contain a searchable registry of "what utility does what" that would flag `coa-intelligence.ts` when I'm about to write COA-scanning logic. The `src/actions/index.ts` barrel file works perfectly for canonical actions — it prevents duplicates there. But `src/utils/` has 30+ files with no equivalent index, so I missed the existing scanner.

## Plan: Create a Utility Capability Index

### 1. Create `src/utils/index.ts` — Barrel Export with Capability Comments

**File:** `src/utils/index.ts`

A barrel file mirroring the pattern in `src/actions/index.ts`. Each section will have a capability comment block that makes it searchable. Example structure:

```typescript
// ─── COA Intelligence (account mapping suggestions, marketplace detection from COA) ───
export { analyseCoA, XETTLE_COA_RULES } from './coa-intelligence';

// ─── Settlement Parsing (Amazon TSV → structured settlement) ──────────────────
export { parseSettlementTSV, PARSER_VERSION } from './settlement-parser';

// ─── File Detection (CSV/XLSX header fingerprinting, marketplace sniffing) ────
export { detectFromHeaders, extractFileHeaders } from './file-fingerprint-engine';
export { detectFileMarketplace } from './file-marketplace-detector';

// ─── Reconciliation (pre-push validation checks) ─────────────────────────────
export { runReconciliation } from './reconciliation-engine';
export { runUniversalReconciliation } from './universal-reconciliation';

// ─── Xero Entries (line-item builders, posting helpers) ───────────────────────
export { buildXeroLineItems } from './xero-entries';
export { buildXeroPostingLineItems } from './xero-posting-line-items';

// ... every utility file gets a section
```

This gives me a single file to check before writing anything in `src/utils/`.

### 2. Add Capability Headers to ARCHITECTURE.md Section

**File:** `ARCHITECTURE.md`

Add a new section **"Utility Capability Map"** — a compact table listing every util file, its purpose, and key exports. This is the quick-reference I should always consult:

```
| File | Capability | Key Exports |
|------|-----------|-------------|
| coa-intelligence.ts | COA scanning, mapping suggestions | analyseCoA |
| settlement-engine.ts | Settlement CRUD, Xero sync | saveSettlement, syncSettlementToXero |
| reconciliation-engine.ts | Amazon recon checks | runReconciliation |
| ... | ... | ... |
```

### 3. Add a Guardrail Comment to Key Files

**Files:** `src/components/settings/AccountMapperCard.tsx` and any component that does COA/mapping work

Add a header comment:

```typescript
// ══════════════════════════════════════════════════════════════
// BEFORE adding new utility logic here, check src/utils/index.ts
// for existing capabilities. See: coa-intelligence.ts, xero-mapping-readiness.ts
// ══════════════════════════════════════════════════════════════
```

### Files Affected
- `src/utils/index.ts` — new barrel file with capability-annotated exports
- `ARCHITECTURE.md` — new "Utility Capability Map" section
- `src/components/settings/AccountMapperCard.tsx` — guardrail comment header

