

# Fix Cron Jobs — Fulfillment Bridge V1

## Current State (from DB query)

Two cron jobs exist:
1. **Job 11** `fbm-poll-every-10-min` (`*/10 * * * *`) — uses vault service role key via `email_queue_service_role_key` name. Wrong schedule.
2. **Job 12** `fbm-poll-every-hour` (`0 * * * *`) — uses hardcoded anon key. Correct schedule, wrong auth.

Neither sends `x-cron-secret` header as required by the prompt.

The `FBM_CRON_SECRET` secret exists in the project but no vault entry maps to it for pg_net use.

## Plan

### Step 1: Delete both existing cron jobs
```sql
SELECT cron.unschedule('fbm-poll-every-10-min');
SELECT cron.unschedule('fbm-poll-every-hour');
```

### Step 2: Store FBM_CRON_SECRET in vault for pg_net access
Insert the secret into `vault.secrets` with a named reference so the cron SQL can retrieve it dynamically (same pattern as `email_queue_service_role_key`).

### Step 3: Create correct hourly cron job
One job with:
- Schedule: `0 * * * *` (hourly)
- Headers: `x-cron-secret` pulled from vault + `Content-Type`
- Also include `Authorization: Bearer <service_role_key>` from vault (needed to pass the edge function's auth check via the service-role path)
- Body: `{"user_id":"9d34d250-...","store_key":"primary","dry_run":false}`

The edge function already accepts service-role-key auth OR x-cron-secret. Sending both ensures the cron secret requirement from the prompt is met while maintaining a working auth path.

### Files changed
- No file changes needed — this is purely database operations via SQL queries.

