import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Upload, FileText, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';

interface GenericMarketplaceDashboardProps {
  marketplace: UserMarketplace;
}

export default function GenericMarketplaceDashboard({ marketplace }: GenericMarketplaceDashboardProps) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      toast.info(`${f.name} selected — parser for ${def?.name || 'this marketplace'} is coming soon.`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">{def?.icon || '📋'}</span>
          {def?.name || marketplace.marketplace_name} Settlements
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload settlement data, reconcile, and sync to Xero.
        </p>
      </div>

      {/* Early access notice */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                {def?.name} — Early Access
              </p>
              <p className="text-xs text-muted-foreground">
                Settlement parsing for {def?.name} is being built. Upload your CSV files now and we'll notify you when automatic parsing is available. 
                Your uploaded files will be processed retroactively.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CSV Upload */}
      <Card className={`border-2 transition-colors ${file ? 'border-green-400 bg-green-50/30' : 'border-dashed border-muted-foreground/25 hover:border-primary/40'}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Settlement Report (CSV)
            {file && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
          </CardTitle>
          <CardDescription className="text-xs">
            Upload your {def?.name} settlement or payout report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            onChange={handleUpload}
            className="block w-full text-sm text-muted-foreground
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-medium
              file:bg-primary file:text-primary-foreground
              hover:file:opacity-90 file:cursor-pointer"
          />
          {file && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-green-700 font-medium">
                ✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Coming soon features */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="opacity-60">
          <CardContent className="py-6 text-center space-y-2">
            <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground">Auto-Parse</p>
            <p className="text-xs text-muted-foreground">Automatic parsing of {def?.name} settlement data — coming soon.</p>
            <Badge variant="outline" className="text-xs">Coming Soon</Badge>
          </CardContent>
        </Card>
        <Card className="opacity-60">
          <CardContent className="py-6 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground">Xero Sync</p>
            <p className="text-xs text-muted-foreground">Push {def?.name} settlements to Xero — coming soon.</p>
            <Badge variant="outline" className="text-xs">Coming Soon</Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
