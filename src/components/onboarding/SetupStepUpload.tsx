import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  selectedMarketplaces: string[];
}

const MARKETPLACE_LABELS: Record<string, string> = {
  bunnings: 'Bunnings',
  bigw: 'BigW',
  kogan: 'Kogan',
  catch: 'Catch',
  mydeal: 'MyDeal',
  everyday_market: 'Everyday Market',
  ebay: 'eBay',
};

export default function SetupStepUpload({ onNext, onSkip, selectedMarketplaces }: Props) {
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeMarketplace, setActiveMarketplace] = useState<string | null>(null);

  // Filter to CSV-only marketplaces (not amazon/shopify which use API)
  const csvMarketplaces = selectedMarketplaces.filter(m => !['amazon', 'shopify'].includes(m));

  const handleFileSelect = (marketplace: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const existing = uploadedFiles[marketplace] || [];
    setUploadedFiles({
      ...uploadedFiles,
      [marketplace]: [...existing, ...Array.from(files)],
    });
    toast.success(`${files.length} file${files.length > 1 ? 's' : ''} added for ${getLabel(marketplace)}`);
  };

  const removeFile = (marketplace: string, index: number) => {
    const files = [...(uploadedFiles[marketplace] || [])];
    files.splice(index, 1);
    setUploadedFiles({ ...uploadedFiles, [marketplace]: files });
  };

  const getLabel = (code: string) =>
    MARKETPLACE_LABELS[code] || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const totalFiles = Object.values(uploadedFiles).reduce((sum, files) => sum + files.length, 0);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Upload your settlement files</h2>
        <p className="text-sm text-muted-foreground">
          Drop in any CSV or PDF files you have. Don't worry about format — Xettle will figure it out.
        </p>
      </div>

      <div className="space-y-3">
        {csvMarketplaces.map((marketplace) => {
          const files = uploadedFiles[marketplace] || [];
          return (
            <Card key={marketplace} className="border-border">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {files.length > 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-sm text-foreground">{getLabel(marketplace)}</span>
                    {files.length > 0 && (
                      <span className="text-xs text-muted-foreground">({files.length} file{files.length > 1 ? 's' : ''})</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setActiveMarketplace(marketplace);
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="h-3 w-3 mr-1" /> Add Files
                  </Button>
                </div>

                {files.length > 0 && (
                  <div className="space-y-1">
                    {files.map((file, i) => (
                      <div key={i} className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <button onClick={() => removeFile(marketplace, i)} className="hover:text-foreground ml-2">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {csvMarketplaces.length === 0 && (
          <Card className="border-dashed border-2 border-border">
            <CardContent className="p-6 text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No CSV marketplaces selected. You can upload files from the dashboard later.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,.txt,.pdf,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          if (activeMarketplace) {
            handleFileSelect(activeMarketplace, e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        <Button onClick={onNext} className="w-full">
          {totalFiles > 0 ? `Continue with ${totalFiles} file${totalFiles > 1 ? 's' : ''}` : 'Continue'}
        </Button>
        <button
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          I'll upload later →
        </button>
      </div>
    </div>
  );
}
