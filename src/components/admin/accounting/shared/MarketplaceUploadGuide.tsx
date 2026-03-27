/**
 * MarketplaceUploadGuide — Unified per-marketplace upload guidance.
 * Replaces the eBay-only EbayUploadGuide with a config-driven component
 * that tells users exactly what files each marketplace needs and where to get them.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, HelpCircle, ExternalLink, ArrowRight, FileText, FileSpreadsheet, File } from 'lucide-react';

interface FileRequirement {
  type: string; // 'CSV' | 'TSV' | 'PDF' | 'XLSX'
  label: string;
  required: boolean;
  icon: 'csv' | 'pdf' | 'tsv' | 'xlsx';
}

interface MarketplaceGuideConfig {
  files: FileRequirement[];
  summary: string; // One-line "Kogan needs: CSV + PDF"
  note?: string;
  portalUrl?: string;
  portalLabel?: string;
  steps: { title: string; detail?: string }[];
  tips?: string[];
}

const FILE_ICONS = {
  csv: FileSpreadsheet,
  tsv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  pdf: FileText,
};

const MARKETPLACE_GUIDES: Record<string, MarketplaceGuideConfig> = {
  kogan: {
    files: [
      { type: 'CSV', label: 'Payout report', required: true, icon: 'csv' },
      { type: 'PDF', label: 'Remittance advice', required: true, icon: 'pdf' },
    ],
    summary: 'CSV (payout report) + PDF (remittance advice)',
    note: 'Both files are needed per settlement period. The CSV has the financials; the PDF confirms the payout total.',
    portalUrl: 'https://sellercentre.kogan.com',
    portalLabel: 'Kogan Seller Centre',
    steps: [
      { title: 'Log in to Kogan Seller Centre' },
      { title: 'Go to Payments → Payout History' },
      { title: 'Download the CSV report for the payout period' },
      { title: 'Download the matching PDF remittance advice' },
      { title: 'Upload both files to Xettle' },
    ],
    tips: [
      'The CSV and PDF must be for the same payout period — Xettle pairs them automatically',
      'If you only upload the CSV, the settlement will save but show as "missing PDF"',
    ],
  },
  amazon_au: {
    files: [
      { type: 'TSV', label: 'Settlement report', required: true, icon: 'tsv' },
    ],
    summary: 'TSV or CSV (settlement report)',
    note: 'One file per settlement period. Amazon generates these every 2 weeks.',
    portalUrl: 'https://sellercentral.amazon.com.au/payments/reports/settlement',
    portalLabel: 'Amazon Seller Central — Settlements',
    steps: [
      { title: 'Log in to Amazon Seller Central' },
      { title: 'Go to Reports → Payments → Settlement Reports', detail: 'Or use the Date Range Reports tab for custom periods' },
      { title: 'Click Download for the settlement period you need' },
      { title: 'Upload the downloaded file to Xettle' },
    ],
    tips: [
      'Amazon settlements cover a ~14-day period',
      'Both TSV and CSV formats are supported',
    ],
  },
  ebay_au: {
    files: [
      { type: 'CSV', label: 'Transaction report', required: true, icon: 'csv' },
    ],
    summary: 'CSV (transaction report)',
    note: 'The Transaction Report groups data by Payout ID — this maps directly to your bank deposits.',
    portalUrl: 'https://www.ebay.com.au/sh/fin/reports',
    portalLabel: 'eBay Seller Hub — Reports',
    steps: [
      { title: 'In Seller Hub, go to Payments → Reports' },
      { title: 'Select "Transaction Report" and choose your date range' },
      { title: 'Click "Generate CSV" and download the file' },
      { title: 'Upload the downloaded CSV to Xettle' },
    ],
    tips: [
      'The Transaction Report is preferred — it includes Payout ID for bank matching',
      'You can also use the Earnings tab → Order Proceeds CSV as an alternative',
      'Download reports for completed payouts only — pending payouts may change',
    ],
  },
  bunnings: {
    files: [
      { type: 'PDF', label: 'Billing cycle summary', required: true, icon: 'pdf' },
    ],
    summary: 'PDF (billing cycle summary)',
    note: 'Bunnings uses Mirakl — download the billing cycle PDF from your seller portal.',
    portalUrl: undefined,
    portalLabel: 'Mirakl Seller Portal',
    steps: [
      { title: 'Log in to your Mirakl seller portal' },
      { title: 'Go to Accounting → Billing Cycles' },
      { title: 'Download the PDF summary for the billing cycle' },
      { title: 'Upload the PDF to Xettle' },
    ],
    tips: [
      'Bunnings typically pays every 2 weeks via Mirakl',
      'The PDF contains the commission breakdown and net payout amount',
    ],
  },
  shopify_payments: {
    files: [
      { type: 'CSV', label: 'Payout export', required: true, icon: 'csv' },
    ],
    summary: 'CSV (payout export)',
    note: 'One CSV per payout or date range from Shopify Finances.',
    portalUrl: 'https://admin.shopify.com/finances/payouts',
    portalLabel: 'Shopify Admin — Payouts',
    steps: [
      { title: 'Go to Shopify Admin → Finances → Payouts' },
      { title: 'Click Export and select the date range' },
      { title: 'Choose "Transactions" export format' },
      { title: 'Upload the downloaded CSV to Xettle' },
    ],
    tips: [
      'If you have Shopify API connected, settlements sync automatically',
      'Manual CSV upload is useful for historical data or cross-checking',
    ],
  },
  woolworths_marketplus: {
    files: [
      { type: 'CSV', label: 'MarketPlus payment report', required: true, icon: 'csv' },
    ],
    summary: 'CSV (MarketPlus payment report)',
    note: 'Download from the Woolworths MarketPlus seller portal.',
    steps: [
      { title: 'Log in to the Woolworths MarketPlus portal' },
      { title: 'Go to Payments or Reports section' },
      { title: 'Download the payment CSV for the period' },
      { title: 'Upload the CSV to Xettle' },
    ],
    tips: [
      'Each CSV covers one payment group — upload separately',
    ],
  },
  catch_au: {
    files: [
      { type: 'CSV', label: 'Settlement report', required: true, icon: 'csv' },
    ],
    summary: 'CSV (settlement report)',
    steps: [
      { title: 'Log in to your Catch seller portal' },
      { title: 'Download the settlement CSV for the period' },
      { title: 'Upload the CSV to Xettle' },
    ],
  },
  mydeal: {
    files: [
      { type: 'CSV', label: 'Settlement report', required: true, icon: 'csv' },
    ],
    summary: 'CSV (settlement report)',
    steps: [
      { title: 'Log in to your MyDeal seller portal' },
      { title: 'Download the settlement CSV for the period' },
      { title: 'Upload the CSV to Xettle' },
    ],
  },
};

// Fallback for unknown marketplaces
const DEFAULT_GUIDE: MarketplaceGuideConfig = {
  files: [
    { type: 'CSV', label: 'Settlement or payout report', required: true, icon: 'csv' },
  ],
  summary: 'CSV or PDF (settlement/payout report)',
  note: 'Upload your marketplace settlement file — Xettle will auto-detect the format.',
  steps: [
    { title: 'Download your settlement or payout report from the marketplace portal' },
    { title: 'Upload the file to Xettle — format is detected automatically' },
  ],
};

interface MarketplaceUploadGuideProps {
  marketplaceCode: string;
  marketplaceName: string;
  /** Start collapsed? Default true */
  defaultCollapsed?: boolean;
}

export default function MarketplaceUploadGuide({ marketplaceCode, marketplaceName, defaultCollapsed = true }: MarketplaceUploadGuideProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const guide = MARKETPLACE_GUIDES[marketplaceCode] || DEFAULT_GUIDE;

  return (
    <Card className="border border-border bg-muted/30">
      <CardContent className="py-3 px-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <HelpCircle className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium">
                What files does {marketplaceName} need?
              </span>
              {!expanded && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {guide.summary}
                </span>
              )}
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4">
            {/* File requirements badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Required files:</span>
              {guide.files.map((f, i) => {
                const Icon = FILE_ICONS[f.icon] || File;
                return (
                  <Badge key={i} variant="outline" className="gap-1.5 text-xs font-medium px-2.5 py-1">
                    <Icon className="h-3 w-3" />
                    {f.type} — {f.label}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </Badge>
                );
              })}
            </div>

            {guide.note && (
              <p className="text-xs text-muted-foreground ml-0.5">{guide.note}</p>
            )}

            {/* Steps */}
            <div className="space-y-2.5">
              {guide.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{step.title}</p>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Tips */}
            {guide.tips && guide.tips.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                <p className="text-xs font-medium">💡 Tips</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  {guide.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Portal link */}
            {guide.portalUrl && (
              <div>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                  <a href={guide.portalUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    Open {guide.portalLabel || `${marketplaceName} Portal`}
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
