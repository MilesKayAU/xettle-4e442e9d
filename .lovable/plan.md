

# Plan: Extract Accounting Module into Independent App

## What You Have (Module Inventory)

The accounting module is self-contained with these components:

| Layer | Files | Lines |
|-------|-------|-------|
| **UI** | `src/components/admin/accounting/AccountingDashboard.tsx` | ~3,490 |
| **Parser** | `src/utils/settlement-parser.ts` | ~716 |
| **Xero Invoice Sync** | `supabase/functions/sync-amazon-journal/index.ts` | ~450 |
| **Xero OAuth** | `supabase/functions/xero-auth/index.ts` | existing |
| **Xero Connection UI** | `src/components/admin/XeroConnectionStatus.tsx` | existing |
| **Xero Callback Page** | `src/pages/XeroCallback.tsx` | existing |

**Database tables**: `settlements`, `settlement_lines`, `settlement_unmapped`, `xero_tokens`, `app_settings`, `user_roles`, `profiles`

**Secrets needed**: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `RESEND_API_KEY` (for notifications)

## Recommended Approach

**Create a new Lovable project** and port the accounting module as the primary app. This is the cleanest path because:

1. You get a fresh Supabase instance (clean DB, no legacy tables)
2. Independent deployment and domain
3. Own auth system focused on bookkeeper access
4. No risk of breaking the Miles Kay e-commerce site

## What the New App Would Include

1. **Auth** — Supabase email auth with admin role
2. **Dashboard** — The AccountingDashboard as the main page (upload, review, history, settings tabs)
3. **Settlement Parser** — `settlement-parser.ts` copied directly
4. **Edge Functions** — `sync-amazon-journal` and `xero-auth` deployed to new Supabase
5. **Xero Integration** — OAuth connection UI + callback page
6. **Settings** — Account code configuration, GST rate
7. **Database** — Migrations for `settlements`, `settlement_lines`, `settlement_unmapped`, `xero_tokens`, `app_settings`, `user_roles`, `profiles`

## What I Cannot Do From Here

Lovable cannot programmatically create a separate project or copy files between projects. You would need to:

1. **Create a new Lovable project** (click + New Project)
2. **Come back here** and I can help you prepare all the code as a single prompt to paste into the new project, or you can reference this project
3. Alternatively, **remix this project** (Settings → Remix) and then strip out everything except the accounting module

## Recommended Next Step

**Remix this project**, then in the new remixed project, ask me to strip it down to only the accounting module — removing all e-commerce pages (Products, Blog, Contact, Distributors, Where To Buy, etc.), the Alibaba invoice system, logistics, and Amazon product sync. This preserves all the accounting code, edge functions, and database schema intact while giving you an independent app.

The remix approach is fastest because all code, edge functions, and Supabase config carry over. You'd just need to connect a new Supabase project and run the database migrations.

