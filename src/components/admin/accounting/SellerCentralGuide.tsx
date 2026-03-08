import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle, ExternalLink } from 'lucide-react';
import sellerCentralNav from '@/assets/seller-central-nav.png';
import sellerCentralReports from '@/assets/seller-central-reports.png';

export default function SellerCentralGuide() {
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
            <span className="text-sm font-medium">Where do I find my settlement report in Seller Central?</span>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="mt-4 space-y-5">
            {/* Step 1 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">1</span>
                <p className="text-sm font-medium">
                  Go to <strong>Payments</strong> → <strong>Reports Repository</strong>
                </p>
              </div>
              <div className="rounded-lg overflow-hidden border border-border ml-8">
                <img
                  src={sellerCentralNav}
                  alt="Amazon Seller Central navigation showing Payments menu with Reports Repository option"
                  className="w-full max-w-sm"
                  loading="lazy"
                />
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
                <p className="text-sm font-medium">
                  Select <strong>Transaction View</strong> tab, choose your date range, and click <strong>Request Report</strong>
                </p>
              </div>
              <div className="rounded-lg overflow-hidden border border-border ml-8">
                <img
                  src={sellerCentralReports}
                  alt="Amazon Seller Central Reports Repository showing Transaction View with date range selector and Download CSV button"
                  className="w-full"
                  loading="lazy"
                />
              </div>
            </div>

            {/* Step 3 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">3</span>
                <p className="text-sm font-medium">
                  Once ready, click <strong>Download CSV</strong> — then upload the file above
                </p>
              </div>
              <p className="text-xs text-muted-foreground ml-8">
                The downloaded file is a TSV (tab-separated) file. Xettle handles both .csv and .tsv formats automatically.
              </p>
            </div>

            {/* Quick link */}
            <div className="ml-8">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                <a href="https://sellercentral.amazon.com.au/payments/reports-repository" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  Open Seller Central Reports
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
