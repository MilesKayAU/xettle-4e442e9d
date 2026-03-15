import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle, ExternalLink, ArrowRight } from 'lucide-react';

export default function EbayUploadGuide() {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="border border-border bg-muted/30">
      <CardContent className="py-3 px-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-sm font-medium">How do I download my payout report from eBay?</span>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="mt-4 space-y-5">

            {/* Recommended: Transaction Report */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">1</span>
                <p className="text-sm font-medium">
                  In Seller Hub, go to <strong>Payments</strong> → <strong>Reports</strong>
                </p>
              </div>
              <div className="ml-8">
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-1 bg-muted rounded font-medium">Payments</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="px-2 py-1 bg-primary/10 text-primary rounded font-medium border border-primary/20">
                      Reports
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
                <p className="text-sm font-medium">
                  Select <strong>"Transaction Report"</strong> and choose your date range
                </p>
              </div>
              <p className="text-xs text-muted-foreground ml-8">
                The Transaction Report groups data by Payout ID — this maps directly to your bank deposits and is ideal for settlement reconciliation.
              </p>
            </div>

            {/* Step 3 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">3</span>
                <p className="text-sm font-medium">
                  Click <strong>"Generate CSV"</strong> and download the file
                </p>
              </div>
              <p className="text-xs text-muted-foreground ml-8">
                Upload the downloaded CSV above. Xettle will automatically detect the eBay format and parse your settlements.
              </p>
            </div>

            {/* Alternative */}
            <div className="ml-8 rounded-lg border border-border bg-background p-3 space-y-2">
              <p className="text-xs font-medium">📋 Alternative: Order Proceeds Report</p>
              <p className="text-xs text-muted-foreground">
                You can also use the <strong>Earnings</strong> tab → download <strong>Order Proceeds</strong> CSV. This is order-level data (not grouped by payout), but Xettle can process it too.
              </p>
            </div>

            {/* Tips */}
            <div className="ml-8 rounded-lg border border-border bg-background p-3 space-y-2">
              <p className="text-xs font-medium">💡 Tips</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>The <strong>Transaction Report</strong> is preferred — it includes Payout ID for bank matching</li>
                <li>Download reports for <strong>completed payouts</strong> only — pending payouts may change</li>
                <li>eBay typically pays out weekly or bi-weekly depending on your account settings</li>
                <li>If you sell in multiple eBay regions, download a report for each marketplace</li>
              </ul>
            </div>

            {/* Quick link */}
            <div className="ml-8">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                <a href="https://www.ebay.com.au/sh/fin/reports" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  Open eBay Seller Hub — Reports
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
