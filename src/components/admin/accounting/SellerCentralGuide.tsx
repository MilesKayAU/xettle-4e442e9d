import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle, ExternalLink, ArrowRight } from 'lucide-react';
import sellerCentralStatements from '@/assets/seller-central-statements.png';

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
            <span className="text-sm font-medium">How do I download my settlement report from Amazon?</span>
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
                  In Seller Central, go to <strong>Payments</strong> → <strong>All Statements</strong>
                </p>
              </div>
              <div className="ml-8">
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-1 bg-muted rounded font-medium">Payments</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="px-2 py-1 bg-primary/10 text-primary rounded font-medium border border-primary/20">
                      All Statements
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 — Screenshot */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
                <p className="text-sm font-medium">
                  Find a closed settlement and click <strong>"Download Flat File V2"</strong>
                </p>
              </div>
              <div className="ml-8 rounded-lg overflow-hidden border border-border">
                <img
                  src={sellerCentralStatements}
                  alt="Amazon Seller Central All Statements page showing the Download Flat File V2 button circled"
                  className="w-full"
                  loading="lazy"
                />
              </div>
              <p className="text-xs text-muted-foreground ml-8">
                Each row is one settlement period (usually every 2 weeks). The current open period shows "Available after settlement close".
              </p>
            </div>

            {/* Step 3 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">3</span>
                <p className="text-sm font-medium">
                  Upload the downloaded file above
                </p>
              </div>
              <p className="text-xs text-muted-foreground ml-8">
                Upload one file at a time, or select multiple files for bulk processing. Xettle handles both .csv and .tsv formats automatically.
              </p>
            </div>

            {/* Tips */}
            <div className="ml-8 rounded-lg border border-border bg-background p-3 space-y-2">
              <p className="text-xs font-medium">💡 Tips</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Download <strong>all closed settlements</strong> — upload oldest first for best tracking</li>
                <li>Settlements spanning two months are automatically split by Xettle</li>
                <li>The current (open) period can't be downloaded until Amazon closes it</li>
                <li>Use <strong>bulk upload</strong> to process multiple settlements at once</li>
              </ul>
            </div>

            {/* Quick link */}
            <div className="ml-8">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                <a href="https://sellercentral.amazon.com.au/payments/event/view?type=allStatements" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  Open Seller Central — All Statements
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
