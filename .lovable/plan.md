

## Validation: Current State Already Matches Requirements

After reviewing the codebase, the previous round of changes already implemented nearly everything requested:

| Requirement | Status |
|---|---|
| Default auth_mode = api_key | ✅ Line 36: `useState<AuthMode>('api_key')` |
| API key field shown by default | ✅ Visible when authMode = api_key |
| OAuth hidden unless user switches | ✅ Only shown when authMode = oauth/both |
| Bunnings onboarding instructions in UI | ✅ Lines 246-257, step-by-step guide |
| Backend uses `getMiraklAuthHeader()` | ✅ No Bunnings-specific logic in edge function |
| api_key mode → `Authorization: <key>` (not Bearer) | ✅ `mirakl-token.ts` line 94: default case returns raw key |
| Override via auth_header_type | ✅ Supported via Advanced section |
| Dual auth (oauth / api_key / both) preserved | ✅ All three modes in RadioGroup |

### One Fix Needed

The OAuth radio label says **"OAuth (recommended)"** — this is misleading since API Key is the correct default for Bunnings. 

**Change:** Swap the labels:
- `api_key` → **"API Key (recommended)"**
- `oauth` → **"OAuth"**

This is a two-line label change in `MiraklConnectionPanel.tsx` (lines 285 and 291).

### No backend changes
The `mirakl-token.ts` shared helper and `fetch-mirakl-settlements` edge function are correctly implemented with dynamic auth detection. No changes needed.

