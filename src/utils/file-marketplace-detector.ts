/**
 * Detects which marketplace a settlement file belongs to based on content/filename signals.
 * Returns null if detection is inconclusive.
 */

export type DetectedMarketplace = 'amazon_au' | 'bunnings' | 'kogan' | 'shopify_payments' | 'shopify_orders' | 'woolworths_marketplus' | 'ebay_au' | null;

/** Sniff a file and return the detected marketplace */
export async function detectFileMarketplace(file: File): Promise<DetectedMarketplace> {
  const name = file.name.toLowerCase();

  // ── Filename-based signals ──
  if (name.includes('bunnings') || name.includes('bun-') || name.includes('summary-of-transactions') || name.includes('billing-cycle-orders')) {
    return 'bunnings';
  }
  if (name.includes('shopify') || name.includes('payout')) {
    return 'shopify_payments';
  }
  if (name.includes('amazon') || name.match(/^\d{10,}\.csv/) || name.match(/flat.*file/i)) {
    return 'amazon_au';
  }
  if (name.includes('ebay') || name.includes('order_proceeds') || name.includes('transaction_report')) {
    return 'ebay_au';
  }

  // ── Content-based signals ──
  try {
    // For text files (TSV/CSV), read first 2KB
    if (!name.endsWith('.pdf')) {
      const slice = file.slice(0, 2048);
      const text = await slice.text();
      const lower = text.toLowerCase();

      // Bunnings Orders CSV — semicolon-delimited with specific headers
      if (lower.includes('invoice number') && lower.includes('order number') && lower.includes('order status') && text.includes(';')) {
        return 'bunnings';
      }

      // Woolworths MarketPlus — has 'order source' AND 'bank payment ref'
      if (lower.includes('order source') && lower.includes('bank payment ref')) {
        return 'woolworths_marketplus';
      }

      // Shopify Orders CSV (gateway clearing) — must check before Shopify Payments
      if (lower.includes('payment method') && lower.includes('financial status') && lower.includes('paid at')) {
        return 'shopify_orders';
      }

      // Shopify Payments CSV signals (transaction-level or payout-level)
      if (lower.includes('payout id') || lower.includes('payout date') ||
          (lower.includes('card brand') && lower.includes('payout')) ||
          (lower.includes('charges') && lower.includes('total') && lower.includes('bank reference')) ||
          (lower.includes('shopify') && (lower.includes('gross') || lower.includes('charges')))) {
        return 'shopify_payments';
      }

      // eBay content signals
      if ((lower.includes('payout id') && lower.includes('net amount')) ||
          (lower.includes('item subtotal') && lower.includes('net proceeds')) ||
          (lower.includes('ebay collected tax') && lower.includes('final value fee'))) {
        return 'ebay_au';
      }

      if (lower.includes('settlement-id') || lower.includes('settlement-start-date') ||
          lower.includes('amzn') || lower.includes('amazon') || lower.includes('fba')) {
        return 'amazon_au';
      }
      if (lower.includes('bunnings') || lower.includes('payable orders')) {
        return 'bunnings';
      }
    }

    // For PDFs, read first bytes for text markers
    if (name.endsWith('.pdf')) {
      const slice = file.slice(0, 8192);
      const buffer = await slice.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const lower = text.toLowerCase();

      if (lower.includes('bunnings') || lower.includes('payable orders') || lower.includes('summary of transactions')) {
        return 'bunnings';
      }
      if (lower.includes('amazon') || lower.includes('amzn') || lower.includes('settlement-id')) {
        return 'amazon_au';
      }

      // PDF on Amazon tab is a strong Bunnings signal (Amazon uses TSV)
      return 'bunnings';
    }
  } catch {
    // Ignore read errors, fall through
  }

  return null;
}

/** Human-readable marketplace labels */
export const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  bunnings: 'Bunnings',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify Orders',
  woolworths_marketplus: 'Woolworths MarketPlus',
  ebay_au: 'eBay AU',
};