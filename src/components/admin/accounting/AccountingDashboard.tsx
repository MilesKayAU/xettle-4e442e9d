import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
// pendingPushRef: triggers auto-push to Xero after history review loads parsed state
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { DollarSign, Upload, FileSpreadsheet, Globe, CheckCircle2, XCircle, AlertTriangle, FileText, History, Settings, Clock, ArrowRight, Info, Save, Loader2, FolderUp, SkipForward, Square, Eye, Download, ChevronDown, MoreHorizontal, Undo2, ExternalLink, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseSettlementTSV, formatDisplayDate, formatAUD, XERO_ACCOUNT_MAP, round2, PARSER_VERSION, type ParsedSettlement, type DebugBreakdownRow, type ParserOptions, type SplitMonthData } from '@/utils/settlement-parser';
import { Scissors } from "lucide-react";
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';

const PLATFORMS = [
  { code: 'amazon', label: 'Amazon', icon: '📦', active: true },
  { code: 'shopify', label: 'Shopify', icon: '🛍️', active: false },
  { code: 'ebay', label: 'eBay', icon: '🏷️', active: false },
  { code: 'kogan', label: 'Kogan', icon: '🛒', active: false },
  { code: 'bunnings', label: 'Bunnings', icon: '🔨', active: false },
] as const;

const COUNTRIES = [
  { code: 'AU', label: 'Australia', flag: '🇦🇺', active: true },
  { code: 'UK', label: 'United Kingdom', flag: '🇬🇧', active: false },
  { code: 'US', label: 'United States', flag: '🇺🇸', active: false },
] as const;

interface SettlementRecord {
  id: string;
  settlement_id: string;
  period_start: string;
  period_end: string;
  deposit_date: string;
  bank_deposit: number;
  status: string;
  sales_principal: number;
  sales_shipping: number;
  promotional_discounts: number;
  seller_fees: number;
  fba_fees: number;
  storage_fees: number;
  refunds: number;
  reimbursements: number;
  other_fees: number;
  net_ex_gst: number;
  gst_on_income: number;
  gst_on_expenses: number;
  reconciliation_status: string;
  xero_journal_id: string | null;
  created_at: string;
  is_split_month?: boolean;
  split_month_1_data?: string | null;
  split_month_2_data?: string | null;
  xero_journal_id_1?: string | null;
  xero_journal_id_2?: string | null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function removeExistingSettlementForUser(userId: string, settlementId: string, marketplace?: string) {
  const { error: linesError } = await supabase
    .from('settlement_lines')
    .delete()
    .eq('user_id', userId)
    .eq('settlement_id', settlementId);
  if (linesError) throw linesError;

  const { error: unmappedError } = await supabase
    .from('settlement_unmapped')
    .delete()
    .eq('user_id', userId)
    .eq('settlement_id', settlementId);
  if (unmappedError) throw unmappedError;

  let deleteSettlementsQuery = supabase
    .from('settlements')
    .delete()
    .eq('user_id', userId)
    .eq('settlement_id', settlementId);

  if (marketplace) {
    deleteSettlementsQuery = deleteSettlementsQuery.eq('marketplace', marketplace);
  }

  const { error: settlementError } = await deleteSettlementsQuery;
  if (settlementError) throw settlementError;
}

export default function AccountingDashboard() {
  const [selectedPlatform, setSelectedPlatform] = useState('amazon');
  const [selectedCountry, setSelectedCountry] = useState('AU');
  const [activeTab, setActiveTab] = useState('upload');
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [transactionFile, setTransactionFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSettlement | null>(null);
  const [parsing, setParsing] = useState(false);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [loadingSettlements, setLoadingSettlements] = useState(true);
  const [uploadWarning, setUploadWarning] = useState<{ type: 'duplicate' | 'gap'; message: string; existing?: SettlementRecord } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [settingsGstRate, setSettingsGstRate] = useState<number>(10);
  const [settingsAccountCodes, setSettingsAccountCodes] = useState<Record<string, string> | null>(null);
  
  // Bulk upload state
  const [bulkFiles, setBulkFiles] = useState<File[] | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  
  // Batch review state — holds multiple parsed settlements
  const [parsedBatch, setParsedBatch] = useState<Array<{ parsed: ParsedSettlement; saved: boolean; saving: boolean }>>([]);
  
  // File input refs for resetting
  const settlementInputRef = useRef<HTMLInputElement>(null);
  const transactionInputRef = useRef<HTMLInputElement>(null);
  const pendingPushRef = useRef(false);

  // Auto-trigger Push to Xero after history review loads parsed state
  useEffect(() => {
    if (pendingPushRef.current && parsed && !pushing) {
      pendingPushRef.current = false;
      handlePushToXero();
    }
  }, [parsed, pushing]);

  const clearSettlementFiles = useCallback(() => {
    setSettlementFile(null);
    setBulkFiles(null);
    setBulkProcessing(false);
    setParsed(null);
    setParsedBatch([]);
    setUploadWarning(null);
    setSaved(false);
    setPushed(false);
    if (settlementInputRef.current) settlementInputRef.current.value = '';
  }, []);

  const clearTransactionFile = useCallback(() => {
    setTransactionFile(null);
    if (transactionInputRef.current) transactionInputRef.current.value = '';
  }, []);

  // Load settings from app_settings on mount
  useEffect(() => {
    const loadAccountingSettings = async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('key, value')
          .in('key', ['accounting_xero_account_codes', 'accounting_gst_rate']);
        if (data) {
          for (const row of data) {
            if (row.key === 'accounting_gst_rate' && row.value) {
              const parsed = parseFloat(row.value);
              if (!isNaN(parsed) && parsed > 0) setSettingsGstRate(parsed);
            }
            if (row.key === 'accounting_xero_account_codes' && row.value) {
              try { setSettingsAccountCodes(JSON.parse(row.value)); } catch {}
            }
          }
        }
      } catch {}
    };
    loadAccountingSettings();
  }, []);

  const loadSettlements = useCallback(async () => {
    setLoadingSettlements(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('marketplace', selectedCountry)
        .order('period_end', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as SettlementRecord[]);
    } catch {
      // silently fail on load
    } finally {
      setLoadingSettlements(false);
    }
  }, [selectedCountry]);

  useEffect(() => { loadSettlements(); }, [loadSettlements]);

  // Reload settlements whenever the user switches to the history tab
  useEffect(() => {
    if (activeTab === 'history') {
      loadSettlements();
    }
  }, [activeTab, loadSettlements]);

  const lastSettlement = settlements.length > 0 ? settlements[0] : null;
  const nextExpectedStart = lastSettlement ? lastSettlement.period_end : null;

  const handleSettlementUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    if (files.length === 1) {
      // Single file mode — existing behaviour
      setSettlementFile(files[0]);
      setBulkFiles(null);
      setParsed(null);
      setUploadWarning(null);
      setSaved(false);
      setPushed(false);
    } else {
      // Bulk mode — sort by settlement ID extracted from filename
      const fileArray = Array.from(files);
      const extractId = (name: string): number => {
        const match = name.match(/(\d{9,15})/);
        return match ? parseInt(match[1], 10) : 0;
      };
      fileArray.sort((a, b) => extractId(a.name) - extractId(b.name));
      setBulkFiles(fileArray);
      setSettlementFile(null);
      setParsed(null);
      setUploadWarning(null);
      setSaved(false);
      setPushed(false);
    }
  }, []);

  const handleTransactionUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setTransactionFile(file);
  }, []);

  const handleParse = useCallback(async () => {
    if (!settlementFile) {
      toast.error('Please upload a settlement report first');
      return;
    }
    setParsing(true);
    setUploadWarning(null);
    setSaved(false);
    setPushed(false);
    try {
      const text = await settlementFile.text();
      const parserOpts: ParserOptions = { gstRate: settingsGstRate };
      const result = parseSettlementTSV(text, parserOpts);

      const existing = settlements.find(s => s.settlement_id === result.header.settlementId);
      if (existing) {
        setUploadWarning({
          type: 'duplicate',
          message: `This settlement (${result.header.settlementId}) is already saved. Parsing fresh — save will overwrite existing record.`,
          existing,
        });
      } else if (lastSettlement && result.header.periodStart) {
        const expectedStart = lastSettlement.period_end;
        if (result.header.periodStart > expectedStart) {
          setUploadWarning({
            type: 'gap',
            message: `Expected next settlement starting ${formatDisplayDate(expectedStart)}, but uploaded file starts ${formatDisplayDate(result.header.periodStart)}. There may be a missing settlement.`,
          });
        }
      }

      setParsed(result);
      setActiveTab('review');
      if (result.summary.reconciliationMatch) {
        toast.success(`Settlement ${result.header.settlementId} parsed & reconciled ✓`);
      } else {
        toast.warning(`Settlement parsed but reconciliation FAILED — diff: ${formatAUD(result.summary.reconciliationDiff)}`);
      }
    } catch (err: any) {
      toast.error(`Parse error: ${err.message}`);
    } finally {
      setParsing(false);
    }
  }, [settlementFile, settlements, lastSettlement, settingsGstRate]);

  // Helper to get account code from settings or defaults
  const getAccountCode = useCallback((category: string): string => {
    if (settingsAccountCodes && settingsAccountCodes[category]) {
      return settingsAccountCodes[category];
    }
    return XERO_ACCOUNT_MAP[category]?.code || '000';
  }, [settingsAccountCodes]);

  // ─── Fix 2: Save Only button logic ────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!parsed) return;
    if (!parsed.summary.reconciliationMatch) {
      toast.error('Cannot save — settlement does not reconcile');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { header, summary, lines, unmapped } = parsed;

      // Duplicate check before saving: overwrite existing record with fresh parse
      const { data: existingData } = await supabase
        .from('settlements')
        .select('id')
        .eq('settlement_id', header.settlementId)
        .eq('user_id', user.id)
        .limit(1);

      const isOverwrite = !!(existingData && existingData.length > 0);
      if (isOverwrite) {
        await removeExistingSettlementForUser(user.id, header.settlementId, selectedCountry);
        toast.warning(`Settlement ${header.settlementId} already saved. Overwriting with freshly parsed data.`);
      }

      // 1. Insert into settlements table
      const splitMonth = parsed.splitMonth;

      if (splitMonth.isSplitMonth) {
        const salesTotal = round2(summary.salesPrincipal + summary.salesShipping + summary.promotionalDiscounts);
        const feesTotal = round2(summary.sellerFees + summary.fbaFees + summary.storageFees);
        const refundsTotal = round2(summary.refunds);
        const reimbursementsTotal = round2(summary.reimbursements);
        const journalOneNet = round2(salesTotal + feesTotal + refundsTotal + reimbursementsTotal);

        console.info('[Split Month Rollover Debug]', {
          settlementId: header.settlementId,
          salesTotal,
          feesTotal,
          refundsTotal,
          reimbursementsTotal,
          journalOneNet,
          parserRolloverAmount: splitMonth.rolloverAmount,
        });
      }
      
      const { error: settError } = await supabase.from('settlements').insert({
        user_id: user.id,
        settlement_id: header.settlementId,
        marketplace: selectedCountry,
        period_start: header.periodStart,
        period_end: header.periodEnd,
        deposit_date: header.depositDate,
        currency: header.currency,
        sales_principal: summary.salesPrincipal,
        sales_shipping: summary.salesShipping,
        promotional_discounts: summary.promotionalDiscounts,
        seller_fees: summary.sellerFees,
        fba_fees: summary.fbaFees,
        storage_fees: summary.storageFees,
        refunds: summary.refunds,
        reimbursements: summary.reimbursements,
        other_fees: summary.otherFees,
        net_ex_gst: summary.netExGst,
        gst_on_income: summary.gstOnIncome,
        gst_on_expenses: summary.gstOnExpenses,
        bank_deposit: summary.bankDeposit,
        reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
        status: 'saved',
        is_split_month: splitMonth.isSplitMonth,
        split_month_1_start: splitMonth.month1?.start || null,
        split_month_1_end: splitMonth.month1?.end || null,
        split_month_1_ratio: splitMonth.month1?.ratio || null,
        split_month_2_start: splitMonth.month2?.start || null,
        split_month_2_end: splitMonth.month2?.end || null,
        split_month_2_ratio: splitMonth.month2?.ratio || null,
        split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
        split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
        international_sales: summary.internationalSales,
        international_fees: summary.internationalFees,
        split_rollover_amount: splitMonth.rolloverAmount || 0,
        parser_version: PARSER_VERSION,
      } as any);
      if (settError) throw settError;

      // 2. Insert settlement_lines (batch in chunks of 500)
      if (lines.length > 0) {
        const lineRows = lines.map(l => ({
          user_id: user.id,
          settlement_id: header.settlementId,
          transaction_type: l.transactionType,
          amount_type: l.amountType,
          amount_description: l.amountDescription,
          accounting_category: l.accountingCategory,
          amount: l.amount,
          order_id: l.orderId || null,
          sku: l.sku || null,
          posted_date: l.postedDate || null,
          marketplace_name: l.marketplaceName || null,
        }));
        for (let i = 0; i < lineRows.length; i += 500) {
          const chunk = lineRows.slice(i, i + 500);
          const { error: lineErr } = await supabase.from('settlement_lines').insert(chunk);
          if (lineErr) throw lineErr;
        }
      }

      // 3. Insert settlement_unmapped
      if (unmapped.length > 0) {
        const unmappedRows = unmapped.map(u => ({
          user_id: user.id,
          settlement_id: header.settlementId,
          transaction_type: u.transactionType,
          amount_type: u.amountType,
          amount_description: u.amountDescription,
          amount: u.amount,
          raw_row: u.rawRow,
        }));
        const { error: unmappedErr } = await supabase.from('settlement_unmapped').insert(unmappedRows);
        if (unmappedErr) throw unmappedErr;
      }

      setSaved(true);
      toast.success(`Settlement ${header.settlementId} ${isOverwrite ? 'overwritten' : 'saved'} successfully`);
      await loadSettlements();
      // Stay on review tab so user can Push to Xero — don't clear parsed state
      // clearSettlementFiles() would set parsed=null, breaking Push to Xero
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [parsed, selectedCountry, loadSettlements]);

  // ─── Build invoice line items for Xero, marketplace-aware TaxType ─────────
  const buildInvoiceLineItems = useCallback((
    parsedLines: ParsedSettlement['lines'],
    periodLabel: string,
    settlementId: string,
    ratio?: number, // optional split month ratio
    bankDeposit?: number, // optional: for rounding adjustment
  ) => {
    // Split Sales into Principal vs Shipping; aggregate by category + marketplace
    const INCOME_CATS = new Set(['Sales - Principal', 'Sales - Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements']);

    // Tax sub-line display names (matches Link My Books)
    const TAX_SUBCAT_MAP: Record<string, string> = {
      'Tax': 'Tax',
      'ShippingTax': 'Shipping Tax',
      'TaxDiscount': 'Tax Discounts',
      'LowValueGoodsTax-Principal': 'Low Value Goods Tax',
      'LowValueGoodsTax-Shipping': 'Low Value Goods Tax',
    };

    const auBuckets: Record<string, number> = {};
    const intlBuckets: Record<string, number> = {};
    const expenseBuckets: Record<string, number> = {};
    const otherBuckets: Record<string, number> = {};
    const taxSubBuckets: Record<string, number> = {}; // Tax sub-lines by display name

    for (const line of parsedLines) {
      let cat = line.accountingCategory;
      // Split Sales into Principal / Shipping sub-lines
      if (cat === 'Sales') {
        cat = line.amountDescription === 'Shipping' ? 'Sales - Shipping' : 'Sales - Principal';
      }
      // Tax Collected by Amazon → split into sub-lines by amountDescription
      if (cat === 'Tax Collected by Amazon') {
        const subName = TAX_SUBCAT_MAP[line.amountDescription] || line.amountDescription;
        const key = `Amazon Sales Tax - ${subName}`;
        taxSubBuckets[key] = (taxSubBuckets[key] || 0) + line.amount;
        continue;
      }
      if (INCOME_CATS.has(cat)) {
        if (line.isAuMarketplace) {
          auBuckets[cat] = (auBuckets[cat] || 0) + line.amount;
        } else {
          intlBuckets[cat] = (intlBuckets[cat] || 0) + line.amount;
        }
      } else if (['Seller Fees', 'FBA Fees', 'Storage Fees'].includes(cat)) {
        expenseBuckets[cat] = (expenseBuckets[cat] || 0) + line.amount;
      } else {
        otherBuckets[cat] = (otherBuckets[cat] || 0) + line.amount;
      }
    }

    // Determine TaxType per category
    const getTaxType = (cat: string, marketplace: 'au' | 'intl'): string => {
      if (cat === 'Reimbursements') return 'OUTPUT'; // GST on Income (account 271)
      if (marketplace === 'intl') return 'EXEMPTOUTPUT'; // GST Free
      // AU: Sales, Refunds, Promo Discounts → OUTPUT (GST on Income)
      return 'OUTPUT';
    };

    const getAccountCodeForSplit = (cat: string): string => {
      // Sales - Principal and Sales - Shipping both map to Sales account
      if (cat === 'Sales - Principal' || cat === 'Sales - Shipping') return getAccountCode('Sales');
      return getAccountCode(cat);
    };

    const lineItems: Array<{ Description: string; AccountCode: string; TaxType: string; UnitAmount: number; Quantity: number }> = [];

    // AU income lines — amounts are ex-GST for EXCLUSIVE line amount type
    // Xero calculates GST on top when LineAmountTypes=Exclusive
    for (const [category, amount] of Object.entries(auBuckets)) {
      const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
      if (appliedAmount === 0) continue;
      // For Exclusive invoices, UnitAmount is the ex-GST amount
      // GST items: divide by 11 to get GST, subtract to get ex-GST
      const taxType = getTaxType(category, 'au');
      const isGstItem = taxType === 'OUTPUT' || taxType === 'INPUT';
      const exGst = isGstItem ? round2(appliedAmount - round2(appliedAmount / 11)) : appliedAmount;
      lineItems.push({
        Description: `Amazon ${category === 'Sales - Principal' ? 'Sales - Principal' : category === 'Sales - Shipping' ? 'Sales - Shipping' : category} - Australia ${periodLabel}`,
        AccountCode: getAccountCodeForSplit(category),
        TaxType: taxType,
        UnitAmount: exGst,
        Quantity: 1,
      });
    }

    // International income lines (GST Free — amount IS the ex-GST amount)
    for (const [category, amount] of Object.entries(intlBuckets)) {
      const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
      if (appliedAmount === 0) continue;
      lineItems.push({
        Description: `Amazon ${category === 'Sales - Principal' ? 'Sales - Principal' : category === 'Sales - Shipping' ? 'Sales - Shipping' : category} - Rest of the World ${periodLabel}`,
        AccountCode: getAccountCodeForSplit(category),
        TaxType: getTaxType(category, 'intl'),
        UnitAmount: appliedAmount,
        Quantity: 1,
      });
    }

    // Expense lines → INPUT (amounts include GST, extract ex-GST for Exclusive)
    for (const [category, amount] of Object.entries(expenseBuckets)) {
      const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
      if (appliedAmount === 0) continue;
      const exGst = round2(appliedAmount - round2(appliedAmount / 11));
      lineItems.push({
        Description: `Amazon ${category} ${periodLabel}`,
        AccountCode: getAccountCode(category),
        TaxType: 'INPUT',
        UnitAmount: exGst,
        Quantity: 1,
      });
    }

    // Other lines (Tax Collected by Amazon etc.) → BASEXCLUDED
    for (const [category, amount] of Object.entries(otherBuckets)) {
      const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
      if (appliedAmount === 0) continue;
      lineItems.push({
        Description: `Amazon ${category} ${periodLabel}`,
        AccountCode: getAccountCode(category),
        TaxType: 'BASEXCLUDED',
        UnitAmount: appliedAmount,
        Quantity: 1,
      });
    }

    // Tax sub-lines (824) — each sub-category as a separate BASEXCLUDED line
    for (const [description, amount] of Object.entries(taxSubBuckets)) {
      const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
      if (appliedAmount === 0) continue;
      lineItems.push({
        Description: `${description} ${periodLabel}`,
        AccountCode: getAccountCode('Tax Collected by Amazon'),
        TaxType: 'BASEXCLUDED',
        UnitAmount: appliedAmount,
        Quantity: 1,
      });
    }

    // ─── Rounding adjustment ───────────────────────────────────────────
    // Xero calculates invoice total as: sum of (exGst + Xero-computed GST) per line
    // Due to per-line rounding, the total can differ by 1-2c from bank deposit
    // Add a tiny BASEXCLUDED adjustment line to correct any difference
    if (bankDeposit !== undefined && !ratio) {
      // Compute what Xero will calculate as the invoice total
      let xeroTotal = 0;
      for (const item of lineItems) {
        if (item.TaxType === 'OUTPUT') {
          // Xero adds 10% GST on top: line total = UnitAmount * 1.1
          xeroTotal += round2(round2(item.UnitAmount) * 1.1);
        } else if (item.TaxType === 'INPUT') {
          // INPUT on ACCREC: Xero adds 10% GST (expense credit)
          xeroTotal += round2(round2(item.UnitAmount) * 1.1);
        } else if (item.TaxType === 'EXEMPTOUTPUT') {
          xeroTotal += round2(item.UnitAmount);
        } else {
          // BASEXCLUDED — no GST added
          xeroTotal += round2(item.UnitAmount);
        }
      }
      xeroTotal = round2(xeroTotal);
      const diff = round2(bankDeposit - xeroTotal);
      if (diff !== 0 && Math.abs(diff) <= 0.05) {
        console.info('[Rounding Adjustment]', { bankDeposit, xeroTotal, diff });
        lineItems.push({
          Description: `Rounding adjustment ${periodLabel}`,
          AccountCode: getAccountCode('Sales'),
          TaxType: 'BASEXCLUDED',
          UnitAmount: diff,
          Quantity: 1,
        });
      }
    }

    // NO clearing line — invoices don't need one
    return lineItems;
  }, [getAccountCode]);

  // ─── Approve & Push to Xero (as ACCREC Invoice) ────────────────────
  const handlePushToXero = useCallback(async () => {
    if (!parsed) return;
    if (!parsed.summary.reconciliationMatch) {
      toast.error('Cannot push to Xero — settlement does not reconcile');
      return;
    }
    setPushing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { header, splitMonth, lines: parsedLines } = parsed;
      const period = `${formatDisplayDate(header.periodStart)} – ${formatDisplayDate(header.periodEnd)}`;

      if (splitMonth.isSplitMonth && splitMonth.month1 && splitMonth.month2) {
        // SPLIT MONTH — Account 612 Rollover Method (matches Link My Books)
        // Invoice 1: ALL transactions at full amounts + CR 612 → nets to $0.00
        // Invoice 2: DR 612 (clears rollover) + month2 proportional transactions → nets to bank deposit

        const m1 = splitMonth.month1;
        const m2 = splitMonth.month2;
        
        // Invoice 1: Full amounts (no ratio) + balancing 612 line
        const lines1 = buildInvoiceLineItems(parsedLines, `${m1.monthLabel} (full)`, header.settlementId);
        const lines1Sum = lines1.reduce((sum, l) => sum + l.UnitAmount, 0);
        const rolloverAmount = round2(lines1Sum);

        console.info('[Split Month Invoice Rollover]', {
          settlementId: header.settlementId,
          month1: m1.monthLabel,
          month2: m2.monthLabel,
          lines1Sum: round2(lines1Sum),
          rolloverAmount,
        });

        // Add Account 612 balancing line: negative of lines1Sum → invoice nets to $0
        lines1.push({
          Description: `Split month rollover to ${m2.monthLabel}`,
          AccountCode: XERO_ACCOUNT_MAP['Split Month Rollover'].code,
          TaxType: 'BASEXCLUDED',
          UnitAmount: round2(-rolloverAmount),
          Quantity: 1,
        });
        const reference1 = `Amazon AU Settlement ${header.settlementId} - Part 1 (${m1.monthLabel})`;
        const date1 = m1.end;

        // Invoice 2: DR 612 (clear rollover) + month2 proportional transactions
        const lines2Month2 = buildInvoiceLineItems(parsedLines, `${m2.monthLabel} portion`, header.settlementId, m2.ratio);
        const rolloverLine = {
          Description: `Split month rollover from ${m1.monthLabel}`,
          AccountCode: XERO_ACCOUNT_MAP['Split Month Rollover'].code,
          TaxType: 'BASEXCLUDED',
          UnitAmount: round2(rolloverAmount),
          Quantity: 1,
        };
        const invoiceLines2 = [rolloverLine, ...lines2Month2];
        const reference2 = `Amazon AU Settlement ${header.settlementId} - Part 2 (${m2.monthLabel})`;
        const date2 = m2.start;

        const { data: data1, error: err1 } = await supabase.functions.invoke('sync-amazon-journal', {
          body: { userId: user.id, reference: reference1, date: date1, dueDate: date1, lineItems: lines1, country: selectedCountry },
        });
        if (err1) throw err1;
        if (!data1?.success) throw new Error(data1?.error || 'Invoice 1 failed');

        const { data: data2, error: err2 } = await supabase.functions.invoke('sync-amazon-journal', {
          body: { userId: user.id, reference: reference2, date: date2, dueDate: date2, lineItems: invoiceLines2, country: selectedCountry },
        });
        if (err2) throw err2;
        if (!data2?.success) throw new Error(data2?.error || 'Invoice 2 failed');

        await supabase
          .from('settlements')
          .update({
            status: 'pushed_to_xero',
            xero_journal_id_1: data1.invoiceId || data1.journalId,
            xero_journal_id_2: data2.invoiceId || data2.journalId,
          } as any)
          .eq('settlement_id', header.settlementId);

        setPushed(true);
        toast.success(`Split settlement posted: ${m1.monthLabel} (${data1.invoiceId || data1.journalId}) + ${m2.monthLabel} (${data2.invoiceId || data2.journalId})`);
      } else {
        // SINGLE MONTH: Post one invoice with marketplace-aware TaxType
        const lineItems = buildInvoiceLineItems(parsedLines, period, header.settlementId, undefined, parsed.summary.bankDeposit);
        const reference = `Amazon AU Settlement ${header.settlementId}`;

        const { data, error } = await supabase.functions.invoke('sync-amazon-journal', {
          body: { userId: user.id, reference, date: header.periodEnd, dueDate: header.periodEnd, lineItems, country: selectedCountry },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Unknown error from Xero sync');

        await supabase
          .from('settlements')
          .update({ status: 'pushed_to_xero', xero_journal_id: data.invoiceId || data.journalId })
          .eq('settlement_id', header.settlementId);

        setPushed(true);
        toast.success(`Settlement posted to Xero as Invoice (AUTHORISED) ✓ (${data.invoiceId || data.journalId})`);
      }

      await loadSettlements();
    } catch (err: any) {
      toast.error(`Xero push failed: ${err.message}`);
    } finally {
      setPushing(false);
    }
  }, [parsed, selectedCountry, loadSettlements, buildInvoiceLineItems]);

  // ─── Review from History ─────────────────────────────────────────────
  const handleReviewFromHistory = useCallback(async (settlementTextId: string, settlementUuid: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Fetch the settlement record
      const { data: settData, error: settErr } = await supabase
        .from('settlements')
        .select('*')
        .eq('id', settlementUuid)
        .eq('user_id', user.id)
        .single();
      if (settErr || !settData) throw new Error(settErr?.message || 'Settlement not found');

      // 2. Fetch settlement_lines
      const { data: lineData, error: lineErr } = await supabase
        .from('settlement_lines')
        .select('*')
        .eq('settlement_id', settlementTextId)
        .eq('user_id', user.id);
      if (lineErr) throw lineErr;

      // 3. Fetch settlement_unmapped
      const { data: unmappedData, error: unmappedErr } = await supabase
        .from('settlement_unmapped')
        .select('*')
        .eq('settlement_id', settlementTextId)
        .eq('user_id', user.id);
      if (unmappedErr) throw unmappedErr;

      // 4. Reconstruct ParsedSettlement
      const s = settData as any;

      const header: ParsedSettlement['header'] = {
        settlementId: s.settlement_id,
        periodStart: s.period_start || '',
        periodEnd: s.period_end || '',
        depositDate: s.deposit_date || '',
        totalAmount: s.bank_deposit || 0,
        currency: s.currency || 'AUD',
      };

      // Two-pass LVGT detection to replicate parser's isAuMarketplace logic
      const LVGT_CATEGORIES = new Set(['Tax Collected by Amazon']);
      const intlOrderIds = new Set<string>();
      for (const l of (lineData || [])) {
        if (LVGT_CATEGORIES.has(l.accounting_category || '')) {
          const oid = (l.order_id || '').trim().replace(/\s+/g, '').toLowerCase();
          if (oid) intlOrderIds.add(oid);
        }
        // Also detect explicit non-AU marketplace
        const mn = l.marketplace_name || '';
        if (mn && mn !== 'Amazon.com.au') {
          const oid = (l.order_id || '').trim().replace(/\s+/g, '').toLowerCase();
          if (oid) intlOrderIds.add(oid);
        }
      }
      console.info('[History Reconstruction] International order-ids detected:', intlOrderIds.size);

      const reconstructedLines: ParsedSettlement['lines'] = (lineData || []).map((l: any) => {
        const mn = l.marketplace_name || 'Amazon.com.au';
        const oid = (l.order_id || '').trim().replace(/\s+/g, '').toLowerCase();
        const isExplicitNonAu = mn !== 'Amazon.com.au';
        const hasIntlOrderMatch = oid ? intlOrderIds.has(oid) : false;
        const isAu = mn === 'Amazon.com.au' && !hasIntlOrderMatch;
        return {
          transactionType: l.transaction_type || '',
          amountType: l.amount_type || '',
          amountDescription: l.amount_description || '',
          accountingCategory: l.accounting_category || '',
          amount: l.amount || 0,
          orderId: l.order_id || '',
          sku: l.sku || '',
          postedDate: l.posted_date || '',
          marketplaceName: mn,
          isAuMarketplace: isAu,
        };
      });

      const reconstructedUnmapped: ParsedSettlement['unmapped'] = (unmappedData || []).map((u: any) => ({
        transactionType: u.transaction_type || '',
        amountType: u.amount_type || '',
        amountDescription: u.amount_description || '',
        amount: u.amount || 0,
        rawRow: u.raw_row || {},
      }));

      const grossTotal = round2(
        (s.sales_principal || 0) + (s.sales_shipping || 0) + (s.promotional_discounts || 0) +
        (s.seller_fees || 0) + (s.fba_fees || 0) + (s.storage_fees || 0) +
        (s.refunds || 0) + (s.reimbursements || 0) + (s.other_fees || 0)
      );

      const summary: ParsedSettlement['summary'] = {
        salesPrincipal: s.sales_principal || 0,
        salesShipping: s.sales_shipping || 0,
        totalSales: round2((s.sales_principal || 0) + (s.sales_shipping || 0)),
        promotionalDiscounts: s.promotional_discounts || 0,
        sellerFees: s.seller_fees || 0,
        fbaFees: s.fba_fees || 0,
        storageFees: s.storage_fees || 0,
        refunds: s.refunds || 0,
        reimbursements: s.reimbursements || 0,
        otherFees: s.other_fees || 0,
        grossTotal,
        netExGst: s.net_ex_gst || 0,
        gstOnIncome: s.gst_on_income || 0,
        gstOnExpenses: s.gst_on_expenses || 0,
        bankDeposit: s.bank_deposit || 0,
        reconciliationMatch: s.reconciliation_status === 'matched',
        reconciliationDiff: round2((s.bank_deposit || 0) - grossTotal),
        debugBreakdown: [],
        auSales: round2((s.sales_principal || 0) + (s.sales_shipping || 0) - (s.international_sales || 0)),
        auFees: round2((s.seller_fees || 0) + (s.fba_fees || 0) + (s.storage_fees || 0) - (s.international_fees || 0)),
        internationalSales: s.international_sales || 0,
        internationalFees: s.international_fees || 0,
      };

      let splitMonth: ParsedSettlement['splitMonth'] = {
        isSplitMonth: false,
        month1: null,
        month2: null,
        rolloverAmount: 0,
      };
      if (s.is_split_month) {
        splitMonth = {
          isSplitMonth: true,
          month1: s.split_month_1_data ? JSON.parse(s.split_month_1_data) : null,
          month2: s.split_month_2_data ? JSON.parse(s.split_month_2_data) : null,
          rolloverAmount: s.split_rollover_amount || 0,
        };
      }

      setParsed({ header, lines: reconstructedLines, unmapped: reconstructedUnmapped, summary, splitMonth });
      setSaved(true);
      setPushed(s.status === 'pushed_to_xero');
      setActiveTab('review');
      toast.success(`Loaded settlement ${settlementTextId} for review`);
    } catch (err: any) {
      toast.error(`Failed to load settlement: ${err.message}`);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-green-600" />
            Amazon Accounting
          </h2>
          <p className="text-muted-foreground mt-1">
            Upload Amazon settlement data, reconcile transactions, and sync to Xero.
          </p>
        </div>
      </div>

      {/* Country Selector */}
      <div className="flex gap-2">
        {COUNTRIES.map((country) => (
          <button
            key={country.code}
            onClick={() => country.active && setSelectedCountry(country.code)}
            disabled={!country.active}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-sm font-medium
              ${selectedCountry === country.code
                ? 'border-green-600 bg-green-50 text-green-800 shadow-sm'
                : country.active
                  ? 'border-border bg-background text-foreground hover:bg-muted cursor-pointer'
                  : 'border-border bg-muted/50 text-muted-foreground cursor-not-allowed opacity-60'
              }`}
          >
            <span className="text-lg">{country.flag}</span>
            {country.label}
            {!country.active && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Soon</Badge>}
          </button>
        ))}
      </div>

      {selectedCountry === 'AU' ? (
        <>
          <SettlementGuidancePanel
            lastSettlement={lastSettlement}
            nextExpectedStart={nextExpectedStart}
            loading={loadingSettlements}
          />

          {uploadWarning && (
            <Card className={`border-2 ${uploadWarning.type === 'duplicate' ? 'border-amber-400 bg-amber-50/50' : 'border-orange-400 bg-orange-50/50'}`}>
              <CardContent className="py-3 flex items-start gap-3">
                <AlertTriangle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${uploadWarning.type === 'duplicate' ? 'text-amber-600' : 'text-orange-600'}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {uploadWarning.type === 'duplicate' ? '⚠ Settlement Already Uploaded' : '⚠ Settlement Gap Detected'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{uploadWarning.message}</p>
                  <div className="flex gap-2 mt-2">
                    {uploadWarning.type === 'duplicate' && (
                      <Button variant="outline" size="sm" onClick={() => { setActiveTab('history'); setUploadWarning(null); }}>
                        View Existing
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setUploadWarning(null)}>
                      Continue Anyway
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={(tab) => {
            // Stop active bulk processing when leaving upload tab, but keep files visible
            if (activeTab === 'upload' && tab !== 'upload' && bulkProcessing) {
              setBulkProcessing(false);
            }
            setActiveTab(tab);
          }}>
            <TabsList>
              <TabsTrigger value="upload" className="gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Upload
              </TabsTrigger>
              <TabsTrigger value="review" className="gap-1.5" disabled={!parsed && parsedBatch.length === 0}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Review
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-3.5 w-3.5" /> History
                {settlements.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">{settlements.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <Settings className="h-3.5 w-3.5" /> Settings
              </TabsTrigger>
            </TabsList>

            {/* UPLOAD TAB */}
            <TabsContent value="upload">
              <div className="grid gap-4 md:grid-cols-2">
              <Card className={`border-2 transition-colors ${(settlementFile || bulkFiles) ? 'border-green-400 bg-green-50/30' : 'border-dashed border-muted-foreground/25 hover:border-green-400'}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-green-600" />
                      Settlement Report (TSV)
                      {(settlementFile || bulkFiles) && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Primary data source — upload one or multiple Amazon settlement reports.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <input
                      ref={settlementInputRef}
                      type="file"
                      accept=".txt,.tsv,.csv"
                      multiple
                      onChange={handleSettlementUpload}
                      className="block w-full text-sm text-muted-foreground
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-md file:border-0
                        file:text-sm file:font-medium
                        file:bg-primary file:text-primary-foreground
                        hover:file:opacity-90 file:cursor-pointer"
                    />
                    {settlementFile && !bulkFiles && (
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-green-700 font-medium">
                          ✓ {settlementFile.name} ({(settlementFile.size / 1024).toFixed(1)} KB)
                        </p>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={clearSettlementFiles}>
                          <XCircle className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      </div>
                    )}
                    {bulkFiles && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-green-700 font-medium flex items-center gap-1">
                            <FolderUp className="h-3.5 w-3.5" />
                            {bulkFiles.length} files selected — sorted by settlement ID (oldest first)
                          </p>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={clearSettlementFiles}>
                            <XCircle className="h-3 w-3 mr-1" /> Clear all
                          </Button>
                        </div>
                        <div className="max-h-32 overflow-y-auto text-[10px] text-muted-foreground font-mono space-y-0.5">
                          {bulkFiles.map((f, i) => (
                            <div key={i}>{i + 1}. {f.name} ({(f.size / 1024).toFixed(1)} KB)</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

              </div>

              <div className="mt-4 flex gap-3">
                {/* Single file parse */}
                {settlementFile && !bulkFiles && (
                  <Button onClick={handleParse} disabled={parsing} size="lg" className="gap-2">
                    {parsing ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Parsing...</>
                    ) : (
                      <><FileSpreadsheet className="h-4 w-4" /> Parse Settlement</>
                    )}
                  </Button>
                )}
                {/* Bulk process */}
                {bulkFiles && !bulkProcessing && (
                  <Button onClick={() => {
                    setBulkProcessing(true);
                  }} size="lg" className="gap-2">
                    <FolderUp className="h-4 w-4" /> Process {bulkFiles.length} Settlements
                  </Button>
                )}
              </div>

              {/* Bulk Processing Panel */}
              {bulkFiles && bulkProcessing && (
                <div className="mt-4">
                  <BulkUploadProcessor
                    files={bulkFiles}
                    gstRate={settingsGstRate}
                    selectedCountry={selectedCountry}
                    existingSettlements={settlements}
                    onComplete={() => {
                      setBulkProcessing(false);
                      setBulkFiles(null);
                      clearSettlementFiles();
                      clearTransactionFile();
                      loadSettlements();
                      setActiveTab('history');
                    }}
                    onViewHistory={() => {
                      setBulkProcessing(false);
                      setBulkFiles(null);
                      loadSettlements();
                      setActiveTab('history');
                    }}
                    onReviewParsed={(parsedResult) => {
                      setParsed(parsedResult);
                      setParsedBatch([]);
                      setSaved(false);
                      setPushed(false);
                      setActiveTab('review');
                    }}
                    onReviewAllParsed={(allParsed) => {
                      setParsed(null);
                      setParsedBatch(allParsed.map(p => ({ parsed: p, saved: false, saving: false })));
                      setSaved(false);
                      setPushed(false);
                      setActiveTab('review');
                    }}
                  />
                </div>
              )}
            </TabsContent>

            {/* REVIEW TAB */}
            <TabsContent value="review">
              {/* Batch mode — multiple settlements */}
              {parsedBatch.length > 0 && (
                <BatchSettlementReview
                  batch={parsedBatch}
                  selectedCountry={selectedCountry}
                  onBatchUpdate={(updated) => setParsedBatch(updated)}
                  onAllSaved={() => {
                    loadSettlements();
                    clearSettlementFiles();
                    clearTransactionFile();
                    setParsedBatch([]);
                    setActiveTab('history');
                  }}
                />
              )}
              {/* Single mode */}
              {parsed && parsedBatch.length === 0 && (
                <SettlementReview
                  parsed={parsed}
                  onSave={handleSave}
                  saving={saving}
                  saved={saved}
                  onPushToXero={handlePushToXero}
                  pushing={pushing}
                  pushed={pushed}
                />
              )}
            </TabsContent>

            {/* HISTORY TAB */}
            <TabsContent value="history">
              <SettlementHistory
                settlements={settlements}
                loading={loadingSettlements}
                onDeleted={loadSettlements}
                onReview={handleReviewFromHistory}
                onPushToXero={async (settlementTextId, settlementUuid) => {
                  pendingPushRef.current = true;
                  await handleReviewFromHistory(settlementTextId, settlementUuid);
                  setActiveTab('review');
                }}
              />
            </TabsContent>

            {/* SETTINGS TAB */}
            <TabsContent value="settings">
              <div className="space-y-4">
                <XeroConnectionStatus />
                <SettlementSettings onGstRateChanged={(rate) => setSettingsGstRate(rate)} />
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">
              Support for {COUNTRIES.find(c => c.code === selectedCountry)?.label} is coming soon.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Bulk Upload Processor ────────────────────────────────────────────

type BulkFileStatus = 'pending' | 'processing' | 'parsed' | 'unmapped_warning' | 'recon_failed' | 'duplicate' | 'error' | 'saved' | 'save_error';

interface BulkFileResult {
  file: File;
  settlementId: string;
  status: BulkFileStatus;
  message?: string;
  parsed?: ParsedSettlement;
}

function BulkUploadProcessor({
  files,
  gstRate,
  selectedCountry,
  existingSettlements,
  onComplete,
  onViewHistory,
  onReviewParsed,
  onReviewAllParsed,
}: {
  files: File[];
  gstRate: number;
  selectedCountry: string;
  existingSettlements: SettlementRecord[];
  onComplete: () => void;
  onViewHistory: () => void;
  onReviewParsed: (parsed: ParsedSettlement) => void;
  onReviewAllParsed: (allParsed: ParsedSettlement[]) => void;
}) {
  const [results, setResults] = useState<BulkFileResult[]>(() =>
    files.map(f => {
      const match = f.name.match(/(\d{9,15})/);
      return { file: f, settlementId: match?.[1] || f.name, status: 'pending' as BulkFileStatus };
    })
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [done, setDone] = useState(false);
  const [failedParsed, setFailedParsed] = useState<ParsedSettlement | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const processingRef = useRef(false);

  const extractId = (name: string): string => {
    const match = name.match(/(\d{9,15})/);
    return match?.[1] || name;
  };

  const saveSettlement = async (parsed: ParsedSettlement, country: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Not authenticated' };

      const { header, summary, lines, unmapped, splitMonth } = parsed;

      const { data: existingData } = await supabase
        .from('settlements')
        .select('id')
        .eq('settlement_id', header.settlementId)
        .eq('user_id', user.id)
        .limit(1);

      if (existingData && existingData.length > 0) {
        await removeExistingSettlementForUser(user.id, header.settlementId, country);
      }

      const { error: settError } = await supabase.from('settlements').insert({
        user_id: user.id,
        settlement_id: header.settlementId,
        marketplace: country,
        period_start: header.periodStart,
        period_end: header.periodEnd,
        deposit_date: header.depositDate,
        currency: header.currency,
        sales_principal: summary.salesPrincipal,
        sales_shipping: summary.salesShipping,
        promotional_discounts: summary.promotionalDiscounts,
        seller_fees: summary.sellerFees,
        fba_fees: summary.fbaFees,
        storage_fees: summary.storageFees,
        refunds: summary.refunds,
        reimbursements: summary.reimbursements,
        other_fees: summary.otherFees,
        net_ex_gst: summary.netExGst,
        gst_on_income: summary.gstOnIncome,
        gst_on_expenses: summary.gstOnExpenses,
        bank_deposit: summary.bankDeposit,
        reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
        status: 'saved',
        is_split_month: splitMonth.isSplitMonth,
        split_month_1_start: splitMonth.month1?.start || null,
        split_month_1_end: splitMonth.month1?.end || null,
        split_month_1_ratio: splitMonth.month1?.ratio || null,
        split_month_2_start: splitMonth.month2?.start || null,
        split_month_2_end: splitMonth.month2?.end || null,
        split_month_2_ratio: splitMonth.month2?.ratio || null,
        split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
        split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
        international_sales: summary.internationalSales,
        international_fees: summary.internationalFees,
        split_rollover_amount: splitMonth.rolloverAmount || 0,
        parser_version: PARSER_VERSION,
      } as any);
      if (settError) throw settError;

      if (lines.length > 0) {
        const lineRows = lines.map(l => ({
          user_id: user.id,
          settlement_id: header.settlementId,
          transaction_type: l.transactionType,
          amount_type: l.amountType,
          amount_description: l.amountDescription,
          accounting_category: l.accountingCategory,
          amount: l.amount,
          order_id: l.orderId || null,
          sku: l.sku || null,
          posted_date: l.postedDate || null,
          marketplace_name: l.marketplaceName || null,
        }));
        for (let i = 0; i < lineRows.length; i += 500) {
          const chunk = lineRows.slice(i, i + 500);
          const { error: lineErr } = await supabase.from('settlement_lines').insert(chunk);
          if (lineErr) throw lineErr;
        }
      }

      if (unmapped.length > 0) {
        const unmappedRows = unmapped.map(u => ({
          user_id: user.id,
          settlement_id: header.settlementId,
          transaction_type: u.transactionType,
          amount_type: u.amountType,
          amount_description: u.amountDescription,
          amount: u.amount,
          raw_row: u.rawRow,
        }));
        const { error: unmappedErr } = await supabase.from('settlement_unmapped').insert(unmappedRows);
        if (unmappedErr) throw unmappedErr;
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Parse-only: no auto-save
  const processNext = useCallback(async (index: number) => {
    if (index >= files.length) {
      setDone(true);
      processingRef.current = false;
      return;
    }

    processingRef.current = true;
    const file = files[index];

    setResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'processing' as BulkFileStatus } : r));

    try {
      const text = await file.text();

      const parserOpts: ParserOptions = { gstRate };
      const parsed = parseSettlementTSV(text, parserOpts);
      const existsAlready = existingSettlements.some(s => s.settlement_id === parsed.header.settlementId);

      if (!parsed.summary.reconciliationMatch) {
        setResults(prev => prev.map((r, i) => i === index ? {
          ...r, status: 'recon_failed' as BulkFileStatus,
          message: `Diff: ${formatAUD(parsed.summary.reconciliationDiff)}${existsAlready ? ' • already saved — will overwrite on save' : ''}`,
          parsed,
          settlementId: parsed.header.settlementId,
        } : r));
        setFailedParsed(parsed);
        setPaused(true);
        processingRef.current = false;
        return;
      }

      // Parsed & reconciled — store but DON'T save yet
      const hasUnmapped = parsed.unmapped.length > 0;
      setResults(prev => prev.map((r, i) => i === index ? {
        ...r,
        status: (hasUnmapped ? 'unmapped_warning' : 'parsed') as BulkFileStatus,
        message: hasUnmapped
          ? `${parsed.unmapped.length} unmapped exception(s)${existsAlready ? ' • already saved — will overwrite on save' : ''}`
          : (existsAlready ? 'Parsed fresh ✓ already saved — will overwrite on save' : 'Parsed & reconciled ✓'),
        parsed,
        settlementId: parsed.header.settlementId,
      } : r));

      setCurrentIndex(index + 1);
      setTimeout(() => processNext(index + 1), 100);
    } catch (err: any) {
      setResults(prev => prev.map((r, i) => i === index ? {
        ...r, status: 'error' as BulkFileStatus, message: err.message
      } : r));
      setCurrentIndex(index + 1);
      setTimeout(() => processNext(index + 1), 100);
    }
  }, [files, gstRate, selectedCountry, existingSettlements]);

  useEffect(() => {
    if (!processingRef.current && !done && !paused && !aborted) {
      processNext(currentIndex);
    }
  }, []);

  const handleSkip = useCallback(() => {
    setPaused(false);
    setFailedParsed(null);
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);
    processNext(nextIdx);
  }, [currentIndex, processNext]);

  const handleAbort = useCallback(() => {
    setAborted(true);
    setPaused(false);
    setDone(true);
    processingRef.current = false;
  }, []);

  const handleSaveAll = useCallback(async () => {
    const saveable = results.filter(r => (r.status === 'parsed' || r.status === 'unmapped_warning') && r.parsed);
    if (saveable.length === 0) return;
    setSavingAll(true);

    let savedCnt = 0;
    let errCnt = 0;
    for (const r of saveable) {
      if (!r.parsed) continue;
      const saveResult = await saveSettlement(r.parsed, selectedCountry);
      if (saveResult.success) {
        savedCnt++;
        setResults(prev => prev.map(pr => pr.settlementId === r.settlementId ? { ...pr, status: 'saved' as BulkFileStatus, message: 'Saved ✓' } : pr));
      } else {
        errCnt++;
        const msg = saveResult.error === 'duplicate' ? 'Already saved' : (saveResult.error || 'Save failed');
        const st: BulkFileStatus = saveResult.error === 'duplicate' ? 'duplicate' : 'save_error';
        setResults(prev => prev.map(pr => pr.settlementId === r.settlementId ? { ...pr, status: st, message: msg } : pr));
      }
    }

    setSavingAll(false);
    setSaveComplete(true);
    toast.success(`Saved ${savedCnt} settlement${savedCnt !== 1 ? 's' : ''}${errCnt > 0 ? `, ${errCnt} error(s)` : ''}`);
    // Auto-clear upload state and switch to history after a brief delay
    setTimeout(() => onComplete(), 1500);
  }, [results, selectedCountry, onComplete]);

  const parsedCount = results.filter(r => r.status === 'parsed').length;
  const unmappedCount = results.filter(r => r.status === 'unmapped_warning').length;
  const savedCount = results.filter(r => r.status === 'saved').length;
  const failedCount = results.filter(r => r.status === 'recon_failed').length;
  const duplicateCount = results.filter(r => r.status === 'duplicate').length;
  const errorCount = results.filter(r => r.status === 'error' || r.status === 'save_error').length;
  const processedCount = results.filter(r => r.status !== 'pending' && r.status !== 'processing').length;
  const progressPct = files.length > 0 ? (processedCount / files.length) * 100 : 0;
  const saveableCount = parsedCount + unmappedCount;

  const firstParsedResult = results.find(r => (r.status === 'parsed' || r.status === 'unmapped_warning') && r.parsed);

  const statusIcon = (status: BulkFileStatus) => {
    switch (status) {
      case 'parsed': return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
      case 'saved': return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'unmapped_warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'recon_failed': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'duplicate': return <span className="h-4 w-4 flex items-center justify-center text-muted-foreground text-sm">↩</span>;
      case 'error': case 'save_error': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'processing': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      default: return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  const statusLabel = (r: BulkFileResult) => {
    switch (r.status) {
      case 'parsed': return <span className="text-blue-700 font-medium">Parsed & reconciled ✓</span>;
      case 'saved': return <span className="text-green-700 font-medium">Saved ✓</span>;
      case 'unmapped_warning': return <span className="text-amber-600 font-medium">Parsed with warnings</span>;
      case 'recon_failed': return <span className="text-destructive font-semibold">RECONCILIATION FAILED</span>;
      case 'duplicate': return <span className="text-muted-foreground">Already processed — skipped</span>;
      case 'error': case 'save_error': return <span className="text-destructive">Error: {r.message}</span>;
      case 'processing': return <span className="text-primary">Processing...</span>;
      default: return <span className="text-muted-foreground">Pending</span>;
    }
  };

  return (
    <Card className="border-2 border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderUp className="h-4 w-4" />
          {done ? (saveComplete ? 'Bulk Import Saved' : 'Parsing Complete — Review Before Saving') : `Parsing ${files.length} settlements...`}
        </CardTitle>
        {!done && (
          <Progress value={progressPct} className="h-2 mt-2" />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {results.map((r, i) => (
            <div key={i} className={`flex items-center gap-3 py-1.5 px-2 rounded text-sm ${
              r.status === 'recon_failed' ? 'bg-destructive/10' :
              r.status === 'unmapped_warning' ? 'bg-amber-50' :
              r.status === 'processing' ? 'bg-primary/5' :
              r.status === 'parsed' ? 'bg-blue-50/50' :
              ''
            }`}>
              {statusIcon(r.status)}
              <span className="font-mono text-xs w-32 flex-shrink-0">{r.settlementId}</span>
              <span className="text-xs flex-1">{statusLabel(r)}</span>
              {r.parsed && (r.status === 'parsed' || r.status === 'unmapped_warning') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] gap-1"
                  onClick={() => r.parsed && onReviewParsed(r.parsed)}
                >
                  <Eye className="h-3 w-3" /> Review
                </Button>
              )}
            </div>
          ))}
        </div>

        {paused && !done && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <XCircle className="h-4 w-4" />
                Settlement {results[currentIndex]?.settlementId} failed reconciliation
              </div>
              {failedParsed && (
                <div className="text-xs space-y-1 text-muted-foreground">
                  <p>Reconciliation diff: <span className="font-mono font-medium text-destructive">{formatAUD(failedParsed.summary.reconciliationDiff)}</span></p>
                  <p>Bank deposit: <span className="font-mono">{formatAUD(failedParsed.summary.bankDeposit)}</span></p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSkip} className="gap-1.5">
                  <SkipForward className="h-3.5 w-3.5" /> Skip & Continue
                </Button>
                <Button variant="destructive" size="sm" onClick={handleAbort} className="gap-1.5">
                  <Square className="h-3.5 w-3.5" /> Abort
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {done && (
          <Card className={saveComplete ? "border-green-300 bg-green-50/30" : "border-blue-300 bg-blue-50/30"}>
            <CardContent className="py-4 space-y-2">
              <p className={`text-sm font-semibold ${saveComplete ? 'text-green-800' : 'text-blue-800'}`}>
                {aborted ? 'Bulk parsing aborted' : saveComplete ? 'All settlements saved' : `${saveableCount} settlement${saveableCount !== 1 ? 's' : ''} ready to save`}
              </p>
              <div className="text-xs space-y-0.5">
                {parsedCount > 0 && !saveComplete && (
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> {parsedCount} parsed & reconciled — ready to save</p>
                )}
                {savedCount > 0 && (
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> {savedCount} saved</p>
                )}
                {duplicateCount > 0 && (
                  <p className="flex items-center gap-2 text-muted-foreground"><span className="text-sm">↩</span> {duplicateCount} already processed — skipped</p>
                )}
                {unmappedCount > 0 && !saveComplete && (
                  <p className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> {unmappedCount} parsed with warnings — ready to save</p>
                )}
                {failedCount > 0 && (
                  <p className="flex items-center gap-2"><XCircle className="h-3.5 w-3.5 text-destructive" /> {failedCount} reconciliation failure{failedCount !== 1 ? 's' : ''}</p>
                )}
                {errorCount > 0 && (
                  <p className="flex items-center gap-2"><XCircle className="h-3.5 w-3.5 text-destructive" /> {errorCount} error{errorCount !== 1 ? 's' : ''}</p>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                {saveableCount > 0 && !saveComplete && (
                  <Button size="sm" onClick={handleSaveAll} disabled={savingAll} className="gap-1.5">
                    {savingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {savingAll ? 'Saving...' : `Save All ${saveableCount}`}
                  </Button>
                )}
                {firstParsedResult && !saveComplete && (
                  <Button variant="outline" size="sm" onClick={() => firstParsedResult.parsed && onReviewParsed(firstParsedResult.parsed)} className="gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> Review First
                  </Button>
                )}
                {saveableCount > 0 && !saveComplete && (
                  <Button variant="outline" size="sm" onClick={() => {
                    const allParsed = results
                      .filter(r => (r.status === 'parsed' || r.status === 'unmapped_warning') && r.parsed)
                      .map(r => r.parsed!);
                    onReviewAllParsed(allParsed);
                  }} className="gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> Review All {saveableCount}
                  </Button>
                )}
                {saveComplete && (
                  <Button size="sm" onClick={() => { onViewHistory(); }} className="gap-1.5">
                    <History className="h-3.5 w-3.5" /> View History
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onComplete}>
                  Done
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}



// ─── Settlement Guidance Panel ───────────────────────────────────────

function SettlementGuidancePanel({
  lastSettlement,
  nextExpectedStart,
  loading,
}: {
  lastSettlement: SettlementRecord | null;
  nextExpectedStart: string | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="border-border bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 animate-pulse" /> Loading settlement status…
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pushed_to_xero': return <Badge className="bg-green-100 text-green-800 text-[10px]">Posted to Xero ✓</Badge>;
      case 'saved': return <Badge variant="secondary" className="text-[10px]">Saved</Badge>;
      case 'pending': return <Badge variant="outline" className="text-[10px]">Pending</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  return (
    <Card className="border-border bg-muted/20">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Amazon AU Settlement Status
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Last Uploaded Settlement</p>
            {lastSettlement ? (
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {formatDisplayDate(lastSettlement.period_start)} – {formatDisplayDate(lastSettlement.period_end)}
                </p>
                <p className="text-xs text-muted-foreground font-mono">ID: {lastSettlement.settlement_id}</p>
                <div className="flex items-center gap-2">
                  {statusBadge(lastSettlement.status || 'pending')}
                  <span className="text-xs text-muted-foreground">{formatAUD(lastSettlement.bank_deposit || 0)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No settlements uploaded yet</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Next Expected Settlement</p>
            {nextExpectedStart ? (
              <div className="flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">{formatDisplayDate(nextExpectedStart)} onwards</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">Upload your first settlement to begin tracking</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Settlement History ──────────────────────────────────────────────

function SettlementHistory({ settlements, loading, onDeleted, onReview, onPushToXero }: { settlements: SettlementRecord[]; loading: boolean; onDeleted: () => void; onReview?: (settlementId: string, settlementUuid: string) => void; onPushToXero?: (settlementId: string, settlementUuid: string) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<{ settlement: SettlementRecord; scope: 'all' | 'journal_1' | 'journal_2' } | null>(null);

  const handleRollback = async (settlement: SettlementRecord, scope: 'all' | 'journal_1' | 'journal_2' = 'all') => {
    let journalIds: string[] = [];
    if (scope === 'all') {
      journalIds = [settlement.xero_journal_id, settlement.xero_journal_id_1, settlement.xero_journal_id_2].filter(Boolean) as string[];
    } else if (scope === 'journal_1' && settlement.xero_journal_id_1) {
      journalIds = [settlement.xero_journal_id_1];
    } else if (scope === 'journal_2' && settlement.xero_journal_id_2) {
      journalIds = [settlement.xero_journal_id_2];
    }
    if (journalIds.length === 0) {
      toast.error('No Xero journal to rollback');
      return;
    }
    setRollingBack(settlement.id);
    setRollbackConfirm(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('sync-amazon-journal', {
        body: { action: 'rollback', userId: user.id, settlementId: settlement.settlement_id, journalIds, rollbackScope: scope },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const scopeLabel = scope === 'all' ? '' : scope === 'journal_1' ? ' (Journal 1)' : ' (Journal 2)';
      toast.success(`Rolled back Xero journal${scopeLabel} for ${settlement.settlement_id}`);
      onDeleted(); // refresh
    } catch (err: any) {
      toast.error(`Rollback failed: ${err.message}`);
    } finally {
      setRollingBack(null);
    }
  };

  const handleDownloadAuditData = async (settlement: SettlementRecord) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch settlement_lines
      const { data: lines, error: linesErr } = await supabase
        .from('settlement_lines')
        .select('*')
        .eq('settlement_id', settlement.settlement_id)
        .eq('user_id', user.id)
        .order('posted_date', { ascending: true });
      if (linesErr) throw linesErr;

      // Fetch unmapped
      const { data: unmapped, error: unmappedErr } = await supabase
        .from('settlement_unmapped')
        .select('*')
        .eq('settlement_id', settlement.settlement_id)
        .eq('user_id', user.id);
      if (unmappedErr) throw unmappedErr;

      const headers = ['Type', 'Transaction Type', 'Amount Type', 'Amount Description', 'Accounting Category', 'Amount', 'Order ID', 'SKU', 'Marketplace', 'Posted Date'];
      const rows = [
        headers,
        ...(lines || []).map((l: any) => [
          'Mapped', l.transaction_type || '', l.amount_type || '', l.amount_description || '',
          l.accounting_category || '', String(l.amount || 0), l.order_id || '', l.sku || '',
          l.marketplace_name || '', l.posted_date || ''
        ]),
        ...(unmapped || []).map((u: any) => [
          'UNMAPPED', u.transaction_type || '', u.amount_type || '', u.amount_description || '',
          '', String(u.amount || 0), '', '', '', ''
        ]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `settlement-${settlement.settlement_id}-audit.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded audit data (${(lines?.length || 0) + (unmapped?.length || 0)} rows)`);
    } catch (err: any) {
      toast.error(`Failed to download audit data: ${err.message}`);
    }
  };

  const handleDownloadEntry = (settlement: SettlementRecord) => {
    const rows = [
      ['Description', 'Account Code', 'Net Amount', 'Tax', 'Gross'],
      ['Sales - Principal', '200', String(settlement.sales_principal || 0), '', ''],
      ['Sales - Shipping', '200', String(settlement.sales_shipping || 0), '', ''],
      ['Promotional Discounts', '200', String(settlement.promotional_discounts || 0), '', ''],
      ['Seller Fees', '407', String(settlement.seller_fees || 0), '', ''],
      ['FBA Fees', '408', String(settlement.fba_fees || 0), '', ''],
      ['Storage Fees', '409', String(settlement.storage_fees || 0), '', ''],
      ['Refunds', '200', String(settlement.refunds || 0), '', ''],
      ['Reimbursements', '200', String(settlement.reimbursements || 0), '', ''],
      ['GST on Income', '', String(settlement.gst_on_income || 0), '', ''],
      ['GST on Expenses', '', String(settlement.gst_on_expenses || 0), '', ''],
      ['Bank Deposit', '801', String(settlement.bank_deposit || 0), '', ''],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement-${settlement.settlement_id}-entry.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteOne = async (settlement: SettlementRecord) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('settlement_lines').delete().eq('settlement_id', settlement.settlement_id).eq('user_id', user.id);
      await supabase.from('settlement_unmapped').delete().eq('settlement_id', settlement.settlement_id).eq('user_id', user.id);
      const { error } = await supabase.from('settlements').delete().eq('id', settlement.id).eq('user_id', user.id);
      if (error) throw error;
      toast.success(`Deleted settlement ${settlement.settlement_id}`);
      onDeleted();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const getXeroDeepLink = (invoiceId: string) => {
    return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${invoiceId}`;
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === settlements.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(settlements.map(s => s.id)));
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get settlement_ids (text) for the selected rows
      const selectedSettlements = settlements.filter(s => selectedIds.has(s.id));
      const settlementTextIds = selectedSettlements.map(s => s.settlement_id);

      // Delete related lines and unmapped first, then settlements
      for (const sid of settlementTextIds) {
        await supabase.from('settlement_lines').delete().eq('settlement_id', sid).eq('user_id', user.id);
        await supabase.from('settlement_unmapped').delete().eq('settlement_id', sid).eq('user_id', user.id);
      }

      // Delete settlement records by UUID
      const uuids = Array.from(selectedIds);
      for (const uuid of uuids) {
        const { error } = await supabase.from('settlements').delete().eq('id', uuid).eq('user_id', user.id);
        if (error) throw error;
      }

      toast.success(`Deleted ${selectedIds.size} settlement${selectedIds.size !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      setConfirmDelete(false);
      onDeleted();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2 animate-pulse" />
          <p className="text-muted-foreground text-sm">Loading settlements…</p>
        </CardContent>
      </Card>
    );
  }

  if (settlements.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <History className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">No settlements uploaded yet. Upload your first settlement to begin.</p>
        </CardContent>
      </Card>
    );
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pushed_to_xero': return <Badge className="bg-emerald-600 text-white border-emerald-600 text-[10px]">Posted ✓</Badge>;
      case 'voided': return <Badge variant="destructive" className="text-[10px]">Voided</Badge>;
      case 'saved': return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">Saved</Badge>;
      case 'pending': return <Badge variant="outline" className="text-[10px] text-muted-foreground">Unsaved</Badge>;
      case 'reconciliation_failed': return <Badge variant="destructive" className="text-[10px]">Recon Failed</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  // Sequence numbering: sort by period_end ascending
  const sorted = [...settlements].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const seqMap = new Map<string, number>();
  sorted.forEach((s, i) => seqMap.set(s.id, i + 1));

  // Build display rows (desc order) with gap indicators
  type DisplayRow =
    | { type: 'settlement'; settlement: SettlementRecord; seq: number }
    | { type: 'gap'; afterDate: string; beforeDate: string };

  const displayRows: DisplayRow[] = [];
  for (let i = 0; i < settlements.length; i++) {
    const s = settlements[i];
    const seq = seqMap.get(s.id) || 0;
    displayRows.push({ type: 'settlement', settlement: s, seq });

    if (i < settlements.length - 1) {
      const next = settlements[i + 1]; // next is older (sorted newest first)
      if (s.period_start > next.period_end) {
        displayRows.push({ type: 'gap', afterDate: next.period_end, beforeDate: s.period_start });
      }
    }
  }

  const allSelected = selectedIds.size === settlements.length;
  const someSelected = selectedIds.size > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Settlement History</CardTitle>
            <CardDescription className="text-xs">
              {settlements.length} settlement{settlements.length !== 1 ? 's' : ''} uploaded.
              {someSelected && ` ${selectedIds.size} selected.`}
            </CardDescription>
          </div>
          {someSelected && !confirmDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="gap-1.5"
            >
              <XCircle className="h-3.5 w-3.5" />
              Delete {selectedIds.size === settlements.length ? 'All' : selectedIds.size}
            </Button>
          )}
          {confirmDelete && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive font-medium">
                Delete {selectedIds.size} settlement{selectedIds.size !== 1 ? 's' : ''}?
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="gap-1.5"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {deleting ? 'Deleting…' : 'Confirm'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="py-2 px-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-muted-foreground/40 h-3.5 w-3.5 cursor-pointer"
                  />
                </th>
                <th className="py-2 px-2 font-medium w-12 text-center">Seq</th>
                <th className="py-2 px-4 font-medium">Period</th>
                <th className="py-2 px-4 font-medium text-right">Sales</th>
                <th className="py-2 px-4 font-medium text-right">Fees</th>
                <th className="py-2 px-4 font-medium text-right">Refunds</th>
                <th className="py-2 px-4 font-medium text-right">Net</th>
                <th className="py-2 px-4 font-medium text-right">Deposit</th>
                <th className="py-2 px-4 font-medium">Status</th>
                <th className="py-2 px-2 font-medium w-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, idx) => {
                if (row.type === 'gap') {
                  return (
                    <tr key={`gap-${idx}`} className="border-b bg-amber-50/60">
                      <td colSpan={10} className="py-1.5 px-4">
                        <div className="flex items-center gap-2 text-xs text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="font-medium">⚠ Missing settlement(s)</span>
                          <span className="text-muted-foreground">
                            between {formatDisplayDate(row.afterDate)} and {formatDisplayDate(row.beforeDate)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const s = row.settlement;
                const isSelected = selectedIds.has(s.id);
                return (
                  <React.Fragment key={s.id}>
                    <tr
                      className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    >
                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(s.id)}
                          className="rounded border-muted-foreground/40 h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">{row.seq}</span>
                      </td>
                      <td className="py-2 px-4">
                        <div className="font-medium text-xs flex items-center gap-1">
                          {formatDisplayDate(s.period_start)} – {formatDisplayDate(s.period_end)}
                          {(s as any).is_split_month && <Scissors className="h-3 w-3 text-purple-600 inline" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">{s.settlement_id}</div>
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-green-700">
                        {formatAUD((s.sales_principal || 0) + (s.sales_shipping || 0))}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-red-600">
                        {formatAUD((s.seller_fees || 0) + (s.fba_fees || 0) + (s.storage_fees || 0))}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-amber-600">
                        {formatAUD(s.refunds || 0)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono">
                        {formatAUD(s.net_ex_gst || 0)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono font-semibold">
                        {formatAUD(s.bank_deposit || 0)}
                      </td>
                      <td className="py-2 px-4">
                        {statusBadge(s.status || 'pending')}
                        {(s as any).is_split_month && <Badge className="bg-purple-100 text-purple-800 text-[10px] ml-1">Split</Badge>}
                      </td>
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {/* View — always shown */}
                            {onReview && (
                              <DropdownMenuItem onClick={() => onReview(s.settlement_id, s.id)}>
                                <Eye className="h-3.5 w-3.5 mr-2" /> View
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleDownloadEntry(s)}>
                              <Download className="h-3.5 w-3.5 mr-2" /> Download Entry
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownloadAuditData(s)}>
                              <FileText className="h-3.5 w-3.5 mr-2" /> Download Audit Data
                            </DropdownMenuItem>

                            {/* Saved: Push to Xero + Delete */}
                            {s.status === 'saved' && (
                              <>
                                <DropdownMenuSeparator />
                                {onPushToXero && (
                                  <DropdownMenuItem onClick={() => onPushToXero(s.settlement_id, s.id)}>
                                    <ExternalLink className="h-3.5 w-3.5 mr-2" /> Push to Xero
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteOne(s)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}

                            {/* Posted: View in Xero + Rollback */}
                            {s.status === 'pushed_to_xero' && (
                              <>
                                <DropdownMenuSeparator />
                                {(() => {
                                  const journalIds = [s.xero_journal_id, s.xero_journal_id_1, s.xero_journal_id_2].filter(Boolean) as string[];
                                  return journalIds.map((jId, jIdx) => (
                                    <DropdownMenuItem key={jId} asChild>
                                      <a href={getXeroDeepLink(jId)} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                        View in Xero{journalIds.length > 1 ? ` (Journal ${jIdx + 1})` : ''}
                                      </a>
                                    </DropdownMenuItem>
                                  ));
                                })()}
                                <DropdownMenuSeparator />
                                {/* Rollback Entire Settlement */}
                                <DropdownMenuItem
                                  onClick={() => setRollbackConfirm({ settlement: s, scope: 'all' })}
                                  disabled={rollingBack === s.id}
                                  className="text-amber-700 focus:text-amber-700"
                                >
                                  {rollingBack === s.id ? (
                                    <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Rolling back…</>
                                  ) : (
                                    <><Undo2 className="h-3.5 w-3.5 mr-2" /> Rollback Entire Settlement</>
                                  )}
                                </DropdownMenuItem>
                                {/* Individual journal rollback for split-month */}
                                {(s as any).is_split_month && s.xero_journal_id_1 && (
                                  <DropdownMenuItem
                                    onClick={() => setRollbackConfirm({ settlement: s, scope: 'journal_1' })}
                                    disabled={rollingBack === s.id}
                                    className="text-amber-700 focus:text-amber-700"
                                  >
                                    <Undo2 className="h-3.5 w-3.5 mr-2" /> Rollback Journal 1
                                  </DropdownMenuItem>
                                )}
                                {(s as any).is_split_month && s.xero_journal_id_2 && (
                                  <DropdownMenuItem
                                    onClick={() => setRollbackConfirm({ settlement: s, scope: 'journal_2' })}
                                    disabled={rollingBack === s.id}
                                    className="text-amber-700 focus:text-amber-700"
                                  >
                                    <Undo2 className="h-3.5 w-3.5 mr-2" /> Rollback Journal 2
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}

                            {/* Voided: Delete only */}
                            {s.status === 'voided' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteOne(s)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr>
                        <td colSpan={10} className="bg-muted/20 px-6 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><span className="text-muted-foreground">Principal Sales:</span> <span className="font-mono">{formatAUD(s.sales_principal || 0)}</span></div>
                            <div><span className="text-muted-foreground">Shipping Sales:</span> <span className="font-mono">{formatAUD(s.sales_shipping || 0)}</span></div>
                            <div><span className="text-muted-foreground">Promo Discounts:</span> <span className="font-mono">{formatAUD(s.promotional_discounts || 0)}</span></div>
                            <div><span className="text-muted-foreground">Seller Fees:</span> <span className="font-mono">{formatAUD(s.seller_fees || 0)}</span></div>
                            <div><span className="text-muted-foreground">FBA Fees:</span> <span className="font-mono">{formatAUD(s.fba_fees || 0)}</span></div>
                            <div><span className="text-muted-foreground">Storage Fees:</span> <span className="font-mono">{formatAUD(s.storage_fees || 0)}</span></div>
                            <div><span className="text-muted-foreground">Refunds:</span> <span className="font-mono">{formatAUD(s.refunds || 0)}</span></div>
                            <div><span className="text-muted-foreground">Reimbursements:</span> <span className="font-mono">{formatAUD(s.reimbursements || 0)}</span></div>
                            <div><span className="text-muted-foreground">GST Income:</span> <span className="font-mono">{formatAUD(s.gst_on_income || 0)}</span></div>
                            <div><span className="text-muted-foreground">GST Expenses:</span> <span className="font-mono">{formatAUD(s.gst_on_expenses || 0)}</span></div>
                            <div><span className="text-muted-foreground">Parser version:</span> <span className="font-mono ml-1">{(s as any).parser_version || '—'}</span></div>
                          </div>
                          {s.xero_journal_id && !s.is_split_month && (
                            <p className="text-[10px] text-muted-foreground mt-2 font-mono">Xero Invoice: {s.xero_journal_id}</p>
                          )}
                          {s.is_split_month && (
                            <div className="mt-3 pt-2 border-t border-purple-200 space-y-2">
                              <p className="text-xs font-medium text-purple-800 flex items-center gap-1">
                                <Scissors className="h-3 w-3" /> Split Month Journals (Account 612 Rollover)
                              </p>
                              {(() => {
                                const m1 = s.split_month_1_data ? JSON.parse(s.split_month_1_data as string) : null;
                                const m2 = s.split_month_2_data ? JSON.parse(s.split_month_2_data as string) : null;
                                const rollover = (s as any).split_rollover_amount || 0;
                                return (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                    {m1 && (
                                      <div className="p-2 rounded bg-purple-50/50 border border-purple-100">
                                        <p className="font-medium">Journal 1 ({formatDisplayDate(m1.end)}) — nets to $0.00</p>
                                        <p className="font-mono">All transactions at full amounts</p>
                                        <p className="font-mono text-purple-700">Rollover to 612: {formatAUD(-rollover)}</p>
                                        {(s as any).xero_journal_id_1 && <p className="font-mono text-[10px] text-muted-foreground">Journal: {(s as any).xero_journal_id_1}</p>}
                                      </div>
                                    )}
                                    {m2 && (
                                      <div className="p-2 rounded bg-purple-50/50 border border-purple-100">
                                        <p className="font-medium">Journal 2 ({formatDisplayDate(m2.start)}) — nets to {formatAUD(s.bank_deposit)}</p>
                                        <p className="font-mono text-purple-700">Rollover from 612: {formatAUD(rollover)}</p>
                                        <p className="font-mono">{m2.monthLabel} transactions ({Math.round(m2.ratio * 100)}% by days)</p>
                                        {(s as any).xero_journal_id_2 && <p className="font-mono text-[10px] text-muted-foreground">Journal: {(s as any).xero_journal_id_2}</p>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Rollback Confirmation Dialog */}
      {rollbackConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setRollbackConfirm(null)}>
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground">
              {rollbackConfirm.scope === 'all' ? 'Rollback Entire Settlement?' : `Rollback ${rollbackConfirm.scope === 'journal_1' ? 'Journal 1' : 'Journal 2'}?`}
            </h3>
            <p className="text-sm text-muted-foreground">
              {rollbackConfirm.scope === 'all' ? (
                <>This will <strong>void</strong> {rollbackConfirm.settlement.is_split_month ? 'both split month invoices' : 'the Xero invoice'} for settlement <span className="font-mono">{rollbackConfirm.settlement.settlement_id}</span> and reset the status to "Saved".</>
              ) : (
                <>This will <strong>void</strong> only {rollbackConfirm.scope === 'journal_1' ? 'Invoice 1 (Month 1)' : 'Invoice 2 (Month 2)'} for settlement <span className="font-mono">{rollbackConfirm.settlement.settlement_id}</span>. The other invoice will remain posted.</>
              )}
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
              ⚠ This action cannot be undone in Xero. The voided invoice will remain visible in Xero's history but will have no financial effect.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRollbackConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleRollback(rollbackConfirm.settlement, rollbackConfirm.scope)}
                disabled={rollingBack === rollbackConfirm.settlement.id}
                className="gap-1.5"
              >
                {rollingBack === rollbackConfirm.settlement.id ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Voiding…</>
                ) : (
                  <><Undo2 className="h-3.5 w-3.5" /> Void & Rollback</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Batch Settlement Review ─────────────────────────────────────────

function BatchSettlementReview({
  batch,
  selectedCountry,
  onBatchUpdate,
  onAllSaved,
}: {
  batch: Array<{ parsed: ParsedSettlement; saved: boolean; saving: boolean }>;
  selectedCountry: string;
  onBatchUpdate: (updated: Array<{ parsed: ParsedSettlement; saved: boolean; saving: boolean }>) => void;
  onAllSaved: () => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const saveOne = async (index: number) => {
    const item = batch[index];
    if (item.saved || !item.parsed.summary.reconciliationMatch) return;

    const updated = [...batch];
    updated[index] = { ...updated[index], saving: true };
    onBatchUpdate(updated);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { header, summary, lines, unmapped, splitMonth } = item.parsed;

      // Duplicate check: overwrite existing with fresh parse
      const { data: existingData } = await supabase
        .from('settlements')
        .select('id')
        .eq('settlement_id', header.settlementId)
        .eq('user_id', user.id)
        .limit(1);

      if (existingData && existingData.length > 0) {
        await removeExistingSettlementForUser(user.id, header.settlementId, selectedCountry);
        toast.warning(`Settlement ${header.settlementId} already saved. Overwriting with freshly parsed data.`);
      }

      await supabase.from('settlements').insert({
        user_id: user.id,
        settlement_id: header.settlementId,
        marketplace: selectedCountry,
        period_start: header.periodStart,
        period_end: header.periodEnd,
        deposit_date: header.depositDate,
        currency: header.currency,
        sales_principal: summary.salesPrincipal,
        sales_shipping: summary.salesShipping,
        promotional_discounts: summary.promotionalDiscounts,
        seller_fees: summary.sellerFees,
        fba_fees: summary.fbaFees,
        storage_fees: summary.storageFees,
        refunds: summary.refunds,
        reimbursements: summary.reimbursements,
        other_fees: summary.otherFees,
        net_ex_gst: summary.netExGst,
        gst_on_income: summary.gstOnIncome,
        gst_on_expenses: summary.gstOnExpenses,
        bank_deposit: summary.bankDeposit,
        reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
        status: 'saved',
        is_split_month: splitMonth.isSplitMonth,
        split_month_1_start: splitMonth.month1?.start || null,
        split_month_1_end: splitMonth.month1?.end || null,
        split_month_1_ratio: splitMonth.month1?.ratio || null,
        split_month_2_start: splitMonth.month2?.start || null,
        split_month_2_end: splitMonth.month2?.end || null,
        split_month_2_ratio: splitMonth.month2?.ratio || null,
        split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
        split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
        international_sales: summary.internationalSales,
        international_fees: summary.internationalFees,
        split_rollover_amount: splitMonth.rolloverAmount || 0,
        parser_version: PARSER_VERSION,
      } as any);

      if (lines.length > 0) {
        const lineRows = lines.map(l => ({
          user_id: user.id,
          settlement_id: header.settlementId,
          transaction_type: l.transactionType,
          amount_type: l.amountType,
          amount_description: l.amountDescription,
          accounting_category: l.accountingCategory,
          amount: l.amount,
          order_id: l.orderId || null,
          sku: l.sku || null,
          posted_date: l.postedDate || null,
          marketplace_name: l.marketplaceName || null,
        }));
        for (let i = 0; i < lineRows.length; i += 500) {
          const chunk = lineRows.slice(i, i + 500);
          await supabase.from('settlement_lines').insert(chunk);
        }
      }

      if (unmapped.length > 0) {
        const unmappedRows = unmapped.map(u => ({
          user_id: user.id,
          settlement_id: header.settlementId,
          transaction_type: u.transactionType,
          amount_type: u.amountType,
          amount_description: u.amountDescription,
          amount: u.amount,
          raw_row: u.rawRow,
        }));
        await supabase.from('settlement_unmapped').insert(unmappedRows);
      }

      const u2 = [...batch];
      u2[index] = { ...u2[index], saving: false, saved: true };
      onBatchUpdate(u2);
      toast.success(`Settlement ${header.settlementId} saved ✓`);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
      const u2 = [...batch];
      u2[index] = { ...u2[index], saving: false };
      onBatchUpdate(u2);
    }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    let saved = 0;
    for (let i = 0; i < batch.length; i++) {
      if (!batch[i].saved && batch[i].parsed.summary.reconciliationMatch) {
        await saveOne(i);
        saved++;
      }
    }
    setSavingAll(false);
    if (saved > 0) onAllSaved();
  };

  const unsavedCount = batch.filter(b => !b.saved && b.parsed.summary.reconciliationMatch).length;
  const savedCount = batch.filter(b => b.saved).length;
  const allSaved = savedCount === batch.length;

  return (
    <div className="space-y-4">
      {/* Batch summary bar */}
      <Card className="border-2 border-primary/20">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{batch.length} Settlements for Review</h3>
              <p className="text-sm text-muted-foreground">
                {savedCount} saved • {unsavedCount} pending • Click to expand details
              </p>
            </div>
            <div className="flex gap-2">
              {unsavedCount > 0 && (
                <Button onClick={handleSaveAll} disabled={savingAll} className="gap-2">
                  {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingAll ? 'Saving...' : `Save All ${unsavedCount}`}
                </Button>
              )}
              {allSaved && (
                <Badge className="bg-green-100 text-green-800 text-sm px-3 py-1.5 gap-1">
                  <CheckCircle2 className="h-4 w-4" /> All Saved ✓
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settlement list */}
      <div className="space-y-2">
        {batch.map((item, index) => {
          const { parsed: p } = item;
          const isExpanded = expandedIndex === index;

          return (
            <Card key={p.header.settlementId} className={`transition-all ${item.saved ? 'border-green-200 bg-green-50/20' : 'border-border'}`}>
              {/* Clickable summary row */}
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
              >
                <div className="flex-shrink-0">
                  {item.saved ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : item.saving ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : p.summary.reconciliationMatch ? (
                    <div className="h-5 w-5 rounded-full border-2 border-primary/40" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm font-medium">{p.header.settlementId}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDisplayDate(p.header.periodStart)} – {formatDisplayDate(p.header.periodEnd)}
                    </span>
                    {p.splitMonth.isSplitMonth && (
                      <Badge className="bg-purple-100 text-purple-800 text-[10px]"><Scissors className="h-3 w-3 mr-0.5" />Split</Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Deposit</p>
                    <p className="font-mono font-semibold text-sm">{formatAUD(p.summary.bankDeposit)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">GST Income</p>
                    <p className="font-mono text-sm">{formatAUD(p.summary.gstOnIncome)}</p>
                  </div>
                  {p.summary.reconciliationMatch ? (
                    <Badge className="bg-green-100 text-green-800 text-[10px]">Reconciled ✓</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">Failed</Badge>
                  )}
                  {item.saved ? (
                    <Badge variant="secondary" className="text-[10px]">Saved</Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={item.saving || !p.summary.reconciliationMatch}
                      onClick={(e) => { e.stopPropagation(); saveOne(index); }}
                    >
                      {item.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      Save
                    </Button>
                  )}
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t px-4 py-4">
                  <SettlementReview
                    parsed={p}
                    onSave={() => saveOne(index)}
                    saving={item.saving}
                    saved={item.saved}
                    onPushToXero={() => {}}
                    pushing={false}
                    pushed={false}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Bottom save all bar */}
      {unsavedCount > 0 && (
        <Card className="border-2 border-primary/20 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{unsavedCount} settlement{unsavedCount !== 1 ? 's' : ''} ready to save</p>
              <Button onClick={handleSaveAll} disabled={savingAll} className="gap-2">
                {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingAll ? 'Saving...' : `Save All ${unsavedCount}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Review Component (Link My Books style) ─────────────────────────

function SettlementReview({
  parsed,
  onSave,
  saving,
  saved,
  onPushToXero,
  pushing,
  pushed,
}: {
  parsed: ParsedSettlement;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  onPushToXero: () => void;
  pushing: boolean;
  pushed: boolean;
}) {
  const { header, summary, unmapped, lines, splitMonth } = parsed;
  const [showLineItems, setShowLineItems] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);

  // Build Xero journal preview lines (same logic as handlePushToXero)
  const journalPreviewLines = useMemo(() => {
    const INCOME_CATS = new Set(['Sales - Principal', 'Sales - Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements']);
    const TAX_SUBCAT_MAP: Record<string, string> = {
      'Tax': 'Tax',
      'ShippingTax': 'Shipping Tax',
      'TaxDiscount': 'Tax Discounts',
      'LowValueGoodsTax-Principal': 'Low Value Goods Tax',
      'LowValueGoodsTax-Shipping': 'Low Value Goods Tax',
    };
    const auBuckets: Record<string, number> = {};
    const intlBuckets: Record<string, number> = {};
    const expenseBuckets: Record<string, number> = {};
    const otherBuckets: Record<string, number> = {};
    const taxSubBuckets: Record<string, number> = {};

    for (const line of lines) {
      let cat = line.accountingCategory;
      if (cat === 'Sales') {
        cat = line.amountDescription === 'Shipping' ? 'Sales - Shipping' : 'Sales - Principal';
      }
      if (cat === 'Tax Collected by Amazon') {
        const subName = TAX_SUBCAT_MAP[line.amountDescription] || line.amountDescription;
        const key = `Amazon Sales Tax - ${subName}`;
        taxSubBuckets[key] = (taxSubBuckets[key] || 0) + line.amount;
        continue;
      }
      if (INCOME_CATS.has(cat)) {
        if (line.isAuMarketplace) {
          auBuckets[cat] = (auBuckets[cat] || 0) + line.amount;
        } else {
          intlBuckets[cat] = (intlBuckets[cat] || 0) + line.amount;
        }
      } else if (['Seller Fees', 'FBA Fees', 'Storage Fees'].includes(cat)) {
        expenseBuckets[cat] = (expenseBuckets[cat] || 0) + line.amount;
      } else {
        otherBuckets[cat] = (otherBuckets[cat] || 0) + line.amount;
      }
    }

    const gstRate = 10;
    const journalRows: Array<{
      description: string;
      accountCode: string;
      accountName: string;
      taxRate: string;
      netAmount: number;
      taxAmount: number;
      grossAmount: number;
    }> = [];

    // Helper: determine tax label and compute GST
    const getTaxInfo = (cat: string, marketplace: 'au' | 'intl'): { taxRate: string; hasGst: boolean } => {
      if (cat === 'Reimbursements') return { taxRate: 'GST on Income', hasGst: true };
      if (marketplace === 'intl') return { taxRate: 'GST Free Income', hasGst: false };
      // AU Sales (Principal/Shipping), Refunds, Promotional Discounts → GST on Income
      if (cat === 'Sales - Principal' || cat === 'Sales - Shipping' || cat === 'Refunds' || cat === 'Promotional Discounts') {
        return { taxRate: 'GST on Income', hasGst: true };
      }
      // Fallback for any other AU income category
      return { taxRate: 'BAS Excluded', hasGst: false };
    };

    const getMapForCat = (cat: string) => {
      if (cat === 'Sales - Principal' || cat === 'Sales - Shipping') return XERO_ACCOUNT_MAP['Sales'] || { code: '200', name: 'Amazon Sales AU' };
      return XERO_ACCOUNT_MAP[cat] || { code: '000', name: cat };
    };

    // AU income lines
    for (const [category, amount] of Object.entries(auBuckets)) {
      const a = round2(amount);
      if (a === 0) continue;
      const map = getMapForCat(category);
      const { taxRate, hasGst } = getTaxInfo(category, 'au');
      const taxAmt = hasGst ? round2(a / 11) : 0;
      const netAmt = round2(a - taxAmt);
      journalRows.push({
        description: `Amazon ${category} - Australia`,
        accountCode: map.code,
        accountName: `${map.code}: ${map.name}`,
        taxRate,
        netAmount: netAmt,
        taxAmount: taxAmt,
        grossAmount: a,
      });
    }

    // International income lines
    for (const [category, amount] of Object.entries(intlBuckets)) {
      const a = round2(amount);
      if (a === 0) continue;
      const map = getMapForCat(category);
      const { taxRate } = getTaxInfo(category, 'intl');
      journalRows.push({
        description: `Amazon ${category} - Rest of the World`,
        accountCode: map.code,
        accountName: `${map.code}: ${map.name}`,
        taxRate,
        netAmount: a,
        taxAmount: 0,
        grossAmount: a,
      });
    }

    // Expense lines → GST on Expenses
    for (const [category, amount] of Object.entries(expenseBuckets)) {
      const a = round2(amount);
      if (a === 0) continue;
      const map = XERO_ACCOUNT_MAP[category] || { code: '000', name: category };
      const taxAmt = round2(a / 11);
      journalRows.push({
        description: `Amazon ${category}`,
        accountCode: map.code,
        accountName: `${map.code}: ${map.name}`,
        taxRate: 'GST on Expenses',
        netAmount: round2(a - taxAmt),
        taxAmount: taxAmt,
        grossAmount: a,
      });
    }

    // Other lines (Tax Collected, etc.)
    for (const [category, amount] of Object.entries(otherBuckets)) {
      const a = round2(amount);
      if (a === 0) continue;
      const map = XERO_ACCOUNT_MAP[category] || { code: '000', name: category };
      journalRows.push({
        description: `Amazon ${category}`,
        accountCode: map.code,
        accountName: `${map.code}: ${map.name}`,
        taxRate: 'BAS Excluded',
        netAmount: a,
        taxAmount: 0,
        grossAmount: a,
      });
    }

    // Tax sub-lines (824) — each sub-category as separate BAS Excluded line
    const taxMap = XERO_ACCOUNT_MAP['Tax Collected by Amazon'] || { code: '824', name: 'Amazon Sales Tax AU' };
    for (const [description, amount] of Object.entries(taxSubBuckets)) {
      const a = round2(amount);
      if (a === 0) continue;
      journalRows.push({
        description,
        accountCode: taxMap.code,
        accountName: `${taxMap.code}: ${taxMap.name}`,
        taxRate: 'BAS Excluded',
        netAmount: a,
        taxAmount: 0,
        grossAmount: a,
      });
    }

    // NO clearing line — invoices don't need one

    return journalRows;
  }, [lines, header.settlementId]);

  // CSV download helpers
  const downloadCSV = (filename: string, csvContent: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadEntry = () => {
    const rows = [
      ['Description', 'Account Code', 'Account Name', 'Tax Rate', 'Net Amount', 'Tax Amount', 'Gross Amount'],
      ...journalPreviewLines.map(r => [
        r.description, r.accountCode, r.accountName, r.taxRate,
        r.netAmount.toFixed(2), r.taxAmount.toFixed(2), r.grossAmount.toFixed(2)
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    downloadCSV(`settlement-${header.settlementId}-journal.csv`, csv);
    setShowDownloadMenu(false);
  };

  const handleDownloadAuditData = () => {
    // Full line items export
    const rows = [
      ['Category', 'Transaction Type', 'Amount Type', 'Description', 'Order ID', 'SKU', 'Marketplace', 'AU?', 'Amount'],
      ...lines.map(l => [
        l.accountingCategory, l.transactionType, l.amountType, l.amountDescription,
        l.orderId, l.sku, l.marketplaceName || '', l.isAuMarketplace ? 'Y' : 'N',
        l.amount.toFixed(2)
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    downloadCSV(`settlement-${header.settlementId}-audit.csv`, csv);
    setShowDownloadMenu(false);
  };

  const invoiceTotal = round2(summary.grossTotal);

  return (
    <div className="space-y-4">
      {/* LMB-style Compact Header Bar */}
      <Card className="border-2 border-primary/20">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Contact</p>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <span className="text-lg">🅰</span> Amazon.com.au
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Currency</p>
              <p className="text-sm font-medium">{header.currency}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Entry Date</p>
              <p className="text-sm font-medium">{formatDisplayDate(header.depositDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Period Covered</p>
              <p className="text-sm font-medium">{formatDisplayDate(header.periodStart)} – {formatDisplayDate(header.periodEnd)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Status</p>
              <div className="flex items-center gap-1.5">
                {saved ? (
                  pushed ? (
                    <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Sent to Xero</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Saved</Badge>
                  )
                ) : (
                  <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 bg-amber-50">Unsaved — Review</Badge>
                )}
              </div>
            </div>
            <div className="ml-auto">
              <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Bank Deposit</p>
              <p className="text-lg font-bold font-mono">AU {formatAUD(summary.bankDeposit)}</p>
            </div>
          </div>

          {/* Reconciliation badge */}
          <div className="mt-3 flex items-center gap-3">
            {summary.reconciliationMatch ? (
              <Badge className="bg-green-100 text-green-800 gap-1">
                <CheckCircle2 className="h-3 w-3" /> Reconciled ✓
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" /> RECONCILIATION FAILED — Diff: {formatAUD(summary.reconciliationDiff)}
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground font-mono">Settlement ID: {header.settlementId} • Parser {PARSER_VERSION}</span>
          </div>
        </CardContent>
      </Card>

      {/* Split Month Warning */}
      {splitMonth.isSplitMonth && splitMonth.month1 && splitMonth.month2 && (
        <Card className="border-2 border-purple-400 bg-purple-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-purple-800">
              <Scissors className="h-4 w-4" />
              ⚠ Split Month Settlement — {formatDisplayDate(header.periodStart)} to {formatDisplayDate(header.periodEnd)}
            </CardTitle>
            <CardDescription className="text-xs">
              Uses Account 612 (Split Month Rollovers) to match Link My Books method. Journal 1 nets to $0, Journal 2 nets to full deposit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 p-3 rounded-lg bg-background border border-purple-200">
                <h4 className="font-semibold text-sm text-purple-800">
                  Journal 1 ({formatDisplayDate(splitMonth.month1.end)}) — nets to $0.00
                </h4>
                <div className="space-y-0.5 text-xs">
                  <div className="flex justify-between"><span>Sales:</span><span className="font-mono text-green-700">{formatAUD(summary.totalSales)}</span></div>
                  <div className="flex justify-between"><span>Fees:</span><span className="font-mono text-red-600">{formatAUD(summary.sellerFees + summary.fbaFees + summary.storageFees)}</span></div>
                  <div className="flex justify-between"><span>Refunds:</span><span className="font-mono text-amber-600">{formatAUD(summary.refunds)}</span></div>
                  {summary.promotionalDiscounts !== 0 && <div className="flex justify-between"><span>Promo Discounts:</span><span className="font-mono">{formatAUD(summary.promotionalDiscounts)}</span></div>}
                  {summary.reimbursements !== 0 && <div className="flex justify-between"><span>Reimbursements:</span><span className="font-mono">{formatAUD(summary.reimbursements)}</span></div>}
                  <div className="border-t border-purple-200 my-1" />
                  <div className="flex justify-between text-purple-700 font-medium">
                    <span>Rollover to 612:</span>
                    <span className="font-mono">{formatAUD(-splitMonth.rolloverAmount)}</span>
                  </div>
                  <div className="border-t border-purple-200 my-1" />
                  <div className="flex justify-between font-semibold"><span>Net:</span><span className="font-mono">$0.00</span></div>
                </div>
              </div>
              <div className="space-y-2 p-3 rounded-lg bg-background border border-purple-200">
                <h4 className="font-semibold text-sm text-purple-800">
                  Journal 2 ({formatDisplayDate(splitMonth.month2.start)}) — nets to {formatAUD(summary.bankDeposit)}
                </h4>
                <div className="space-y-0.5 text-xs">
                  <div className="flex justify-between text-purple-700 font-medium">
                    <span>Rollover from 612:</span>
                    <span className="font-mono">{formatAUD(splitMonth.rolloverAmount)}</span>
                  </div>
                  <div className="border-t border-purple-200 my-1" />
                  <p className="text-muted-foreground text-[10px] italic">
                    + {splitMonth.month2.monthLabel} transactions ({Math.round(splitMonth.month2.ratio * 100)}% by days)
                  </p>
                  <div className="flex justify-between"><span>Sales:</span><span className="font-mono text-green-700">{formatAUD(splitMonth.month2.totalSales)}</span></div>
                  <div className="flex justify-between"><span>Fees:</span><span className="font-mono text-red-600">{formatAUD(splitMonth.month2.sellerFees + splitMonth.month2.fbaFees + splitMonth.month2.storageFees)}</span></div>
                  <div className="flex justify-between"><span>Refunds:</span><span className="font-mono text-amber-600">{formatAUD(splitMonth.month2.refunds)}</span></div>
                  {splitMonth.month2.promotionalDiscounts !== 0 && <div className="flex justify-between"><span>Promo Discounts:</span><span className="font-mono">{formatAUD(splitMonth.month2.promotionalDiscounts)}</span></div>}
                  {splitMonth.month2.reimbursements !== 0 && <div className="flex justify-between"><span>Reimbursements:</span><span className="font-mono">{formatAUD(splitMonth.month2.reimbursements)}</span></div>}
                  <div className="border-t border-purple-200 my-1" />
                  <div className="flex justify-between font-semibold"><span>Bank Deposit:</span><span className="font-mono">{formatAUD(summary.bankDeposit)}</span></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ★ Xero Journal Preview — LMB-style table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Xero Invoice Preview</CardTitle>
              <CardDescription className="text-xs">Exactly what will be posted to Xero as an ACCREC invoice. Verify account codes and tax rates.</CardDescription>
            </div>
            {/* Download dropdown */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
              >
                <Download className="h-3.5 w-3.5" /> Download <ChevronDown className="h-3 w-3" />
              </Button>
              {showDownloadMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-md shadow-lg py-1 w-52">
                  <button
                    onClick={handleDownloadEntry}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Download className="h-3.5 w-3.5" /> Download Entry (CSV)
                  </button>
                  <button
                    onClick={handleDownloadAuditData}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Download Audit Data
                  </button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="py-2 px-4 font-medium">Description</th>
                  <th className="py-2 px-4 font-medium">Account Name</th>
                  <th className="py-2 px-4 font-medium">Tax Rate</th>
                  <th className="py-2 px-4 font-medium text-right">Net Amount</th>
                  <th className="py-2 px-4 font-medium text-right">Tax</th>
                  <th className="py-2 px-4 font-medium text-right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {journalPreviewLines.map((row, i) => {
                  const isClearing = row.description.includes('Clearing');
                  return (
                    <tr key={i} className={`border-b ${isClearing ? 'bg-muted/20 font-medium' : 'hover:bg-muted/10'}`}>
                      <td className="py-2.5 px-4 text-sm">{row.description}</td>
                      <td className="py-2.5 px-4 text-sm text-muted-foreground">{row.accountName}</td>
                      <td className="py-2.5 px-4 text-sm">{row.taxRate}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{formatAUD(row.netAmount)}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">{formatAUD(row.taxAmount)}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-medium">{formatAUD(row.grossAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/30">
                  <td colSpan={3} className="py-2 px-4 font-semibold text-sm">Total</td>
                  <td className="py-2 px-4 text-right font-mono font-semibold">
                    {formatAUD(journalPreviewLines.reduce((s, r) => s + r.netAmount, 0))}
                  </td>
                  <td className="py-2 px-4 text-right font-mono font-semibold">
                    {formatAUD(journalPreviewLines.reduce((s, r) => s + r.taxAmount, 0))}
                  </td>
                  <td className="py-2 px-4 text-right font-mono font-semibold">
                    {formatAUD(journalPreviewLines.reduce((s, r) => s + r.grossAmount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Breakdown (existing summary view — kept for quick reference) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Transaction Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <SummaryRow label="Amazon Sales — Principal" amount={summary.salesPrincipal} color="text-green-700" />
            <SummaryRow label="Amazon Sales — Shipping" amount={summary.salesShipping} color="text-green-700" />
            <div className="border-t my-2" />
            <SummaryRow label="Total Sales" amount={summary.totalSales} color="text-green-700" bold />
            <SummaryRow label="Promotional Discounts" amount={summary.promotionalDiscounts} color="text-orange-600" />
            <SummaryRow label="Amazon Seller Fees" amount={summary.sellerFees} color="text-red-600" />
            <SummaryRow label="Amazon FBA Fees" amount={summary.fbaFees} color="text-red-600" />
            {summary.storageFees !== 0 && <SummaryRow label="Storage Fees" amount={summary.storageFees} color="text-red-600" />}
            <SummaryRow label="Refunds (net)" amount={summary.refunds} color="text-amber-600" />
            {summary.reimbursements !== 0 && <SummaryRow label="Reimbursements" amount={summary.reimbursements} color="text-blue-600" />}
            {summary.otherFees !== 0 && <SummaryRow label="Other / Unmapped" amount={summary.otherFees} color="text-gray-500" />}
            <div className="border-t my-2" />
            <SummaryRow label="GST on Income" amount={summary.gstOnIncome} color="text-blue-600" />
            <SummaryRow label="GST on Expenses" amount={summary.gstOnExpenses} color="text-red-600" />
            <SummaryRow label="Net (ex GST)" amount={summary.netExGst} bold />
            <div className="border-t-2 border-foreground/20 my-2" />
            <SummaryRow label="Bank Deposit" amount={summary.bankDeposit} bold large />
          </div>
        </CardContent>
      </Card>

      {/* Debug Breakdown Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Debug Breakdown</CardTitle>
          <CardDescription className="text-xs">Per-category GST analysis. Always visible for debugging.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="py-2 px-4 font-medium">Category</th>
                  <th className="py-2 px-4 font-medium text-right">Raw Total</th>
                  <th className="py-2 px-4 font-medium text-right">Ex-GST</th>
                  <th className="py-2 px-4 font-medium text-right">GST</th>
                </tr>
              </thead>
              <tbody>
                {summary.debugBreakdown.map((row, i) => {
                  const isTotal = row.category === 'TOTAL';
                  return (
                    <tr key={i} className={`border-b ${isTotal ? 'bg-muted/30 font-semibold' : 'hover:bg-muted/20'}`}>
                      <td className={`py-1.5 px-4 ${isTotal ? 'font-semibold' : ''}`}>{row.category}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{formatAUD(row.rawTotal)}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{formatAUD(row.exGst)}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{formatAUD(row.gst)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Unmapped Exceptions */}
      {unmapped.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              Unmapped Transactions ({unmapped.length})
            </CardTitle>
            <CardDescription className="text-xs">
              These transactions could not be mapped. Review before proceeding.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5 pr-3">Type</th>
                    <th className="py-1.5 pr-3">Amount Type</th>
                    <th className="py-1.5 pr-3">Description</th>
                    <th className="py-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {unmapped.map((u, i) => (
                    <tr key={i} className="border-b border-muted">
                      <td className="py-1.5 pr-3 font-mono">{u.transactionType}</td>
                      <td className="py-1.5 pr-3">{u.amountType}</td>
                      <td className="py-1.5 pr-3">{u.amountDescription}</td>
                      <td className="py-1.5 text-right font-mono">{formatAUD(u.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Line Items Toggle */}
      <div>
        <Button variant="outline" size="sm" onClick={() => setShowLineItems(!showLineItems)}>
          {showLineItems ? 'Hide' : 'Show'} All Line Items ({lines.length})
        </Button>

        {showLineItems && (
          <Card className="mt-2">
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 px-2">Category</th>
                      <th className="py-1.5 px-2">Type</th>
                      <th className="py-1.5 px-2">Description</th>
                      <th className="py-1.5 px-2">Order ID</th>
                      <th className="py-1.5 px-2">SKU</th>
                      <th className="py-1.5 px-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => (
                      <tr key={i} className="border-b border-muted hover:bg-muted/50">
                        <td className="py-1 px-2">
                          <Badge variant="outline" className="text-[10px]">{line.accountingCategory}</Badge>
                        </td>
                        <td className="py-1 px-2 font-mono">{line.transactionType}</td>
                        <td className="py-1 px-2">{line.amountDescription}</td>
                        <td className="py-1 px-2 font-mono text-muted-foreground">{line.orderId}</td>
                        <td className="py-1 px-2 font-mono text-muted-foreground">{line.sku}</td>
                        <td className="py-1 px-2 text-right font-mono">{formatAUD(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Actions */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Button
              size="lg"
              onClick={onSave}
              disabled={saving || saved || !parsed?.summary?.reconciliationMatch}
              className="gap-2"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
              ) : saved ? (
                <><CheckCircle2 className="h-4 w-4" /> Saved ✓</>
              ) : (
                <><Save className="h-4 w-4" /> Save Settlement</>
              )}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={onPushToXero}
              disabled={!saved || pushing || pushed}
              className="gap-2"
            >
              {pushing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Pushing to Xero...</>
              ) : pushed ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Posted to Xero ✓</>
              ) : (
                <><ExternalLink className="h-4 w-4" /> Push to Xero</>
              )}
            </Button>
            {!parsed?.summary?.reconciliationMatch && (
              <p className="text-xs text-destructive">
                Save disabled — settlement does not reconcile.
              </p>
            )}
            {saved && !pushed && (
              <p className="text-xs text-emerald-700 font-medium">
                ✓ Saved to database. Ready for Xero push.
              </p>
            )}
            {pushed && (
              <p className="text-xs text-emerald-700 font-medium">
                ✓ Posted to Xero as Invoice (AUTHORISED).
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Account Code Defaults & Descriptions ───────────────────────────

const DEFAULT_ACCOUNT_CODES: Record<string, { code: string; name: string; type: string; taxType: string; description: string }> = {
  'Sales': { code: '200', name: 'Amazon Sales AU', type: 'Revenue', taxType: 'OUTPUT', description: 'Revenue, GST on Income' },
  'Refunds': { code: '205', name: 'Amazon Refunds AU', type: 'Revenue', taxType: 'OUTPUT', description: 'Revenue, GST on Income' },
  'Reimbursements': { code: '271', name: 'Amazon FBA Inventory Reimbursement AU', type: 'Other Income', taxType: 'OUTPUT', description: 'Other Income, GST on Income' },
  'Seller Fees': { code: '407', name: 'Amazon Seller Fees AU', type: 'Expense', taxType: 'INPUT', description: 'Expense, GST on Expenses' },
  'FBA Fees': { code: '408', name: 'Amazon FBA Fees AU', type: 'Expense', taxType: 'INPUT', description: 'Expense, GST on Expenses' },
  'Storage Fees': { code: '409', name: 'Amazon Storage Fees AU', type: 'Expense', taxType: 'INPUT', description: 'Expense, GST on Expenses' },
  'Tax Collected by Amazon': { code: '824', name: 'Amazon Sales Tax AU', type: 'Current Liability', taxType: 'BASEXCLUDED', description: 'Current Liability, BAS Excluded' },
  'Split Month Rollover': { code: '612', name: 'Amazon Split Month Rollovers', type: 'Current Asset', taxType: 'BASEXCLUDED', description: 'Current Asset, BAS Excluded' },
};

const REQUIRED_XERO_ACCOUNTS = Object.entries(DEFAULT_ACCOUNT_CODES).map(([, val]) => ({
  code: val.code,
  name: val.name,
  type: val.type,
  taxType: val.taxType,
}));

// ─── Settings Screen ────────────────────────────────────────────────

function SettlementSettings({ onGstRateChanged }: { onGstRateChanged?: (rate: number) => void }) {
  const [accountCodes, setAccountCodes] = useState<Record<string, string>>(() => {
    const codes: Record<string, string> = {};
    Object.entries(DEFAULT_ACCOUNT_CODES).forEach(([key, val]) => {
      codes[key] = val.code;
    });
    return codes;
  });
  const [gstRate, setGstRate] = useState('10');
  const [savingSettings, setSavingSettings] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checkResults, setCheckResults] = useState<Array<{ code: string; name: string; found: boolean; xeroName?: string }> | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('key, value')
          .in('key', ['accounting_xero_account_codes', 'accounting_gst_rate']);

        if (data) {
          for (const row of data) {
            if (row.key === 'accounting_xero_account_codes' && row.value) {
              try { setAccountCodes(JSON.parse(row.value)); } catch {}
            }
            if (row.key === 'accounting_gst_rate' && row.value) {
              setGstRate(row.value);
            }
          }
        }
      } catch {}
    };
    loadSettings();
  }, []);

  const handleResetDefaults = () => {
    const codes: Record<string, string> = {};
    Object.entries(DEFAULT_ACCOUNT_CODES).forEach(([key, val]) => {
      codes[key] = val.code;
    });
    setAccountCodes(codes);
    toast.success('Account codes reset to defaults');
  };

  const handleCheckAccounts = async () => {
    setChecking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('xero-auth', {
        body: { action: 'get_accounts', userId: user.id }
      });

      if (error) throw error;

      const xeroAccounts: Array<{ Code: string; Name: string; Status: string }> = data?.accounts || [];
      const activeAccounts = xeroAccounts.filter(a => a.Status === 'ACTIVE');

      // Check each configured account code against Xero
      const results = Object.entries(DEFAULT_ACCOUNT_CODES).map(([category, defaults]) => {
        const codeToCheck = accountCodes[category] || defaults.code;
        const match = activeAccounts.find(a => a.Code === codeToCheck);
        return {
          code: codeToCheck,
          name: defaults.name,
          found: !!match,
          xeroName: match?.Name,
        };
      });

      setCheckResults(results);

      const allFound = results.every(r => r.found);
      if (allFound) {
        toast.success('All account codes verified in Xero ✓');
      } else {
        const missing = results.filter(r => !r.found);
        toast.warning(`${missing.length} account(s) not found in Xero`);
      }
    } catch (err: any) {
      toast.error(`Failed to check accounts: ${err.message}`);
    } finally {
      setChecking(false);
    }
  };

  const handleCreateMissingAccounts = async () => {
    if (!checkResults) return;
    const missing = checkResults.filter(r => !r.found);
    if (missing.length === 0) {
      toast.info('No missing accounts to create');
      return;
    }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build the accounts to create from DEFAULT_ACCOUNT_CODES matching the missing codes
      const accountsToCreate = missing.map(m => {
        const entry = Object.values(DEFAULT_ACCOUNT_CODES).find(d => d.code === m.code);
        return {
          Code: m.code,
          Name: entry?.name || m.name,
          Type: entry?.type || 'Expense',
          TaxType: entry?.taxType || 'NONE',
        };
      });

      const { data, error } = await supabase.functions.invoke('xero-auth', {
        body: { action: 'create_accounts', userId: user.id, accounts: accountsToCreate }
      });

      if (error) throw error;

      const results = data?.results || [];
      const succeeded = results.filter((r: any) => r.success);
      const failed = results.filter((r: any) => !r.success);

      if (failed.length > 0) {
        toast.warning(`Created ${succeeded.length} account(s), ${failed.length} failed. Check Xero for details.`);
      } else {
        toast.success(`Created ${succeeded.length} account(s) in Xero ✓`);
      }

      // Re-check after creating
      await handleCheckAccounts();
    } catch (err: any) {
      toast.error(`Failed to create accounts: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const settingsToSave = [
        { key: 'accounting_xero_account_codes', value: JSON.stringify(accountCodes) },
        { key: 'accounting_gst_rate', value: gstRate },
      ];

      for (const setting of settingsToSave) {
        const { data: existing } = await supabase
          .from('app_settings')
          .select('id')
          .eq('key', setting.key)
          .eq('user_id', user.id)
          .limit(1);

        if (existing && existing.length > 0) {
          await supabase.from('app_settings').update({ value: setting.value }).eq('key', setting.key).eq('user_id', user.id);
        } else {
          await supabase.from('app_settings').insert({ user_id: user.id, key: setting.key, value: setting.value });
        }
      }

      toast.success('Settings saved');
      const parsedRate = parseFloat(gstRate);
      if (!isNaN(parsedRate) && parsedRate > 0 && onGstRateChanged) {
        onGstRateChanged(parsedRate);
      }
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ★ Prominent Banner */}
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-medium">
                These account codes must exist in your Xero chart of accounts before pushing settlements.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCheckAccounts}
                  disabled={checking}
                  className="gap-1.5"
                >
                  {checking ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking...</>
                  ) : (
                    <><CheckCircle2 className="h-3.5 w-3.5" /> Check My Xero Accounts</>
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreateMissingAccounts}
                  disabled={creating || !checkResults || checkResults.every(r => r.found)}
                  className="gap-1.5"
                >
                  {creating ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating...</>
                  ) : (
                    <><ArrowRight className="h-3.5 w-3.5" /> Create Missing Accounts</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verification Results */}
      {checkResults && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-hidden rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">Code</th>
                    <th className="text-left px-4 py-2 font-medium">Expected Name</th>
                    <th className="text-left px-4 py-2 font-medium">Xero Name</th>
                    <th className="text-center px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {checkResults.map(r => (
                    <tr key={r.code} className="border-t">
                      <td className="px-4 py-2 font-mono font-semibold">{r.code}</td>
                      <td className="px-4 py-2 text-sm">{r.name}</td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{r.xeroName || '—'}</td>
                      <td className="px-4 py-2 text-center">
                        {r.found ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {checkResults.every(r => r.found) && (
                <div className="px-4 py-2 bg-green-50 border-t text-xs text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All accounts verified. Ready to push settlements.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ★ Account Code Fields with helper text */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Xero Account Codes</CardTitle>
              <CardDescription className="text-xs">
                Pre-filled with AU defaults. Edit if your Xero uses different account codes.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={handleResetDefaults} className="text-xs gap-1">
              <Settings className="h-3 w-3" /> Reset to Defaults
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(DEFAULT_ACCOUNT_CODES).map(([category, defaults]) => (
              <div key={category} className="space-y-1">
                <div className="flex items-center gap-3">
                  <Label className="text-sm font-medium w-48 flex-shrink-0">{category}</Label>
                  <Input
                    value={accountCodes[category] || defaults.code}
                    onChange={(e) => setAccountCodes(prev => ({ ...prev, [category]: e.target.value }))}
                    className="h-9 text-sm font-mono w-24"
                    placeholder={defaults.code}
                  />
                </div>
                <p className="text-xs text-muted-foreground ml-0 sm:ml-48 sm:pl-3">
                  {defaults.code} — {defaults.name} ({defaults.description})
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* GST Rate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">GST Rate</CardTitle>
          <CardDescription className="text-xs">
            Applied to income and expense totals for AU settlements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Label className="text-xs w-36">GST Rate (%)</Label>
            <Input
              type="number"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
              className="h-8 text-xs font-mono w-24"
              min="0"
              max="100"
              step="0.5"
            />
            <span className="text-xs text-muted-foreground">Currently: divide by {100 / parseFloat(gstRate || '10') + 1}</span>
          </div>
        </CardContent>
      </Card>

      {/* Country support */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Marketplace Support</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span>🇦🇺</span> <span className="font-medium">Australia</span>
              <Badge className="bg-green-100 text-green-800 text-[10px]">Active</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span>🇬🇧</span> <span className="font-medium text-muted-foreground">United Kingdom</span>
              <Badge variant="outline" className="text-[10px]">Coming Soon</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span>🇺🇸</span> <span className="font-medium text-muted-foreground">United States</span>
              <Badge variant="outline" className="text-[10px]">Coming Soon</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={handleSaveSettings} disabled={savingSettings} className="gap-2">
        {savingSettings ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
        ) : (
          <><Save className="h-4 w-4" /> Save Settings</>
        )}
      </Button>
    </div>
  );
}

// ─── Helper Components ───────────────────────────────────────────────

function SplitMonthPanel({ data }: { data: SplitMonthData }) {
  const pct = Math.round(data.ratio * 100);
  return (
    <div className="space-y-2 p-3 rounded-lg bg-background border border-purple-200">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm text-purple-800">
          {data.monthLabel} ({data.days} days, {pct}%)
        </h4>
      </div>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between"><span>Sales:</span><span className="font-mono text-green-700">{formatAUD(data.totalSales)}</span></div>
        <div className="flex justify-between"><span>Fees:</span><span className="font-mono text-red-600">{formatAUD(data.sellerFees + data.fbaFees + data.storageFees)}</span></div>
        <div className="flex justify-between"><span>Refunds:</span><span className="font-mono text-amber-600">{formatAUD(data.refunds)}</span></div>
        {data.promotionalDiscounts !== 0 && <div className="flex justify-between"><span>Promo Discounts:</span><span className="font-mono">{formatAUD(data.promotionalDiscounts)}</span></div>}
        {data.reimbursements !== 0 && <div className="flex justify-between"><span>Reimbursements:</span><span className="font-mono">{formatAUD(data.reimbursements)}</span></div>}
        <div className="border-t border-purple-200 my-1" />
        <div className="flex justify-between font-semibold"><span>Net:</span><span className="font-mono">{formatAUD(data.grossTotal)}</span></div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  amount,
  color = 'text-foreground',
  bold = false,
  large = false,
}: {
  label: string;
  amount: number;
  color?: string;
  bold?: boolean;
  large?: boolean;
}) {
  return (
    <div className={`flex justify-between items-center py-0.5 ${large ? 'text-base' : 'text-sm'}`}>
      <span className={`${bold ? 'font-semibold' : ''} ${color}`}>{label}</span>
      <span className={`font-mono ${bold ? 'font-semibold' : ''} ${color}`}>
        {formatAUD(amount)}
      </span>
    </div>
  );
}