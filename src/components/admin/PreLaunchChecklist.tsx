import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ChecklistItem {
  key: string;
  label: string;
  check: () => Promise<boolean>;
}

export default function PreLaunchChecklist() {
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const items: ChecklistItem[] = [
    {
      key: 'email_domain',
      label: 'Custom email domain configured',
      check: async () => false, // Will be true when email domain is set up
    },
    {
      key: 'email_confirmation',
      label: 'Confirmation email branded as Xettle',
      check: async () => {
        return true; // Auth email hook with branded Xettle templates is deployed

      },
    },
    {
      key: 'email_reset',
      label: 'Password reset email branded as Xettle',
      check: async () => false,
    },
    {
      key: 'stripe_billing',
      label: 'Stripe billing connected',
      check: async () => false,
    },
    {
      key: 'auto_push_live',
      label: 'auto_push_live_mode enabled',
      check: async () => {
        try {
          const { data } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'auto_push_live_mode')
            .maybeSingle();
          return data?.value === 'true';
        } catch { return false; }
      },
    },
    {
      key: 'bookkeeper_account',
      label: 'Bookkeeper account created and tested',
      check: async () => {
        try {
          const { count } = await supabase
            .from('user_roles')
            .select('id', { count: 'exact', head: true })
            .neq('role', 'admin' as any);
          return (count || 0) > 0;
        } catch { return false; }
      },
    },
  ];

  useEffect(() => {
    const runChecks = async () => {
      setLoading(true);
      const r: Record<string, boolean> = {};
      for (const item of items) {
        try {
          r[item.key] = await item.check();
        } catch {
          r[item.key] = false;
        }
      }
      setResults(r);
      setLoading(false);
    };
    runChecks();
  }, []);

  const completedCount = Object.values(results).filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pre-Launch Checklist</CardTitle>
        <p className="text-xs text-muted-foreground">
          {completedCount}/{items.length} complete
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map(item => {
            const done = results[item.key];
            return (
              <div key={item.key} className="flex items-center gap-2 text-sm">
                {loading ? (
                  <Circle className="h-4 w-4 text-muted-foreground animate-pulse" />
                ) : done ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={done ? 'text-foreground' : 'text-muted-foreground'}>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
