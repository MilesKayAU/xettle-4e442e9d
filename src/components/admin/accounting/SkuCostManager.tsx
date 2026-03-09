/**
 * SkuCostManager — Inline SKU cost editor with CSV import
 *
 * Shows a table of SKUs extracted from Shopify Orders, lets users
 * enter product costs, and supports bulk CSV import.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Upload, Save, AlertTriangle, CheckCircle2, Package, FileSpreadsheet,
  Loader2, X, Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { ProductCost } from '@/utils/profit-engine';

interface SkuCostManagerProps {
  /** All unique SKUs detected from the uploaded file */
  skus: string[];
  /** Callback when costs are saved — parent should recalculate profit */
  onCostsSaved?: (costs: Map<string, ProductCost>) => void;
  /** Compact mode for inline embedding */
  compact?: boolean;
}

interface SkuRow {
  sku: string;
  cost: string; // string for input binding
  label: string;
  saved: boolean;
  modified: boolean;
}

export default function SkuCostManager({ skus, onCostsSaved, compact }: SkuCostManagerProps) {
  const [rows, setRows] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Load existing costs from DB
  const loadCosts = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('product_costs')
        .select('sku, cost, label, currency')
        .eq('user_id', user.id);

      if (error) throw error;

      const costMap = new Map<string, { cost: number; label: string }>();
      for (const row of (data || [])) {
        costMap.set(row.sku.toUpperCase().trim(), {
          cost: Number(row.cost),
          label: row.label || '',
        });
      }

      // Build rows from SKU list, merge with DB data
      const newRows: SkuRow[] = skus.map(sku => {
        const existing = costMap.get(sku.toUpperCase().trim());
        return {
          sku: sku.toUpperCase().trim(),
          cost: existing ? String(existing.cost) : '',
          label: existing?.label || '',
          saved: !!existing,
          modified: false,
        };
      });

      // Sort: uncosted first, then by SKU
      newRows.sort((a, b) => {
        if (!a.cost && b.cost) return -1;
        if (a.cost && !b.cost) return 1;
        return a.sku.localeCompare(b.sku);
      });

      setRows(newRows);
    } catch (err: any) {
      toast.error('Failed to load product costs');
    } finally {
      setLoading(false);
    }
  }, [skus]);

  useEffect(() => { loadCosts(); }, [loadCosts]);

  const updateRow = (idx: number, field: 'cost' | 'label', value: string) => {
    setRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value, modified: true };
      return updated;
    });
  };

  // Save all modified rows
  const handleSave = async () => {
    const modified = rows.filter(r => r.modified && r.cost !== '');
    if (modified.length === 0) {
      toast.info('No changes to save');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      for (const row of modified) {
        const costNum = parseFloat(row.cost);
        if (isNaN(costNum) || costNum < 0) continue;

        const { error } = await supabase
          .from('product_costs')
          .upsert({
            user_id: user.id,
            sku: row.sku,
            cost: costNum,
            label: row.label || null,
            currency: 'AUD',
          }, { onConflict: 'user_id,sku' });

        if (error) throw error;
      }

      toast.success(`${modified.length} product cost${modified.length !== 1 ? 's' : ''} saved`);

      // Rebuild cost map for callback
      const costMap = new Map<string, ProductCost>();
      for (const row of rows) {
        if (row.cost && !isNaN(parseFloat(row.cost))) {
          costMap.set(row.sku, {
            sku: row.sku,
            cost: parseFloat(row.cost),
            currency: 'AUD',
            label: row.label || undefined,
          });
        }
      }

      setRows(prev => prev.map(r => r.modified ? { ...r, modified: false, saved: true } : r));
      onCostsSaved?.(costMap);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // CSV import: expects columns SKU, Cost, [Label]
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        toast.error('CSV must have a header row and at least one data row');
        return;
      }

      const header = lines[0].toLowerCase();
      const hasLabel = header.includes('label') || header.includes('name') || header.includes('product');

      let imported = 0;
      setRows(prev => {
        const updated = [...prev];
        const skuMap = new Map(updated.map((r, i) => [r.sku, i]));

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
          if (parts.length < 2) continue;

          const sku = parts[0].toUpperCase().trim();
          const cost = parts[1];
          const label = hasLabel && parts[2] ? parts[2] : '';

          if (!sku || isNaN(parseFloat(cost))) continue;

          const existingIdx = skuMap.get(sku);
          if (existingIdx !== undefined) {
            updated[existingIdx] = { ...updated[existingIdx], cost, label: label || updated[existingIdx].label, modified: true };
          } else {
            // Add new SKU not in current file
            updated.push({ sku, cost, label, saved: false, modified: true });
            skuMap.set(sku, updated.length - 1);
          }
          imported++;
        }
        return updated;
      });

      toast.success(`${imported} SKU costs imported from CSV — click Save to persist`);
    } catch {
      toast.error('Failed to read CSV file');
    }

    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  // Download template CSV
  const downloadTemplate = () => {
    const header = 'SKU,Cost,Label\n';
    const sampleRows = rows.slice(0, 5).map(r => `${r.sku},${r.cost || '0'},${r.label || ''}`).join('\n');
    const blob = new Blob([header + sampleRows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product_costs_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const costedCount = rows.filter(r => r.cost && parseFloat(r.cost) > 0).length;
  const uncostedCount = rows.length - costedCount;
  const modifiedCount = rows.filter(r => r.modified).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground mt-2">Loading product costs...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className={compact ? 'text-sm' : 'text-base'}>Product Costs (COGS)</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {costedCount}/{rows.length} costed
            </Badge>
            {uncostedCount > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                {uncostedCount} missing
              </Badge>
            )}
          </div>
        </div>
        {!compact && (
          <CardDescription>
            Enter your product costs to calculate profit per marketplace.
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Bulk actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            Import CSV
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVImport}
            className="hidden"
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5"
            onClick={downloadTemplate}
          >
            <Download className="h-3 w-3" />
            Download template
          </Button>
          {modifiedCount > 0 && (
            <Button
              size="sm"
              className="text-xs gap-1.5 ml-auto"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save {modifiedCount} change{modifiedCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>

        <Separator />

        {/* SKU table */}
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_120px_80px_32px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1">
            <span>SKU</span>
            <span>Product Name</span>
            <span>Cost (AUD)</span>
            <span></span>
          </div>

          {rows.map((row, idx) => (
            <div
              key={row.sku}
              className={`grid grid-cols-[1fr_120px_80px_32px] gap-2 items-center px-1 py-1 rounded-sm ${
                row.modified ? 'bg-primary/5' :
                !row.cost ? 'bg-amber-50/50 dark:bg-amber-950/10' :
                ''
              }`}
            >
              <span className="text-xs font-mono text-foreground truncate" title={row.sku}>
                {row.sku}
              </span>
              <Input
                value={row.label}
                onChange={e => updateRow(idx, 'label', e.target.value)}
                placeholder="—"
                className="h-7 text-xs"
              />
              <Input
                value={row.cost}
                onChange={e => updateRow(idx, 'cost', e.target.value)}
                placeholder="0.00"
                type="number"
                step="0.01"
                min="0"
                className={`h-7 text-xs ${!row.cost ? 'border-amber-300' : ''}`}
              />
              <div className="flex justify-center">
                {row.saved && !row.modified && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                )}
                {!row.cost && (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                )}
              </div>
            </div>
          ))}
        </div>

        {uncostedCount > 0 && (
          <p className="text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {uncostedCount} of {rows.length} SKUs missing cost data — profit calculations will be estimated
          </p>
        )}
      </CardContent>
    </Card>
  );
}
