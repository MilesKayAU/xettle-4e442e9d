

## Investigate & Fix Marketplace Detection Gaps

### Analysis

The parser and registry architecture are correct — PayPal and Manual match perfectly when GST is accounted for. The ~30% gaps in MyDeal, Kogan, and Bunnings mean some orders are landing in the `unknown` group because their Note Attributes/Tags/Payment Method don't match any registry pattern.

The unknown group UI already shows sample patterns, but only 3 samples. To properly diagnose, we need to see ALL unique pattern combinations in the unknown group.

### Changes

**1. Enhanced Detection Gaps Report (`ShopifyOrdersDashboard.tsx`)**
- In the unknown groups section, show a full breakdown table of ALL unique (Note Attributes snippet, Tags, Payment Method) combinations with order count and total amount
- This lets the user immediately see which patterns need adding
- Add a "Copy patterns" button for easy reporting

**2. Add likely missing registry patterns (`marketplace-registry.ts`)**
Based on common Shopify/marketplace integrations, add these patterns that are frequently seen but not yet registered:

- **MyDeal**: `payment_method_patterns` — add `'my deal'`, `'mydeal marketplace'`; `tags_patterns` — add `'MyDeal'` (exact case variant), `'my-deal'`
- **Kogan**: `note_attributes_patterns` — add `'Tenant_id: Kogan'`, `'Channel_id:'` with Kogan channel IDs; `tags_patterns` — add `'cedcommerce'` (without the full comma-separated string), `'kogan.com'`
- **Bunnings**: `note_attributes_patterns` — add `'mirakl'` (lowercase catch-all in notes), `'Operator_id:'` (Mirakl operator field); `tags_patterns` — add `'Bunnings Marketplace'`, `'mirakl-connector'`

**3. Include GST totals in results UI (`ShopifyOrdersDashboard.tsx`)**
- Show both ex-GST and incl-GST amounts per marketplace group card so the user can compare directly with LinkMyBooks figures without mental math
- Format: `$1,334.50 ex GST · $1,468.00 incl GST`

**4. Unknown group deep-dive panel (`ShopifyOrdersDashboard.tsx`)**
- Expandable section showing every order in an unknown group with its raw Note Attributes, Tags, and Payment Method
- This replaces the current 3-sample approach with full visibility
- Max 50 rows shown with "and X more" truncation

### Files Changed
1. **Edit**: `src/utils/marketplace-registry.ts` — Add missing detection patterns
2. **Edit**: `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` — Enhanced unknown group diagnostics + GST-inclusive totals on all group cards

### No database changes needed

