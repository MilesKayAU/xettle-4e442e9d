import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lightbulb } from 'lucide-react';
import { useContactClassification } from '@/hooks/use-contact-classification';
import { toast } from 'sonner';

interface ContactClassificationModalProps {
  open: boolean;
  onClose: () => void;
  contactName: string;
  alertId: string;
  onClassified: (alertId: string) => void;
  xeroContactId?: string | null;
}

const EXPENSE_SUBCATEGORIES = [
  'Advertising',
  'Freight & Postage',
  'Parking & Travel',
  'Subscriptions',
  'Bank Fees',
  'Other',
];

interface CommunitySuggestion {
  classification: string;
  category: string | null;
  confidence_pct: number;
}

export default function ContactClassificationModal({
  open,
  onClose,
  contactName,
  alertId,
  onClassified,
  xeroContactId,
}: ContactClassificationModalProps) {
  const [classification, setClassification] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<CommunitySuggestion | null>(null);
  const { getCommunitySuggestion, saveClassification } = useContactClassification();

  useEffect(() => {
    if (!open || !contactName) return;
    setClassification('');
    setCategory('');
    setSuggestion(null);

    getCommunitySuggestion(contactName).then(s => {
      if (s) setSuggestion(s);
    });
  }, [open, contactName]);

  const handleSave = async () => {
    if (!classification) {
      toast.error('Please select a classification');
      return;
    }
    if (classification === 'business_expense' && !category) {
      toast.error('Please select a subcategory');
      return;
    }

    setSaving(true);
    try {
      await saveClassification(
        contactName,
        classification,
        classification === 'business_expense' ? category : classification,
        xeroContactId,
      );
      onClassified(alertId);
      toast.success(`"${contactName}" classified — thank you!`);
      onClose();
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const formatSuggestionLabel = (s: CommunitySuggestion) => {
    const cls = s.classification === 'business_expense' ? 'Business Expense' :
      s.classification === 'personal' ? 'Personal' : s.classification;
    return s.category && s.category !== s.classification
      ? `${cls} → ${s.category}`
      : cls;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What is "{contactName}"?</DialogTitle>
          <DialogDescription>
            Help us categorise this for your accounts — your answer improves suggestions for all Xettle users.
          </DialogDescription>
        </DialogHeader>

        {/* Community suggestion */}
        {suggestion && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5">
            <Lightbulb className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              💡 {suggestion.confidence_pct}% of Xettle users classified this as{' '}
              <span className="font-semibold">{formatSuggestionLabel(suggestion)}</span>
            </p>
          </div>
        )}

        <RadioGroup value={classification} onValueChange={(v) => { setClassification(v); if (v !== 'business_expense') setCategory(''); }}>
          {/* Business Expense */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="business_expense" id="cls-expense" />
              <Label htmlFor="cls-expense" className="font-medium cursor-pointer">Business Expense</Label>
            </div>
            {classification === 'business_expense' && (
              <div className="ml-6">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select subcategory..." />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_SUBCATEGORIES.map(sub => (
                      <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Personal */}
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="personal" id="cls-personal" />
            <Label htmlFor="cls-personal" className="font-medium cursor-pointer">Personal — ignore this contact</Label>
          </div>

          {/* Already set up */}
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="already_setup" id="cls-already" />
            <Label htmlFor="cls-already" className="font-medium cursor-pointer">Already set up elsewhere — ignore</Label>
          </div>
        </RadioGroup>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose}>Skip for now</Button>
          <Button onClick={handleSave} disabled={saving || !classification}>
            {saving ? 'Saving...' : 'Save & dismiss'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
