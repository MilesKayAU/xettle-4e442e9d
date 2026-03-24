
Problem confirmed: the live Kogan PDF uploads are still being routed through the generic CSV parser path in some save flows, which is why users see “Could not find sales or net payout columns in the file.” That message can only come from `parseGenericCSV`, and the current Kogan handling is incomplete because Kogan PDFs are shown as companion files in the UI but `processAllConfirmed()` still iterates every detected file and calls `processFile()` on the PDF itself.

What I found
- `detectFile()` correctly classifies `Kogan_3446386.pdf` as `marketplace: 'kogan'`, `fileFormat: 'pdf'`, `dataCompleteness: 'partial'`.
- The uploaded PDF itself parses structurally fine. The parsed content includes:
  - `A/P Invoice 344840`
  - `Monthly Seller Fee`
  - `Total paid amount: 525.41 AUD`
- In `SmartUploadFlow.tsx`, `preParseFile()` returns `[]` for Kogan PDFs intentionally.
- But in `processFile()`, Kogan PDFs are not handled as a special case, so they fall into the generic parser branch and trigger the CSV-column error.
- `processAllConfirmed()` currently processes every detected/reviewing settlement file, including Kogan PDFs, so bulk upload is guaranteed to hit this bug.
- The current Kogan merge logic also grabs the first uploaded Kogan PDF globally, not the matched PDF for the specific CSV settlement. That is unsafe for bulk uploads and can merge the wrong remittance into the wrong settlement.

Implementation plan

1. Make Kogan PDFs canonical companion files, not standalone settlement files in save flow
- Update `processFile()` so:
  - Kogan PDF never falls through to `parseGenericCSV` / `parseGenericXLSX`
  - If user tries to save a Kogan PDF by itself, show a clear status like “Waiting for matching CSV” instead of an error
- Update `processAllConfirmed()` to skip standalone Kogan PDF files entirely
- Result: bulk upload no longer throws the misleading generic parser error

2. Make Kogan pairing the single source of truth for bulk and single saves
- Use the existing `koganPairings` grouping as the canonical matching model
- When saving a Kogan CSV, locate its matched PDF by doc number from the pairing map, not by “first Kogan PDF found”
- If no matched PDF exists:
  - save CSV-only with `metadata.missingPdf = true`
  - preserve explicit warning that reconciliation is incomplete
- If a matched PDF exists:
  - merge only that PDF’s remittance values into that CSV settlement

3. Tighten Kogan PDF parsing and pairing reliability
- Extend doc-number extraction to support the real Kogan remittance layout consistently:
  - `A/P Invoice`
  - `A/P Credit note`
  - `Journal Entry`
  - remittance header number vs invoice doc number
- Ensure pairing uses invoice doc numbers from paid documents table, not the remittance number in the filename/title
- Add a fallback pairing rule when one CSV settlement and one PDF clearly overlap by date/period but doc number extraction is imperfect

4. Improve UX so the system is explicit about what is accurate vs incomplete
- In the Kogan pairing card:
  - clearly label each row as `Ready to save`, `Missing PDF`, or `Missing CSV`
  - suppress any generic “sales/net payout column” errors for PDFs
  - show PDF-only rows as informational, not failed
- For CSV-only Kogan saves:
  - show “Saved with warning — bank deposit may be wrong until PDF is added”
- For PDF-only uploads:
  - show “Recognised remittance advice — upload the matching CSV to complete this settlement”

5. Make downstream analytics respect Kogan completeness status
- Audit all insights loaders that use settlement totals so CSV-only Kogan settlements are visibly treated as incomplete where relevant
- Specifically:
  - keep saved revenue/order detail from CSV
  - ensure net payout / fee-sensitive views can surface that `missingPdf` is present
  - add subtle warnings in Insights where Kogan figures are based on incomplete settlement data
- This keeps charts usable without pretending incomplete Kogan data is final

Files to update
- `src/components/admin/accounting/SmartUploadFlow.tsx`
  - skip Kogan PDFs in save loops
  - handle Kogan PDF as companion-only file
  - save via matched pair, not first-PDF-wins
  - improve user-facing statuses/messages
- `src/utils/kogan-remittance-parser.ts`
  - harden paid-doc extraction and invoice doc-number matching
- Potentially small follow-up touches in:
  - `src/components/admin/accounting/InsightsDashboard.tsx`
  - `src/components/insights/MarketplaceProfitComparison.tsx`
  if incomplete Kogan settlements need an explicit warning state in analytics UI

Expected outcome
- Bulk uploading many Kogan PDFs will no longer fail with the generic CSV parser message
- The uploader will accurately tell the user:
  - which settlements are complete
  - which are missing a PDF
  - which are missing a CSV
- Only matched CSV+PDF pairs will be merged
- Insights and downstream profit views will use the right source state and flag incomplete Kogan settlements instead of silently treating them as fully reconciled

Technical note
- The live issue is real and reproducible from code inspection: the error text originates from `generic-csv-parser.ts`, and the only path that explains the screenshot is Kogan PDFs being incorrectly processed through the generic parser during bulk save.
- The biggest correctness fix is not just “parse PDFs better”; it is making Kogan PDFs non-saveable standalone companions and binding merge logic to the exact pair instead of any uploaded Kogan PDF.
