/**
 * KnowledgeBaseDashboard — Admin tab for managing marketplace & payment processor registries.
 * Supports CRUD, active toggles, and AI-powered suggestions.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Sparkles, Loader2, Trash2, Store, CreditCard } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MarketplaceEntry {
  id: string;
  marketplace_code: string;
  marketplace_name: string;
  country: string;
  type: string;
  detection_keywords: string[];
  xero_contact_patterns: string[];
  bank_narration_patterns: string[];
  shopify_source_names: string[];
  is_active: boolean;
  added_by: string;
  notes: string | null;
}

interface ProcessorEntry {
  id: string;
  processor_code: string;
  processor_name: string;
  type: string;
  detection_keywords: string[];
  xero_contact_patterns: string[];
  bank_narration_patterns: string[];
  country: string;
  is_active: boolean;
  added_by: string;
  notes: string | null;
}

interface AiSuggestion {
  name: string;
  code: string;
  type: string;
  bank_narration_patterns: string[];
  xero_contact_patterns: string[];
  selected: boolean;
}

function parseJsonb(val: any): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

export default function KnowledgeBaseDashboard() {
  const [marketplaces, setMarketplaces] = useState<MarketplaceEntry[]>([]);
  const [processors, setProcessors] = useState<ProcessorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMpOpen, setAddMpOpen] = useState(false);
  const [addPpOpen, setAddPpOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiSuggestionsOpen, setAiSuggestionsOpen] = useState(false);
  const [aiSuggestType, setAiSuggestType] = useState<'marketplace' | 'processor'>('marketplace');

  // Add form state
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newXeroPatterns, setNewXeroPatterns] = useState('');
  const [newBankPatterns, setNewBankPatterns] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [mpRes, ppRes] = await Promise.all([
      supabase.from('marketplace_registry' as any).select('*').order('marketplace_name'),
      supabase.from('payment_processor_registry' as any).select('*').order('processor_name'),
    ]);

    if (mpRes.data) {
      setMarketplaces((mpRes.data as any[]).map((r: any) => ({
        ...r,
        detection_keywords: parseJsonb(r.detection_keywords),
        xero_contact_patterns: parseJsonb(r.xero_contact_patterns),
        bank_narration_patterns: parseJsonb(r.bank_narration_patterns),
        shopify_source_names: parseJsonb(r.shopify_source_names),
      })));
    }
    if (ppRes.data) {
      setProcessors((ppRes.data as any[]).map((r: any) => ({
        ...r,
        detection_keywords: parseJsonb(r.detection_keywords),
        xero_contact_patterns: parseJsonb(r.xero_contact_patterns),
        bank_narration_patterns: parseJsonb(r.bank_narration_patterns),
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleMpActive = async (id: string, active: boolean) => {
    await supabase.from('marketplace_registry' as any).update({ is_active: active }).eq('id', id);
    setMarketplaces(prev => prev.map(m => m.id === id ? { ...m, is_active: active } : m));
  };

  const togglePpActive = async (id: string, active: boolean) => {
    await supabase.from('payment_processor_registry' as any).update({ is_active: active }).eq('id', id);
    setProcessors(prev => prev.map(p => p.id === id ? { ...p, is_active: active } : p));
  };

  const deleteMp = async (id: string) => {
    await supabase.from('marketplace_registry' as any).delete().eq('id', id);
    setMarketplaces(prev => prev.filter(m => m.id !== id));
    toast.success('Marketplace removed');
  };

  const deletePp = async (id: string) => {
    await supabase.from('payment_processor_registry' as any).delete().eq('id', id);
    setProcessors(prev => prev.filter(p => p.id !== id));
    toast.success('Processor removed');
  };

  const splitComma = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean);

  const handleAddMp = async () => {
    if (!newCode || !newName) return;
    const { error } = await supabase.from('marketplace_registry' as any).insert({
      marketplace_code: newCode.toLowerCase().replace(/\s+/g, '_'),
      marketplace_name: newName,
      detection_keywords: splitComma(newKeywords),
      xero_contact_patterns: splitComma(newXeroPatterns),
      bank_narration_patterns: splitComma(newBankPatterns),
      added_by: 'admin',
      notes: newNotes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`${newName} added`);
    resetForm();
    setAddMpOpen(false);
    loadData();
  };

  const handleAddPp = async () => {
    if (!newCode || !newName) return;
    const { error } = await supabase.from('payment_processor_registry' as any).insert({
      processor_code: newCode.toLowerCase().replace(/\s+/g, '_'),
      processor_name: newName,
      detection_keywords: splitComma(newKeywords),
      xero_contact_patterns: splitComma(newXeroPatterns),
      bank_narration_patterns: splitComma(newBankPatterns),
      added_by: 'admin',
      notes: newNotes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`${newName} added`);
    resetForm();
    setAddPpOpen(false);
    loadData();
  };

  const resetForm = () => {
    setNewCode(''); setNewName(''); setNewKeywords('');
    setNewXeroPatterns(''); setNewBankPatterns(''); setNewNotes('');
  };

  const handleAiSuggest = async (type: 'marketplace' | 'processor') => {
    setAiLoading(true);
    setAiSuggestType(type);
    try {
      const existingList = type === 'marketplace'
        ? marketplaces.map(m => m.marketplace_name).join(', ')
        : processors.map(p => p.processor_name).join(', ');

      const prompt = type === 'marketplace'
        ? `List 15 additional Australian and international e-commerce marketplace platforms that online sellers commonly use, that are NOT already in this list: ${existingList}. For each provide: name, code (lowercase_underscore), type ("marketplace"), common bank narration patterns (uppercase), and Xero contact name patterns. Return ONLY a JSON array with objects having keys: name, code, type, bank_narration_patterns (string array), xero_contact_patterns (string array). No markdown, no explanation.`
        : `List 15 additional payment processors, BNPL providers, and payment gateways used in Australia and internationally that are NOT already in this list: ${existingList}. For each provide: name, code (lowercase_underscore), type ("payment_gateway" or "bnpl" or "bank"), common bank narration patterns (uppercase), and Xero contact name patterns. Return ONLY a JSON array with objects having keys: name, code, type, bank_narration_patterns (string array), xero_contact_patterns (string array). No markdown, no explanation.`;

      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { question: prompt, context: 'admin_knowledge_base' },
      });

      if (error) throw error;

      const responseText = data?.answer || data?.response || '';
      // Extract JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON found in AI response');

      const suggestions: AiSuggestion[] = JSON.parse(jsonMatch[0]).map((s: any) => ({
        ...s,
        selected: true,
      }));
      setAiSuggestions(suggestions);
      setAiSuggestionsOpen(true);
    } catch (err: any) {
      toast.error(`AI suggestion failed: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddSelected = async () => {
    const selected = aiSuggestions.filter(s => s.selected);
    if (!selected.length) return;

    let added = 0;
    for (const s of selected) {
      const table = aiSuggestType === 'marketplace' ? 'marketplace_registry' : 'payment_processor_registry';
      const record = aiSuggestType === 'marketplace'
        ? {
            marketplace_code: s.code,
            marketplace_name: s.name,
            detection_keywords: [s.code, ...s.name.toLowerCase().split(' ')],
            xero_contact_patterns: s.xero_contact_patterns || [],
            bank_narration_patterns: s.bank_narration_patterns || [],
            added_by: 'ai',
          }
        : {
            processor_code: s.code,
            processor_name: s.name,
            detection_keywords: [s.code, ...s.name.toLowerCase().split(' ')],
            xero_contact_patterns: s.xero_contact_patterns || [],
            bank_narration_patterns: s.bank_narration_patterns || [],
            added_by: 'ai',
          };

      const { error } = await supabase.from(table as any).insert(record);
      if (!error) added++;
    }

    toast.success(`Added ${added} new entries`);
    setAiSuggestionsOpen(false);
    setAiSuggestions([]);
    loadData();
  };

  const renderAddForm = (onSubmit: () => void) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Code</label>
          <Input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="e.g. temu" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Temu" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Detection keywords (comma-separated)</label>
        <Input value={newKeywords} onChange={e => setNewKeywords(e.target.value)} placeholder="temu, temu.com" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Xero contact patterns (comma-separated)</label>
        <Input value={newXeroPatterns} onChange={e => setNewXeroPatterns(e.target.value)} placeholder="Temu, Temu Marketplace" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Bank narration patterns (comma-separated)</label>
        <Input value={newBankPatterns} onChange={e => setNewBankPatterns(e.target.value)} placeholder="TEMU" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Notes</label>
        <Textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} />
      </div>
      <DialogFooter>
        <Button onClick={onSubmit} disabled={!newCode || !newName}>Add</Button>
      </DialogFooter>
    </div>
  );

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Knowledge Base</CardTitle>
          <CardDescription>
            System-wide registry of known marketplaces and payment processors.
            Detection functions use these tables to classify contacts, deposits, and orders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="marketplaces">
            <TabsList>
              <TabsTrigger value="marketplaces" className="gap-1.5">
                <Store className="h-3.5 w-3.5" /> Marketplaces ({marketplaces.length})
              </TabsTrigger>
              <TabsTrigger value="processors" className="gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> Payment Processors ({processors.length})
              </TabsTrigger>
            </TabsList>

            {/* ─── Marketplaces ─── */}
            <TabsContent value="marketplaces" className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">{marketplaces.length} registered marketplaces</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleAiSuggest('marketplace')} disabled={aiLoading} className="gap-1.5">
                    {aiLoading && aiSuggestType === 'marketplace' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Ask AI to suggest more
                  </Button>
                  <Button size="sm" onClick={() => { resetForm(); setAddMpOpen(true); }} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add marketplace
                  </Button>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead>Added by</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marketplaces.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.marketplace_name}</TableCell>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.marketplace_code}</code></TableCell>
                      <TableCell>{m.country}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {m.detection_keywords.slice(0, 3).map(k => (
                            <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                          ))}
                          {m.detection_keywords.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">+{m.detection_keywords.length - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{m.added_by}</Badge></TableCell>
                      <TableCell>
                        <Switch checked={m.is_active} onCheckedChange={(v) => toggleMpActive(m.id, v)} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMp(m.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            {/* ─── Payment Processors ─── */}
            <TabsContent value="processors" className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">{processors.length} registered processors</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleAiSuggest('processor')} disabled={aiLoading} className="gap-1.5">
                    {aiLoading && aiSuggestType === 'processor' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Ask AI to suggest more
                  </Button>
                  <Button size="sm" onClick={() => { resetForm(); setAddPpOpen(true); }} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add processor
                  </Button>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead>Added by</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processors.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.processor_name}</TableCell>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.processor_code}</code></TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{p.type}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {p.detection_keywords.slice(0, 3).map(k => (
                            <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                          ))}
                          {p.detection_keywords.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">+{p.detection_keywords.length - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{p.added_by}</Badge></TableCell>
                      <TableCell>
                        <Switch checked={p.is_active} onCheckedChange={(v) => togglePpActive(p.id, v)} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deletePp(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Add Marketplace Dialog */}
      <Dialog open={addMpOpen} onOpenChange={setAddMpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Marketplace</DialogTitle></DialogHeader>
          {renderAddForm(handleAddMp)}
        </DialogContent>
      </Dialog>

      {/* Add Processor Dialog */}
      <Dialog open={addPpOpen} onOpenChange={setAddPpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Payment Processor</DialogTitle></DialogHeader>
          {renderAddForm(handleAddPp)}
        </DialogContent>
      </Dialog>

      {/* AI Suggestions Dialog */}
      <Dialog open={aiSuggestionsOpen} onOpenChange={setAiSuggestionsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Suggestions — {aiSuggestType === 'marketplace' ? 'Marketplaces' : 'Payment Processors'}</DialogTitle>
          </DialogHeader>
          {aiSuggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No suggestions found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Add</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bank Patterns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiSuggestions.map((s, i) => (
                    <TableRow key={s.code}>
                      <TableCell>
                        <Checkbox
                          checked={s.selected}
                          onCheckedChange={(v) => {
                            setAiSuggestions(prev => prev.map((item, idx) => idx === i ? { ...item, selected: !!v } : item));
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell><code className="text-xs">{s.code}</code></TableCell>
                      <TableCell>{s.type}</TableCell>
                      <TableCell className="text-xs">{(s.bank_narration_patterns || []).join(', ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAiSuggestionsOpen(false)}>Cancel</Button>
                <Button onClick={handleAddSelected} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add {aiSuggestions.filter(s => s.selected).length} selected
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
