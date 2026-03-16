/**
 * BackfillHorizonSelector — Lets users pick how far back to look for settlement coverage.
 * Persists selection to app_settings.onboarding_horizon_days.
 */

import { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Calendar, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface BackfillHorizonSelectorProps {
  onSelect: (days: number) => void;
  defaultDays?: number;
}

const HORIZON_OPTIONS = [
  { value: '14', label: '14 days', description: 'Quick — just the last two weeks' },
  { value: '45', label: '45 days', description: 'Recommended — covers most billing cycles' },
  { value: '90', label: '90 days', description: 'Deep — full quarter lookback' },
];

export default function BackfillHorizonSelector({ onSelect, defaultDays = 45 }: BackfillHorizonSelectorProps) {
  const [selected, setSelected] = useState(String(defaultDays));

  const handleChange = async (value: string) => {
    setSelected(value);
    const days = parseInt(value, 10);
    onSelect(days);
    // Persist
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('app_settings').upsert(
          { user_id: user.id, key: 'onboarding_horizon_days', value },
          { onConflict: 'user_id,key' }
        );
      }
    } catch { /* silent */ }
  };

  const handleCurrentMonth = async () => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    setSelected(String(dayOfMonth));
    onSelect(dayOfMonth);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('app_settings').upsert(
          { user_id: user.id, key: 'onboarding_horizon_days', value: String(dayOfMonth) },
          { onConflict: 'user_id,key' }
        );
      }
    } catch { /* silent */ }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">How far back should we check?</h3>
      </div>

      <RadioGroup value={selected} onValueChange={handleChange} className="space-y-2">
        {HORIZON_OPTIONS.map(opt => (
          <div key={opt.value} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-accent/50 transition-colors">
            <RadioGroupItem value={opt.value} id={`horizon-${opt.value}`} />
            <Label htmlFor={`horizon-${opt.value}`} className="flex-1 cursor-pointer">
              <span className="text-sm font-medium text-foreground">{opt.label}</span>
              <span className="text-xs text-muted-foreground ml-2">{opt.description}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>

      <Button
        variant="outline"
        size="sm"
        onClick={handleCurrentMonth}
        className="w-full text-xs"
      >
        <Zap className="h-3 w-3 mr-1" />
        Just get current month done
      </Button>
    </div>
  );
}
