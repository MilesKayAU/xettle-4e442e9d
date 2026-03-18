

## The Conflict

You're right — there is a real contradiction. The AI policy currently states:

```
- Xettle NEVER creates accounts in Xero.
- Xettle NEVER renames accounts in Xero.
```

But the app **does** create accounts in Xero via the COA Cloning system (`coaClone.ts` → `createXeroAccounts` → `create-xero-accounts` edge function). This is a PIN-gated, user-confirmed, audited flow that is a core feature.

The AI assistant incorrectly told you "No New Accounts" because the policy is too absolute.

## What Needs to Change

The policy should distinguish between what the **AI assistant** can do (nothing — it's read-only) and what the **app** can do (create accounts via the clone flow).

### 1. Update `supabase/functions/_shared/ai_policy.ts`

**Policy constants** — rename to clarify scope:
```ts
COA: {
  AI_NEVER_CREATES_ACCOUNTS: true,        // was NEVER_CREATE_XERO_ACCOUNTS
  AI_NEVER_RENAMES_ACCOUNTS: true,
  AI_NEVER_MODIFIES_ACCOUNT_CODES: true,
  AI_NEVER_AUTO_SAVES_MAPPINGS: true,
  AI_NEVER_ASSUMES_ACCOUNT_NUMBERS: true,
  APP_CAN_CLONE_COA_WITH_APPROVAL: true,   // NEW
}
```

**Prompt text** — reword the COA section:
```
CHART OF ACCOUNTS (COA):
- The AI assistant NEVER creates, renames, or modifies Xero accounts.
- The AI assistant NEVER auto-saves account mappings or assumes account numbers.
- However, Xettle DOES have a COA Cloning feature that can create new accounts in Xero.
  This requires PIN verification and explicit user confirmation via the Clone COA dialog.
- If a user needs new accounts for a marketplace, guide them to the COA Clone flow
  in Settings, or they can create accounts manually in Xero and refresh the cache.
```

### 2. Update `src/ai/policy/xettleAiPolicy.ts` (client mirror)

Update `CANNOT_DO` list:
```diff
- "Create, rename, or modify Xero accounts",
+ "Create, rename, or modify Xero accounts directly (the COA Clone feature handles account creation with PIN approval)",
```

Add to `CAN_DO`:
```
"Guide users to the COA Clone flow for creating new marketplace accounts in Xero"
```

### 3. No changes to actual COA clone logic

The clone system is correct as-is. Only the AI policy language needs updating.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/ai_policy.ts` | Reword COA policy to distinguish AI vs app capabilities |
| `src/ai/policy/xettleAiPolicy.ts` | Sync CAN_DO / CANNOT_DO lists |

