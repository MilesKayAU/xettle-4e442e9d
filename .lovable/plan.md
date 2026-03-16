

# Fix eBay OAuth — Update Secrets and Redeploy

## Problem
The logs confirm `client_id` and `runame` were set to the same value (`MilesKay-dropshif-PRD-7abfbb41d-a8592faa`), causing eBay to reject the OAuth request.

## Plan

1. **Update three secrets** with the correct distinct values:
   - `EBAY_CLIENT_ID` = `MilesKay-dropshif-PRD-7abfbb41d-a8592faa`
   - `EBAY_CERT_ID` = `PRD-abfbb41dce71-6515-4167-b7c7-c9c8`
   - `EBAY_RUNAME` = `Miles_Kay_Austr-MilesKay-dropsh-rsmozsg`

2. **Redeploy `ebay-auth`** edge function so it picks up the new secrets

3. **Test the authorize action** to verify the URL now shows distinct `client_id` and `redirect_uri` values

## User Action Required
You must confirm in the eBay Developer Portal that the RuName `Miles_Kay_Austr-MilesKay-dropsh-rsmozsg` has these redirect URLs configured:
- Accept URL: `https://xettle.lovable.app/ebay/callback`
- Decline URL: `https://xettle.lovable.app/ebay/callback`

No code changes needed — the edge function logic is already correct.

