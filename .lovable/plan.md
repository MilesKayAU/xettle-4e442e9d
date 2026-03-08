

## Delete Amazon Token for Fresh OAuth Test

### Steps

1. **Delete the user's `amazon_tokens` record** via a database query — this removes the stored refresh token so the "Connect Amazon" button appears again.

2. **No code changes needed** — the UI already shows the connect button when no token exists.

### SQL Migration

```sql
DELETE FROM amazon_tokens;
```

This clears all amazon token records, allowing a fresh OAuth connect test with the `version=beta` fix.

