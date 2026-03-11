import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles, CheckCircle2, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface XeroAccount {
  code: string;
  name: string;
  type: string;
  taxType: string;
  description: string;
}

interface MappingEntry {
  code: string;
  name: string;
}

type MapperState = 'unmapped' | 'scanning' | 'review' | 'confirmed';

const CATEGORIES = [
  'Sales', 'Promotional Discounts', 'Refunds', 'Reimbursements',
  'Seller Fees', 'FBA Fees', 'Storage Fees', 'Other Fees',
] as const;

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'Sales': 'Gross product sales & shipping revenue',
  'Promotional Discounts': 'Vouchers & promotions reducing sale price',
  'Refunds': 'Product & shipping refunds to customers',
  'Reimbursements': 'Marketplace reimbursements (not taxable)',
  'Seller Fees': 'Referral & selling fees charged by marketplace',
  'FBA Fees': 'Fulfilment, pick & pack, delivery fees',
  'Storage Fees': 'Warehouse & inventory storage fees',
  'Other Fees': 'Miscellaneous marketplace charges',
};

export default function AccountMapperCard() {
  const [state, setState] = useState<MapperState>('unmapped');
  const [mapping, setMapping] = useState<Record<string, MappingEntry>>({});
  const [editableMapping, setEditableMapping] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<string>('medium');
  const [notes, setNotes] = useState<string>('');
  const [accounts, setAccounts] = useState<XeroAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Load current state on mount
  useEffect(() => {
    loadCurrentState();
  }, []);

  const loadCurrentState = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if confirmed mapping exists
      const { data: confirmedSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_xero_account_codes')
        .maybeSingle();

      if (confirmedSetting?.value) {
        try {
          const codes = JSON.parse(confirmedSetting.value);
          const restored: Record<string, MappingEntry> = {};
          for (const cat of CATEGORIES) {
            if (codes[cat]) {
              restored[cat] = { code: codes[cat], name: `Account ${codes[cat]}` };
            }
          }
          setMapping(restored);
          setState('confirmed');
        } catch { /* fall through */ }
        setLoading(false);
        return;
      }

      // Check if suggested mapping exists
      const { data: suggestedSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'ai_mapper_suggested_mapping')
        .maybeSingle();

      if (suggestedSetting?.value) {
        try {
          const suggested = JSON.parse(suggestedSetting.value);
          setMapping(suggested.mapping || {});
          setConfidence(suggested.confidence || 'medium');
          setNotes(suggested.notes || '');
          const editable: Record<string, string> = {};
          for (const [cat, entry] of Object.entries(suggested.mapping || {})) {
            editable[cat] = (entry as MappingEntry).code;
          }
          setEditableMapping(editable);
          setState('review');
        } catch { /* fall through */ }
      }
    } catch (e) {
      console.error('Failed to load mapper state:', e);
    } finally {
      setLoading(false);
    }
  };

  const runMapper = useCallback(async () => {
    setState('scanning');
    try {
      const { data, error } = await supabase.functions.invoke('ai-account-mapper', {
        body: { action: 'scan_and_match' },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Mapping failed');

      setMapping(data.mapping || {});
      setConfidence(data.confidence || 'medium');
      setNotes(data.notes || '');
      setAccounts(data.accounts || []);

      const editable: Record<string, string> = {};
      for (const [cat, entry] of Object.entries(data.mapping || {})) {
        editable[cat] = (entry as MappingEntry).code;
      }
      setEditableMapping(editable);
      setState('review');
    } catch (err: any) {
      toast.error(`AI mapper failed: ${err.message}`);
      setState('unmapped');
    }
  }, []);

  const handleConfirm = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build the final codes object
      const finalCodes: Record<string, string> = {};
      for (const cat of CATEGORIES) {
        finalCodes[cat] = editableMapping[cat] || mapping[cat]?.code || '';
      }

      // Save to accounting_xero_account_codes
      const { error } = await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'accounting_xero_account_codes',
        value: JSON.stringify(finalCodes),
      } as any, { onConflict: 'user_id,key' });

      if (error) throw error;

      // Update mapper status
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'ai_mapper_status',
        value: 'confirmed',
      } as any, { onConflict: 'user_id,key' });

      // Update mapping display with potentially edited values
      const updatedMapping: Record<string, MappingEntry> = {};
      for (const cat of CATEGORIES) {
        const code = finalCodes[cat];
        const account = accounts.find(a => a.code === code);
        updatedMapping[cat] = {
          code,
          name: account?.name || mapping[cat]?.name || `Account ${code}`,
        };
      }
      setMapping(updatedMapping);
      setState('confirmed');
      toast.success('Account mapping saved — all Xero pushes will use these codes');
    } catch (err: any) {
      toast.error(`Failed to save mapping: ${err.message}`);
    }
  };

  const confidenceBadge = (level: string) => {
    if (level === 'high') return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">✅ High</Badge>;
    if (level === 'medium') return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">⚠️ Medium</Badge>;
    return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">❌ Low</Badge>;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // ─── UNMAPPED STATE ──────────────────────────────────────────────
  if (state === 'unmapped') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Account Mapper
          </CardTitle>
          <CardDescription>
            Automatically match your Xero chart of accounts to ecommerce settlement categories using AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runMapper} className="gap-2">
            <Sparkles className="h-4 w-4" />
            Auto-detect accounts
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── SCANNING STATE ──────────────────────────────────────────────
  if (state === 'scanning') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            AI Account Mapper
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Reading your Xero chart of accounts...</p>
          <p className="text-xs text-muted-foreground">This takes a few seconds while AI matches your accounts.</p>
        </CardContent>
      </Card>
    );
  }

  // ─── REVIEW STATE ────────────────────────────────────────────────
  if (state === 'review') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Account Mapper
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            Review the AI-suggested mapping below. Override any row you disagree with.
            {confidenceBadge(confidence)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">Category</th>
                  <th className="text-left p-2 font-medium">Suggested Account</th>
                  <th className="text-center p-2 font-medium w-20">Override</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => {
                  const entry = mapping[cat];
                  return (
                    <tr key={cat} className="border-b last:border-b-0">
                      <td className="p-2">
                        <div className="font-medium">{cat}</div>
                        <div className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</div>
                      </td>
                      <td className="p-2">
                        <span className="font-mono text-xs">{entry?.code}</span>
                        <span className="text-muted-foreground ml-1 text-xs">— {entry?.name}</span>
                      </td>
                      <td className="p-2">
                        {accounts.length > 0 ? (
                          <Select
                            value={editableMapping[cat] || entry?.code || ''}
                            onValueChange={(v) => setEditableMapping(prev => ({ ...prev, [cat]: v }))}
                          >
                            <SelectTrigger className="h-7 text-xs w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {accounts.map((a) => (
                                <SelectItem key={a.code} value={a.code} className="text-xs">
                                  {a.code} — {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <input
                            className="h-7 w-20 text-xs border rounded px-1.5 font-mono bg-background"
                            value={editableMapping[cat] || entry?.code || ''}
                            onChange={(e) => setEditableMapping(prev => ({ ...prev, [cat]: e.target.value }))}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {notes && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{notes}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleConfirm} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Confirm & Save
            </Button>
            <Button variant="outline" onClick={runMapper} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Re-run
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── CONFIRMED STATE ─────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          AI Account Mapper
        </CardTitle>
        <CardDescription>
          Account mapping confirmed. All Xero pushes use these codes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {CATEGORIES.map((cat) => {
            const entry = mapping[cat];
            return (
              <div key={cat} className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">{cat}</span>
                <span className="font-mono">{entry?.code || '—'}</span>
              </div>
            );
          })}
        </div>
        <TrackingCategoryPrompt />
        <Button variant="outline" size="sm" onClick={runMapper} className="gap-2">
          <RefreshCw className="h-3 w-3" />
          Re-run AI mapper
        </Button>
      </CardContent>
    </Card>
  );
}

function TrackingCategoryPrompt() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'xero_tracking_enabled')
        .maybeSingle();
      setEnabled(data?.value === 'true');
    };
    check();
  }, []);

  const handleEnable = async () => {
    setToggling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'xero_tracking_enabled',
        value: 'true',
      } as any, { onConflict: 'user_id,key' });
      setEnabled(true);
      toast.success('Tracking Categories enabled');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setToggling(false);
    }
  };

  if (enabled === null) return null;

  if (enabled) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Tracking Categories: Enabled ✓
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between text-xs bg-muted/50 border rounded-md px-3 py-2">
      <span className="text-muted-foreground">📊 Enable Tracking Categories for per-channel P&L</span>
      <Button variant="outline" size="sm" onClick={handleEnable} disabled={toggling} className="h-6 text-xs px-2">
        {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enable'}
      </Button>
    </div>
  );
}
