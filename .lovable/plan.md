
Problem confirmed from the two attached files:

- The PDF `Kogan_3618482_1.pdf` clearly contains:
  - A/P Invoice `362490`
  - Transfer Date `23/03/2026`
  - Total paid amount `663.15 AUD`
- The CSV `KGN-AUMKAKOGAU20260315_362490_2.csv` clearly contains:
  - `APInvoice = 362490`
  - `InvoiceDate = 20260315`
  - `DateManifested = 20260301`

So these two files do belong together. The match is failing because of code, not because of the files.

What is actually broken

1. `parseKoganPayoutCSV()` is not parsing Kogan’s compact dates
   - In `src/utils/kogan-remittance-parser.ts`, `tryParseDate()` only supports:
     - `DD/MM/YYYY`
     - `YYYY-MM-DD`
   - Your Kogan CSV uses `YYYYMMDD` like `20260315`
   - Result: the parser cannot derive `period_start` / `period_end`

2. Because the CSV parse has no valid dates, the settlement never becomes a proper Kogan settlement
   - This matches the backend warnings already being logged:
     - `format_missing_dates_requires_manual_entry`
     - settlement_id `362490`

3. The pairing UI then makes it worse
   - In `src/components/admin/accounting/SmartUploadFlow.tsx`, if a CSV has no parsed settlement, the pairing card falls back to using the whole filename as the “doc number”
   - That means it tries to match the PDF against:
     - `KGN-AUMKAKOGAU20260315_362490_2`
     instead of:
     - `362490`
   - So it incorrectly shows “Missing PDF” even though the PDF is right there

Implementation plan

1. Fix Kogan date parsing
   - Update `tryParseDate()` in `src/utils/kogan-remittance-parser.ts`
   - Add support for compact `YYYYMMDD`
   - Use it for `InvoiceDate`, `DateManifested`, and `DateRemitted`

2. Make Kogan CSV parsing deterministic for this format
   - Keep grouping by `APInvoice`
   - Ensure `362490` produces a real settlement:
     - `settlement_id = kogan_362490`
     - `period_start = 2026-03-01`
     - `period_end = 2026-03-31`
     - `metadata.periodMonth = 2026-03`

3. Fix pairing fallback logic in the upload UI
   - In `SmartUploadFlow.tsx`, do not use the full filename as the primary fallback doc number for Kogan
   - If settlements are missing, extract the numeric invoice from:
     - parsed CSV content, or
     - filename regex `_362490_`
   - This ensures doc-number matching still works even before save

4. Fix the false “Missing PDF” state
   - If the CSV failed to parse into a proper settlement, show the real error:
     - “CSV date format could not be parsed”
   - Do not show “Missing PDF” when the real problem is a broken CSV parse

5. Add a narrow regression test
   - Add a parser test covering:
     - CSV with `InvoiceDate=20260315`
     - PDF with A/P Invoice `362490`
     - expected paired month `2026-03`
   - This prevents the same bug returning

Files to update

- `src/utils/kogan-remittance-parser.ts`
  - add `YYYYMMDD` support
  - ensure period month is built correctly from compact dates

- `src/components/admin/accounting/SmartUploadFlow.tsx`
  - repair Kogan pairing fallback logic
  - stop showing false “Missing PDF” when CSV parse failed
  - prefer extracted invoice number over whole filename fallback

Technical note

The root cause is not the PDF matcher itself. The root cause is:
```text
CSV date parse fails
→ no valid Kogan settlement object
→ pairing code falls back to full filename instead of invoice number
→ doc-number and month matching both fail
→ UI incorrectly says “Missing PDF”
```

Expected outcome after fix

For these exact two files:
```text
CSV: APInvoice 362490, InvoiceDate 20260315
PDF: A/P Invoice 362490, Transfer Date 23/03/2026
```

The upload flow should show one paired Kogan settlement for March 2026, with the PDF attached and ready to save correctly.

No database changes needed.
