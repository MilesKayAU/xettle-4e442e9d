

# Fix Unknown Channel Help UX

## Problem
Lines 368-381 in `ChannelAlertsBanner.tsx` show a "Check your Sales Channels settings" link for all numeric channel IDs. This is misleading — channels like Kogan via CedCommerce don't appear in Shopify's Sales Channels settings.

## Changes

**Single file: `src/components/dashboard/ChannelAlertsBanner.tsx`**

### 1. Add connector app mapping (top of file, after `isNumericChannelId`)
```typescript
const KNOWN_CONNECTOR_APPS: Record<string, string> = {
  'cedcommerce': 'Orders managed via CedCommerce — check which marketplace in your CedCommerce dashboard',
  'codisto': 'Orders managed via Codisto/Linnworks',
  'm2e pro': 'Orders managed via M2E Pro (eBay/Amazon connector)',
  'shopify markets': 'International orders via Shopify Markets',
};

function getConnectorNote(candidateTags: string[]): string | null {
  const joined = candidateTags.join(' ').toLowerCase();
  for (const [key, note] of Object.entries(KNOWN_CONNECTOR_APPS)) {
    if (joined.includes(key)) return note;
  }
  return null;
}
```

### 2. Replace lines 368-381 (the Shopify admin link block) with smart contextual help

**When `isTagDetected` (detection_method = 'tag') AND numeric channel ID**: Show nothing — we already identified it from tags. The detected_label line (339) already shows `(detected from order tags)`.

**When `isUnknown` AND numeric channel ID**: Replace the single Sales Channels link with:
- A help section explaining where to look (orders, installed apps, order tags)
- Two links: "Search your Shopify apps" → `admin.shopify.com/store/{shop}/apps`, "View these orders" → `admin.shopify.com/store/{shop}/orders?created_at_min={first_seen_at}`
- If `candidateTags` match a known connector app, show the connector note

**When NOT numeric channel ID**: No change (non-numeric source_names like "ebay" are self-explanatory).

### 3. Specific replacement for lines 368-381

Remove the current block and replace with:
```tsx
{/* Smart help for numeric channel IDs */}
{isNumericChannelId(alert.source_name) && shopHandle && isUnknown && (
  <div className="mt-2 text-xs text-muted-foreground space-y-1 border-t border-amber-200/50 pt-2">
    <p className="font-medium">❓ We couldn't identify this channel automatically.</p>
    {connectorNote ? (
      <p className="text-xs italic">{connectorNote}</p>
    ) : (
      <p>To find out what it is, check your installed Shopify apps (marketplace connectors like CedCommerce, Codisto, M2E Pro create orders with numeric channel IDs), or open one of these orders in Shopify to check its tags.</p>
    )}
    <div className="flex gap-3 mt-1">
      <a href={`https://admin.shopify.com/store/${shopHandle}/apps`} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
        Search your Shopify apps <ExternalLink className="h-3 w-3" />
      </a>
      <a href={`https://admin.shopify.com/store/${shopHandle}/orders`} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
        View orders in Shopify <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  </div>
)}
{/* Tag-detected confirmation for numeric IDs */}
{isNumericChannelId(alert.source_name) && isTagDetected && (
  <p className="text-xs text-green-600 mt-1">
    ✓ Identified as {alert.detected_label} based on order tags
  </p>
)}
```

The `connectorNote` variable is computed at the top of the map callback: `const connectorNote = getConnectorNote(candidateTags);`

