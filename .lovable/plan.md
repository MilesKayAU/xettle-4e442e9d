

## Finding: No Kogan CSVs Were Saved — PDFs Are Correctly Showing "Missing CSV"

### What happened

The database only contains **auto-generated** Kogan settlements (`shopify_auto_kogan_2026-01_...`, `shopify_auto_kogan_2026-02_...`, etc.) — these come from Shopify order data, not from CSV uploads.

There are **zero CSV-uploaded Kogan settlements** in the database. The user's previous CSV uploads either failed during save or were never confirmed. The 8 PDFs are correctly showing "Missing CSV" because their matching CSVs genuinely don't exist in the database.

### The real issue

The user expected their previously uploaded CSVs to be in the system, but they weren't saved. This means:
1. The PDFs are working correctly — they detect doc numbers and look for matches
2. The DB lookup works correctly — it just finds nothing because there's nothing to find
3. The user needs to **re-upload the Kogan CSVs alongside the PDFs** (or upload CSVs first, save them, then upload PDFs)

### What should be improved

The UX doesn't make this clear enough. When PDFs show "Missing CSV," the user assumes the system failed to link — not that the CSVs were never saved. Two improvements:

**1. Clearer messaging when no DB match exists**

Currently: "Missing CSV — order details unavailable"

Better: "No saved Kogan settlement found for this doc number. Upload the matching CSV to create a complete settlement pair."

**2. Show the auto-generated settlement as a potential match (with warning)**

The DB has `shopify_auto_kogan_2026-02_...` and `shopify_auto_kogan_2026-03_...` settlements. These cover the same periods as some PDFs. The system could note: "An auto-generated settlement exists for this period — uploading the CSV will replace it with authoritative data."

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Improve "Missing CSV" messaging; optionally show auto-generated settlement matches as context |

### No database changes needed

