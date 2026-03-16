/**
 * Canonical action: Audit log CSV export.
 * Calls the export-system-events-csv edge function.
 * UI must import from this file only — no direct edge function calls.
 */

import { supabase } from '@/integrations/supabase/client';

export interface AuditExportFilters {
  date_from?: string;
  date_to?: string;
  settlement_id?: string;
  marketplace_code?: string;
}

export interface AuditExportResult {
  success: boolean;
  error?: string;
}

export async function exportAuditCsv(filters: AuditExportFilters): Promise<AuditExportResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/export-system-events-csv`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(filters),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: text || `Export failed (${res.status})` };
    }

    // Trigger browser download
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
      || `xettle-audit-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Export failed' };
  }
}
