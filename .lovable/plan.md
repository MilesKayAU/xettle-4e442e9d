

# QA Bug Reporting System — Build Plan

## Pre-requisite: Anthropic API Key
No Anthropic API key is currently configured. Before the AI triage function can work, you'll need to provide an `ANTHROPIC_API_KEY` secret. I'll prompt you for this during implementation.

## Database

**Migration**: Create `bug_reports` table with all specified fields. RLS policies:
- Authenticated users can INSERT with `auth.uid() = submitted_by`
- Users can SELECT their own rows (`auth.uid() = submitted_by`)
- Admins can SELECT all (`has_role('admin')`)
- Admins can UPDATE all (`has_role('admin')`)

## Edge Function: `ai-bug-triage`

Calls Anthropic API (`claude-sonnet-4-20250514`) directly — not Lovable AI gateway. Uses the exact system prompt specified (QA analyst for Xettle, JSON-only response with summary, classification, complexity, affected_system, lovable_prompt, owner_question). Sets `verify_jwt = false` in config.toml, validates auth in code.

## Frontend Components

### 1. `BugReportButton` (floating, bottom-left)
- Added inside `App.tsx` after `PinGate`, outside `Routes`
- Queries `user_roles` on mount; renders only for admin/bookkeeper roles
- Intercepts `window.onerror` and wraps `console.error` to capture last 10 errors in a ref
- Click opens `BugReportModal`

### 2. `BugReportModal`
- Auto-captures: `window.location.href`, timestamp, user email (from session), intercepted console errors
- Required text field: "Describe the issue"
- Screenshot: `onPaste` handler for clipboard images + file upload button, stored as base64
- Severity selector: Low / Medium / High / Critical (radio group)
- On submit: INSERT into `bug_reports`, then invoke `ai-bug-triage`, then UPDATE row with AI fields
- Shows success toast with complexity result

### 3. `BugReportsDashboard` (new Admin tab)
- New `TabsTrigger` "Bug Reports" added to existing Admin page Tabs
- Table: severity badge, AI classification, complexity, status, submitter email, page URL, time ago
- Expandable rows: full description, rendered screenshot, console errors JSON, AI summary
- AI Lovable prompt in a monospace code block with copy-to-clipboard button
- Owner notes textarea (admin-editable, saves on blur via UPDATE)
- Status flow buttons: Open → In Progress → Resolved (updates `status`, sets `resolved_at` on Resolved)
- Notify Submitter toggle
- Filter dropdowns: status, severity, complexity, classification

### 4. Bookkeeper Notification Banner
- On Dashboard load: query `bug_reports` where `notify_submitter=true`, `status='resolved'`, `submitted_by=current_user`
- Check `app_settings` for `bug_notification_{id}` to see if dismissed
- Green banner with description snippet; dismiss writes to `app_settings`

## Files to Create/Modify
- `supabase/functions/ai-bug-triage/index.ts` — new edge function
- `src/components/bug-report/BugReportButton.tsx` — floating button + error interceptor
- `src/components/bug-report/BugReportModal.tsx` — capture modal
- `src/components/bug-report/BugReportNotificationBanner.tsx` — resolved notification
- `src/components/admin/BugReportsDashboard.tsx` — admin tab content
- `src/App.tsx` — add BugReportButton
- `src/pages/Admin.tsx` — add Bug Reports tab
- `src/pages/Dashboard.tsx` — add notification banner

