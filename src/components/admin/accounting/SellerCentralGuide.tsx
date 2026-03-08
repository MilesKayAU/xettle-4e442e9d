import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle, ExternalLink, Download, ArrowRight, Monitor } from 'lucide-react';

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
          <div className="mt-4 space-y-6">

            {/* Step 1 — Navigate */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">1</span>
                <p className="text-sm font-medium">
                  Open Amazon Seller Central
                </p>
              </div>
              <div className="ml-8">
                {/* Mock navigation breadcrumb */}
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Navigate to:</p>
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

            {/* Step 2 — Find settlement */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
                <p className="text-sm font-medium">
                  Find the settlement period and click <strong>"Download Flat File V2"</strong>
                </p>
              </div>
              <div className="ml-8">
                {/* Mock statement table */}
                <div className="rounded-lg border border-border bg-background overflow-hidden">
                  <div className="px-3 py-2 bg-muted/50 border-b">
                    <p className="text-xs font-medium text-muted-foreground">All Statements</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Statement period</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Sales</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Expenses</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Payout</th>
                          <th className="text-center px-3 py-1.5 font-medium text-muted-foreground">Download</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b bg-muted/10">
                          <td className="px-3 py-2 text-muted-foreground italic">Current period</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-center text-[10px] text-muted-foreground italic">After settlement close</td>
                        </tr>
                        <tr className="border-b">
                          <td className="px-3 py-2 font-mono">DD/MM — DD/MM/YYYY</td>
                          <td className="px-3 py-2 text-right font-mono">$X,XXX</td>
                          <td className="px-3 py-2 text-right font-mono">-$X,XXX</td>
                          <td className="px-3 py-2 text-right font-mono font-medium">$X,XXX</td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-[10px] font-medium">
                              <Download className="h-2.5 w-2.5" /> Download Flat File V2
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 font-mono text-muted-foreground">DD/MM — DD/MM/YYYY</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">$X,XXX</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">-$X,XXX</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">$X,XXX</td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted text-muted-foreground text-[10px]">
                              <Download className="h-2.5 w-2.5" /> Download Flat File V2
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 border-t flex items-start gap-2">
                    <Monitor className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-[10px] text-muted-foreground">
                      Each row is one settlement period (usually every 2 weeks). Download the <strong>Flat File V2</strong> — this is the TSV file Xettle processes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 — Upload */}
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
