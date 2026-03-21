/**
 * Amazon SP-API marketplace regions and IDs.
 *
 * When a user connects via OAuth or manual token entry, they must select
 * their Amazon marketplace. This replaces the previously hardcoded
 * AU-only marketplace ID (A39IBJ37TRP1C6) and region ('fe').
 *
 * Reference: https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
 */

export interface AmazonRegion {
  /** SP-API marketplace ID */
  marketplaceId: string;
  /** SP-API region code */
  region: 'na' | 'eu' | 'fe';
  /** Display label */
  label: string;
  /** Country flag emoji */
  flag: string;
  /** Marketplace code used in Xettle's internal systems */
  xettleCode: string;
  /** Seller Central domain for deep-linking to order pages */
  sellerCentralDomain: string;
}

export const AMAZON_REGIONS: AmazonRegion[] = [
  { marketplaceId: 'A39IBJ37TRP1C6', region: 'fe', label: 'Amazon Australia', flag: '🇦🇺', xettleCode: 'amazon_au', sellerCentralDomain: 'sellercentral.amazon.com.au' },
  { marketplaceId: 'ATVPDKIKX0DER',  region: 'na', label: 'Amazon United States', flag: '🇺🇸', xettleCode: 'amazon_us', sellerCentralDomain: 'sellercentral.amazon.com' },
  { marketplaceId: 'A2EUQ1WTGCTBG2', region: 'na', label: 'Amazon Canada', flag: '🇨🇦', xettleCode: 'amazon_ca', sellerCentralDomain: 'sellercentral.amazon.ca' },
  { marketplaceId: 'A1F83G8C2ARO7P', region: 'eu', label: 'Amazon United Kingdom', flag: '🇬🇧', xettleCode: 'amazon_uk', sellerCentralDomain: 'sellercentral.amazon.co.uk' },
  { marketplaceId: 'A1PA6795UKMFR9', region: 'eu', label: 'Amazon Germany', flag: '🇩🇪', xettleCode: 'amazon_de', sellerCentralDomain: 'sellercentral.amazon.de' },
  { marketplaceId: 'A1VC38T7YXB528', region: 'fe', label: 'Amazon Japan', flag: '🇯🇵', xettleCode: 'amazon_jp', sellerCentralDomain: 'sellercentral.amazon.co.jp' },
  { marketplaceId: 'A21TJRUUN4KGV',  region: 'fe', label: 'Amazon Singapore', flag: '🇸🇬', xettleCode: 'amazon_sg', sellerCentralDomain: 'sellercentral.amazon.sg' },
  { marketplaceId: 'A1805IZSGTT6HS', region: 'eu', label: 'Amazon Netherlands', flag: '🇳🇱', xettleCode: 'amazon_nl', sellerCentralDomain: 'sellercentral.amazon.nl' },
  { marketplaceId: 'A13V1IB3VIYBER', region: 'eu', label: 'Amazon France', flag: '🇫🇷', xettleCode: 'amazon_fr', sellerCentralDomain: 'sellercentral.amazon.fr' },
];

/** Default region (AU) for backward compatibility */
export const DEFAULT_AMAZON_REGION = AMAZON_REGIONS[0];

/** Look up a region definition by its SP-API marketplace ID */
export function getAmazonRegionByMarketplaceId(marketplaceId: string): AmazonRegion | undefined {
  return AMAZON_REGIONS.find(r => r.marketplaceId === marketplaceId);
}

/** Get display label for a marketplace ID */
export function getAmazonRegionLabel(marketplaceId: string): string {
  const region = getAmazonRegionByMarketplaceId(marketplaceId);
  return region ? `${region.flag} ${region.label}` : marketplaceId;
}
