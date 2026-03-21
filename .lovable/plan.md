

# Amazon API Compliance Dashboard

## What Gets Built

### 1. New Admin Page: `AmazonComplianceDashboard`
A dedicated admin component added as a new nav item under "Operations" (alongside Fulfillment Bridge). Contains three sections:

**Compliance Checklist** — Persistent, database-backed checklist of SP-API approval requirements. Pre-seeded with the critical items from your screenshot (OAuth/LwA flow, RDT for PII, exponential backoff, idempotency, PII purge, account lockout, API key rotation). Each item has:
- Title + description
- Status toggle (compliant / not yet)
- Notes field for evidence links or implementation details
- "Add Custom Item" button for new requirements as they emerge

**API Audit Console** — Embedded view of the existing `api_call_log` data (currently in the Fulfillment Bridge "API Audit" tab), but surfaced here as the primary audit tool with additional filters (date range, endpoint, error-only view) and CSV export for Amazon's review team.

**Amazon Email Analyzer (AI)** — A text area where you paste an email from Amazon's developer support. Sends it to an edge function that uses Gemini Flash to:
1. Extract the specific requirements/questions Amazon is asking about
2. Search the codebase knowledge (using a pre-built context of your FBM architecture, audit log, circuit breaker, retry logic, PII policy, etc.) to determine which features already satisfy each requirement
3. Return a structured response: for each requirement, whether it's already implemented (with evidence/file references) or needs to be built, plus a draft reply you could send back to Amazon

### 2. Database
New `amazon_compliance_items` table:
- `id`, `user_id`, `title`, `description`, `category` (text — 'code_architecture', 'data_protection', 'operational', 'custom')
- `is_compliant` (boolean, default false)
- `evidence_notes` (text, nullable)
- `created_at`, `updated_at`

Pre-seeded via migration with the 7 critical items from your screenshot. RLS: admin-only access.

### 3. Edge Function: `ai-amazon-compliance`
Accepts pasted email text, sends to Gemini Flash with a system prompt containing a structured summary of all FBM Bridge capabilities (circuit breaker, retry queue, audit log, OAuth flow, PII handling, idempotency checks). Returns:
- Extracted requirements from the email
- Per-requirement compliance status with file/feature references
- Draft reply text

## Files Changed

| File | What |
|------|------|
| Database migration | `amazon_compliance_items` table + seed data |
| `src/components/admin/AmazonComplianceDashboard.tsx` | New component: checklist + audit console + email analyzer |
| `supabase/functions/ai-amazon-compliance/index.ts` | New edge function for email analysis |
| `src/pages/Admin.tsx` | Add nav item + import |

