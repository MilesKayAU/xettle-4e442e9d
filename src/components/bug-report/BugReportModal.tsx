import { useState, useRef, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Upload, X, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  getErrors: () => any[];
  userEmail: string;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export default function BugReportModal({ open, onClose, getErrors, userEmail }: Props) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<string>('medium');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setScreenshot(reader.result as string);
        reader.readAsDataURL(file);
        break;
      }
    }
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScreenshot(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const consoleErrors = getErrors();
      const pageUrl = window.location.href;

      // Insert the bug report
      const { data: inserted, error: insertError } = await supabase
        .from('bug_reports' as any)
        .insert({
          submitted_by: user.id,
          page_url: pageUrl,
          description: description.trim(),
          screenshot_base64: screenshot,
          console_errors: consoleErrors,
          severity,
        } as any)
        .select('id')
        .single();

      if (insertError) throw insertError;

      const bugId = (inserted as any)?.id;

      toast({ title: '🐛 Bug Report Submitted', description: 'AI is analysing your report...' });

      // Reset form and close
      setDescription('');
      setSeverity('medium');
      setScreenshot(null);
      onClose();

      // Fire-and-forget AI triage
      supabase.functions.invoke('ai-bug-triage', {
        body: {
          bug_report_id: bugId,
          description: description.trim(),
          page_url: pageUrl,
          console_errors: consoleErrors,
        },
      }).then(({ data, error }) => {
        if (error) {
          console.error('AI triage failed:', error);
          return;
        }
        const complexity = data?.complexity || 'Unknown';
        toast({
          title: '🤖 AI Triage Complete',
          description: `Classified as ${data?.classification || 'unknown'} — ${complexity}`,
        });
      });
    } catch (err: any) {
      console.error('Bug report submission failed:', err);
      toast({ title: 'Error', description: err.message || 'Failed to submit bug report', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle>🐛 Report an Issue</DialogTitle>
          <DialogDescription>
            Describe what went wrong. Screenshots and console errors are captured automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Auto-captured info */}
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-md p-2">
            <p><strong>Page:</strong> {window.location.pathname}</p>
            <p><strong>User:</strong> {userEmail}</p>
            <p><strong>Console errors:</strong> {getErrors().length} captured</p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="bug-description">Describe the issue *</Label>
            <Textarea
              id="bug-description"
              placeholder="What happened? What did you expect to happen?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          {/* Screenshot */}
          <div className="space-y-2">
            <Label>Screenshot (Ctrl+V to paste, or upload)</Label>
            {screenshot ? (
              <div className="relative">
                <img src={screenshot} alt="Screenshot" className="max-h-40 rounded border border-border" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={() => setScreenshot(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload Screenshot
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Severity */}
          <div className="space-y-2">
            <Label>Severity</Label>
            <RadioGroup value={severity} onValueChange={setSeverity} className="flex gap-3">
              {SEVERITIES.map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <RadioGroupItem value={s} id={`sev-${s}`} />
                  <Label htmlFor={`sev-${s}`} className="text-sm capitalize cursor-pointer">{s}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !description.trim()}>
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
