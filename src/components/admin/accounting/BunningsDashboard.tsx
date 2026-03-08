import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  History, Loader2, Send, Eye, Trash2, Info
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { parseBunningsSummaryPdf, type BunningsParseExtra } from '@/utils/bunnings-summary-parser';
import {
  type StandardSettlement,
  saveSettlement,
  syncSettlementToXero,
  deleteSettlement,
  formatSettlementDate,
  formatAUD,
} from '@/utils/settlement-engine';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';

interface BunningsDashboardProps {
  marketplace: { marketplace_code: string; marketplace_name: string };
}

interface SettlementRecord {
  id: string;
  settlement_id: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  sales_principal: number;
  seller_fees: number;
  gst_on_income: number;
  gst_on_expenses: number;
  status: string;
  xero_journal_id: string | null;
  created_at: string;
  marketplace: string;
}

function statusBadge(status: string) {
  switch (status) {
    case 'synced':
      return <Badge className="bg-green-100 text-green-800 border-green-200">Synced to Xero</Badge>;
    case 'saved':
    case 'parsed':
      return <Badge variant="secondary">Saved</Badge>;
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function BunningsDashboard({ marketplace }: BunningsDashboardProps) {
  const [activeTab, setActiveTab] = useState('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<StandardSettlement | null>(null);
  const [extra, setExtra] = useState<BunningsParseExtra | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [savedSettlementId, setSavedSettlementId] = useState<string | null>(null);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('marketplace', 'bunnings')
        .order('period_end', { ascending: false })
        .limit(50);
      if (error) throw error;
      setSettlements((data || []) as SettlementRecord[]);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!f.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please upload a PDF file (Summary of Transactions).');
      return;
    }

    setFile(f);
    setParsed(null);
    setExtra(null);
    setParseError(null);
    setSavedSettlementId(null);
    setParsing(true);

    try {
      const result = await parseBunningsSummaryPdf(f);
      if (result.success) {
        setParsed(result.settlement);
        setExtra(result.extra);
        toast.success('Settlement parsed successfully!');
        setActiveTab('review');
      } else {
        const errMsg = (result as any).error || 'Unknown error';
        setParseError(errMsg);
        toast.error(errMsg);
      }
    } catch (err: any) {
      setParseError(err.message || 'Unknown parsing error');
      toast.error('Failed to parse PDF');
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!parsed) return;
    setSaving(true);
    const result = await saveSettlement(parsed);
    if (result.success) {
      setSavedSettlementId(parsed.settlement_id);
      toast.success('Settlement saved!');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to save');
    }
    setSaving(false);
  };

  const handlePushToXero = async (settlementId?: string) => {
    const targetId = settlementId || savedSettlementId || parsed?.settlement_id;
    if (!targetId) return;

    setPushing(true);
    const result = await syncSettlementToXero(targetId, 'bunnings');
    if (result.success) {
      toast.success('Invoice created in Xero!');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to push to Xero');
    }
    setPushing(false);
  };

  const handleDelete = async (id: string) => {
    const result = await deleteSettlement(id);
    if (result.success) {
      toast.success('Settlement deleted');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
  };

  const clearUpload = () => {
    setFile(null);
    setParsed(null);
    setExtra(null);
    setParseError(null);
    setSavedSettlementId(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-xl">🔨</span>
            Bunnings Settlements
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload your Summary of Transactions PDF → Review → Push to Xero.
          </p>
        </div>
        <XeroConnectionStatus />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="upload" className="flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="review" className="flex items-center gap-1.5" disabled={!parsed && !savedSettlementId}>
            <Eye className="h-3.5 w-3.5" />
            Review
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            History
          </TabsTrigger>
        </TabsList>

        {/* ─── UPLOAD TAB ─── */}
        <TabsContent value="upload" className="space-y-4 mt-4">
          <Card className="border-2 border-primary/20 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Upload your Bunnings "Summary of Transactions" PDF</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This is the fortnightly settlement PDF from your Bunnings Mirakl seller portal. 
                    We'll extract the totals and create a matching Xero invoice automatically.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-2 transition-colors ${file && !parseError ? 'border-green-400/50 bg-green-50/20' : 'border-dashed border-muted-foreground/25 hover:border-primary/40'}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Settlement PDF
                {parsing && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
                {parsed && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
                {parseError && <XCircle className="h-4 w-4 text-destructive ml-auto" />}
              </CardTitle>
              <CardDescription className="text-xs">
                Accepted: Summary of Transactions PDF from Bunnings Mirakl portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={parsing}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary file:text-primary-foreground
                  hover:file:opacity-90 file:cursor-pointer"
              />
              {file && (
                <div className="flex items-center justify-between mt-2">
                  <p className={`text-xs font-medium ${parseError ? 'text-destructive' : 'text-green-700'}`}>
                    {parseError ? `✗ ${parseError}` : `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`}
                  </p>
                  <Button variant="ghost" size="sm" className="text-xs h-6" onClick={clearUpload}>
                    Clear
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── REVIEW TAB ─── */}
        <TabsContent value="review" className="space-y-4 mt-4">
          {parsed ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Settlement Summary</CardTitle>
                    <div className="flex items-center gap-2">
                      {parsed.reconciles ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Reconciled
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Mismatch
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription>
                    {extra?.shopName || 'Bunnings'} • {formatSettlementDate(parsed.period_start)} – {formatSettlementDate(parsed.period_end)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <span className="text-muted-foreground">Gross Sales (excl. GST)</span>
                      <span className="font-medium text-right">{formatAUD(parsed.sales_ex_gst)}</span>
                      
                      <span className="text-muted-foreground">GST Collected</span>
                      <span className="font-medium text-right">{formatAUD(parsed.gst_on_sales)}</span>
                      
                      <span className="text-muted-foreground">Commission (excl. GST)</span>
                      <span className="font-medium text-right text-destructive">{formatAUD(parsed.fees_ex_gst)}</span>
                      
                      <span className="text-muted-foreground">GST on Commission</span>
                      <span className="font-medium text-right text-destructive">-{formatAUD(parsed.gst_on_fees)}</span>
                    </div>
                    
                    <div className="border-t border-border pt-3">
                      <div className="grid grid-cols-2 gap-x-8 text-sm">
                        <span className="font-semibold">Net Settlement</span>
                        <span className="font-bold text-right text-lg">{formatAUD(parsed.net_payout)}</span>
                      </div>
                    </div>

                    {parsed.settlement_id && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Settlement ID: {parsed.settlement_id}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Xero Invoice Preview */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Xero Invoice Preview</CardTitle>
                  <CardDescription>This is what will be created in Xero</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Description</th>
                          <th className="text-left px-3 py-2 font-medium">Account</th>
                          <th className="text-right px-3 py-2 font-medium">Amount</th>
                          <th className="text-left px-3 py-2 font-medium">Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2">Marketplace Sales</td>
                          <td className="px-3 py-2 text-muted-foreground">200 – Sales</td>
                          <td className="px-3 py-2 text-right font-medium">{formatAUD(parsed.sales_ex_gst)}</td>
                          <td className="px-3 py-2 text-muted-foreground">GST on Income</td>
                        </tr>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2">Marketplace Commission</td>
                          <td className="px-3 py-2 text-muted-foreground">407 – Seller Fees</td>
                          <td className="px-3 py-2 text-right font-medium text-destructive">{formatAUD(parsed.fees_ex_gst)}</td>
                          <td className="px-3 py-2 text-muted-foreground">GST on Expenses</td>
                        </tr>
                      </tbody>
                      <tfoot className="bg-muted/30 border-t border-border">
                        <tr>
                          <td colSpan={2} className="px-3 py-2 font-semibold">Invoice Total</td>
                          <td className="px-3 py-2 text-right font-bold">{formatAUD(parsed.net_payout)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Contact: Bunnings Marketplace • Ref: Bunnings Settlement {formatSettlementDate(parsed.period_start)} – {formatSettlementDate(parsed.period_end)}
                  </p>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex gap-3">
                {!savedSettlementId ? (
                  <Button onClick={handleSave} disabled={saving} className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Save Settlement
                  </Button>
                ) : (
                  <Button onClick={() => handlePushToXero()} disabled={pushing} className="flex-1">
                    {pushing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send to Xero
                  </Button>
                )}
                <Button variant="outline" onClick={clearUpload}>
                  Upload Another
                </Button>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Upload a Bunnings PDF to see the settlement review here.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── HISTORY TAB ─── */}
        <TabsContent value="history" className="space-y-4 mt-4">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : settlements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No Bunnings settlements yet. Upload your first PDF above.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {settlements.map((s) => (
                <Card key={s.id} className="hover:border-primary/20 transition-colors">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)}
                          </p>
                          {statusBadge(s.status)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Sales: {formatAUD(s.sales_principal)} • Commission: {formatAUD(s.seller_fees)} • Net: {formatAUD(s.bank_deposit)}
                        </p>
                        <p className="text-xs text-muted-foreground">ID: {s.settlement_id}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.status === 'saved' && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handlePushToXero(s.settlement_id)}
                            disabled={pushing}
                          >
                            {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                            Push to Xero
                          </Button>
                        )}
                        {s.status !== 'synced' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(s.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
