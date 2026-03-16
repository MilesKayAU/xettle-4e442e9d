

# Audit Result: Lifecycle Enforcement Is Already Wired

## Corrected Status Table

The previous status table was based on stale information. Here is the actual state after reading the code:

```text
Feature                                    Status
─────────────────────────────────────────  ──────
Migration (lifecycle columns + RPC)        ✅ DONE
saveSettlement() date gate (no fallback)   ✅ DONE  (lines 657-682)
saveSettlement() loads fingerprint         ✅ DONE  (lines 685-687)
saveSettlement() blocks rejected           ✅ DONE  (lines 689-695)
saveSettlement() calls validateDraftGates  ✅ DONE  (lines 697-698)
saveSettlement() logs format_save_blocked  ✅ DONE  (lines 700-717, inline)
saveSettlement() calls RPC for auto-promote✅ DONE  (lines 728-730 → saveWithAtomicPromote)
saveWithAtomicPromote uses RPC             ✅ DONE  (line 602, promote_and_save_settlement)
saveWithAtomicPromote logs promotion event ✅ DONE  (lines 589-600, via RPC p_system_event)
Learning loop uses createDraftFingerprint  ❌ NOT DONE (line 1005, direct insert)
Learning loop logs failure                 ❌ NOT DONE (line 1035, empty catch)
Doc comment in fingerprint-lifecycle.ts    ❌ NOT DONE
logPromotionEvent/logSaveBlocked helpers   ❌ NOT DONE (but equivalent inline logic exists)
Badge UI                                   ❌ NOT DONE
fingerprint_id enforcement guard           ❌ NOT DONE (no guard when lifecycleEnabled)
```

**Key finding**: `saveSettlement()` already enforces the full lifecycle — rejected blocks, draft gates, atomic RPC promotion. The user's concern that "saveSettlement enforces lifecycle ❌ NOT done" was incorrect.

## What Actually Remains (3 items + helpers)

### 1. Fix Learning Loop (SmartUploadFlow lines 1005-1013)

Replace direct `marketplace_file_fingerprints` insert with `createDraftFingerprint()`. Add error logging in the catch block.

**File**: `src/components/admin/accounting/SmartUploadFlow.tsx`

- Import `createDraftFingerprint` from `@/utils/fingerprint-lifecycle`
- Replace lines 1005-1013 with `createDraftFingerprint({ userId, marketplaceCode, columnSignature, columnMapping, parserType: 'generic', confidence, filePattern })`
- Replace empty `catch {}` at line 1035 with `catch (err) { console.error('[learning-loop]', err); }` and a `system_events` warning log

### 2. Add Safety Guards to fingerprint-lifecycle.ts

**File**: `src/utils/fingerprint-lifecycle.ts`

- Add doc comment at line 1: `// DO NOT insert directly into marketplace_file_fingerprints. Always use createDraftFingerprint().`
- Add `logPromotionEvent()` helper (reusable; currently done inline in settlement-engine but good to centralize)
- Add `logSaveBlocked()` helper (same — currently inline at lines 700-717)

### 3. Add fingerprint_id enforcement in settlement-engine.ts

**File**: `src/utils/settlement-engine.ts`

Add guard before the main insert (line 832):
```typescript
if (settlement.metadata?.lifecycleEnabled && !settlement.fingerprint_id) {
  return { success: false, error: 'Settlement save requires fingerprint_id when lifecycle is enabled.' };
}
```

### 4. Badge UI (after tests pass)

**File**: `src/components/admin/accounting/SmartUploadFlow.tsx`

- Add `fingerprintStatus` and `fingerprintParserType` to the `DetectedFile` interface
- Thread status from detection results
- Render Badge with DRAFT/ACTIVE/REJECTED + parser_type, with null guard

## Execution Order

1. Fix learning loop (replace direct insert, add error logging)
2. Add doc comment + helper functions to fingerprint-lifecycle.ts
3. Add fingerprint_id guard to settlement-engine.ts
4. Run tests
5. Badge UI

## Files Changed

| File | Change |
|------|--------|
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Replace direct insert with `createDraftFingerprint()`, add error logging, add Badge UI + interface fields |
| `src/utils/fingerprint-lifecycle.ts` | Doc comment, `logPromotionEvent()`, `logSaveBlocked()` helpers |
| `src/utils/settlement-engine.ts` | `fingerprint_id` enforcement guard (1 line) |

