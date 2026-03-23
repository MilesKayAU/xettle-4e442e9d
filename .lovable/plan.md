

## Add Mirakl Auth Header Variant Support

### Problem
Currently `getMiraklAuthHeader()` returns a string value that always goes into the `Authorization` header. Some Mirakl marketplaces require the API key in `X-API-KEY` header instead. This will cause auth failures for those marketplaces.

### Changes

**1. Database migration — add `auth_header_type` column**
- Add nullable `auth_header_type` column to `mirakl_tokens` table
- Values: `'bearer'` | `'authorization'` | `'x-api-key'`
- Default: `NULL` (helper infers from `auth_mode`: oauth→bearer, api_key→authorization)

**2. Update `mirakl-token.ts` — return header name + value**
- Change `getMiraklAuthHeader()` to return `{ headerName: string; headerValue: string }` instead of a plain string
- Logic:
  - `auth_header_type='bearer'` or oauth default → `{ headerName: 'Authorization', headerValue: 'Bearer <token>' }`
  - `auth_header_type='authorization'` or api_key default → `{ headerName: 'Authorization', headerValue: '<key>' }`
  - `auth_header_type='x-api-key'` → `{ headerName: 'X-API-KEY', headerValue: '<key>' }`
- Add `MiraklTokenRow.auth_header_type` to the interface
- No change to existing defaults — backward compatible

**3. Update callers (`fetch-mirakl-settlements/index.ts`, `mirakl-auth/index.ts`)**
- Replace `Authorization: authHeader` with dynamic `[result.headerName]: result.headerValue`

**4. Update UI (`MiraklConnectionPanel.tsx`)**
- Add optional "Header Format" select (hidden behind an "Advanced" collapsible) with options: Auto (default), Bearer, Authorization, X-API-KEY
- Only shown when auth_mode is `api_key` or `both` (OAuth always uses Bearer)

**5. Update `mirakl-api-policy.ts`**
- Document the three header variants and when each is used

### No changes to
- Transaction type mappings
- OAuth token refresh logic
- Accumulator/settlement engine

