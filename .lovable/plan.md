

## Restructure Marketplace Step: Shopify → Amazon → CSV as Sequential Cards

### Current State
All marketplaces (API + CSV) are shown simultaneously on one screen. User is overwhelmed with choices.

### New Design
Three sequential cards, each getting full focus. User flows through them one at a time:

**Card 1 — Shopify** (full card with benefit text, domain input inline)
- "Connect" or "Skip — I don't use Shopify" link
- On connect or skip → advance to Card 2

**Card 2 — Amazon** (full card with benefit text)
- "Connect" or "Skip — I don't use Amazon" link  
- On connect or skip → advance to Card 3

**Card 3 — CSV Marketplaces** (toggle grid as today)
- Shows Bunnings, BigW, Kogan, Catch, MyDeal, Everyday Market, eBay
- Custom marketplace input
- "Continue" button (or "Skip — I'll upload files manually")

If already connected (e.g. returning from OAuth), that card auto-advances to the next.

### File: `src/components/onboarding/SetupStepConnectStores.tsx`

- Add `step` state: `1 | 2 | 3`
- Auto-advance: if `hasShopify` → start at step 2; if `hasShopify && hasAmazon` → start at step 3
- Each step renders a single focused card with clear CTA and skip link
- Shopify domain input shown inline on Card 1 (no separate toggle)
- Card 3 keeps existing CSV grid + custom marketplace logic
- Footer "Continue" only shows on Card 3; Cards 1-2 have "Connect" + "Skip" actions
- Breadcrumb dots (●○○) at top showing progress through the 3 cards

