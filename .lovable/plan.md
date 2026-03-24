

## Audit: How Kogan Notifications Reach the Customer Today

### What currently works

1. **Upload Flow (SmartUploadFlow.tsx)** — The Kogan pairing card is well-built:
   - Groups CSVs and PDFs by doc number/period
   - Shows "✅ Paired", "⚠ Missing PDF", "⚠ No saved Kogan settlement found"
   - Warns that CSV-only totals exclude returns/ad spend/seller fees
   - "Upload missing files" button opens file picker
   - "Merge PDF into Saved Settlement" for late-PDF uploads

2. **Validation Sweep (run-validation-sweep/index.ts)** — Kogan auto-generated settlements (`shopify_auto_kogan_*`) do create `settlement_needed` rows, which feed the "Upload Needed" card in Settlements Overview.

3. **Dashboard cards** — RecentSettlements and RecentUploads both include Kogan in their label maps.

4. **DailyTaskStrip** — Shows a generic "N marketplaces have no recent settlement" banner when `missingSettlementCount > 0`.

### What is missing or weak

| Gap | Where it should appear | Current state |
|-----|----------------------|---------------|
| **No Kogan-specific upload guidance on the dashboard** | DailyTaskStrip / ActionControlPanel | The strip says "N marketplaces have no recent settlement" but doesn't name Kogan or explain that CSV+PDF pairs are required |
| **No explanation that Kogan needs TWO files** | Upload flow header, WelcomeGuide, OnboardingTodos | The pairing card shows the state but there's no upfront instruction before the user drops files |
| **ActionControlPanel "Upload Needed" card doesn't distinguish Kogan** | ActionControlPanel.tsx | Lists all missing marketplaces generically — doesn't note Kogan requires CSV+PDF pair |
| **Missing settlement banner in upload sheet** | Dashboard.tsx upload overlay | Shows `missingSettlements` list from validation, but Kogan entries don't mention "CSV + PDF required" |
| **No persistent dashboard notification for Kogan with missingPdf=true** | Dashboard home, ActionControlPanel | If a Kogan CSV was saved without its PDF, there's no ongoing alert telling the user to upload the PDF to fix the net payout |
| **SettlementCoverageMap** | Onboarding coverage map | Shows Kogan periods but doesn't highlight that red cells specifically need CSV+PDF |

### Plan: Add Kogan-Specific Notifications Across 4 Surfaces

**1. Upload flow — Add upfront Kogan pairing guidance**

File: `src/components/admin/accounting/SmartUploadFlow.tsx`

Before the pairing card, when Kogan files are detected, show a one-line info banner:
> "Kogan settlements require both a CSV (order data) and PDF (Remittance Advice) for accurate reconciliation. Upload both files together for best results."

This appears only when Kogan files are in the upload list but not all pairs are complete.

**2. Dashboard DailyTaskStrip — Name Kogan specifically**

File: `src/components/dashboard/DailyTaskStrip.tsx`

When `missingSettlementCount > 0`, enhance the banner to list which marketplaces need uploads (passed from Dashboard.tsx). For Kogan specifically, append "(CSV + PDF pair)".

File: `src/pages/Dashboard.tsx`

Pass the marketplace names (not just the count) to DailyTaskStrip so it can render them.

**3. ActionControlPanel — Kogan-specific "Upload Needed" detail**

File: `src/components/admin/accounting/ActionControlPanel.tsx`

In the "Upload Needed" card, when a missing marketplace is Kogan, add a subtitle: "Requires CSV + PDF pair".

**4. Dashboard — Alert for saved Kogan settlements with missingPdf=true**

File: `src/pages/Dashboard.tsx`

Query settlements where `marketplace ILIKE '%kogan%' AND metadata->>'missingPdf' = 'true'`. If any exist, show a small amber banner:
> "N Kogan settlement(s) saved without PDF — net payout may not match bank deposit. Upload the Remittance PDF to correct."

With a button that opens the upload sheet.

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Add Kogan pairing guidance banner above pairing card |
| `src/components/dashboard/DailyTaskStrip.tsx` | Accept marketplace names list; show Kogan "(CSV + PDF)" note |
| `src/pages/Dashboard.tsx` | Pass marketplace names to DailyTaskStrip; add missingPdf Kogan alert query + banner |
| `src/components/admin/accounting/ActionControlPanel.tsx` | Add "CSV + PDF pair" subtitle for Kogan in Upload Needed card |

### No database changes needed

