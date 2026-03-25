/**
 * Banners for API/CSV mismatch states:
 * 1. "api_corrected" — bank_deposit was auto-corrected by API (info)
 * 2. Pushed but mismatched — API disagrees with stored value (warning)
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatAUD } from '@/utils/settlement-engine';

interface Props {
  settlement: {
    settlement_id?: string;
    sync_origin?: string;
    status?: string;
    bank_deposit?: number;
  };
}

export default function ApiCsvMismatchBanner({ settlement }: Props) {
  const [mismatchEvent, setMismatchEvent] = useState<any>(null);

  useEffect(() => {
    if (!settlement?.settlement_id) return;
    (async () => {
      const { data } = await supabase
        .from('system_events')
        .select('details')
        .eq('settlement_id', settlement.settlement_id)
        .eq('event_type', 'api_csv_bank_deposit_mismatch')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data?.[0]) setMismatchEvent(data[0].details);
    })();
  }, [settlement?.settlement_id]);

  // Case 1: Auto-corrected (unpushed settlement was fixed by API)
  if (settlement.sync_origin === 'api_corrected' && mismatchEvent) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="text-xs">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">Auto-corrected by API</p>
          <p className="text-emerald-700 dark:text-emerald-300 mt-0.5">
            Bank deposit was automatically corrected from{' '}
            <span className="font-mono">{formatAUD(mismatchEvent.stored_bank_deposit)}</span> to{' '}
            <span className="font-mono">{formatAUD(mismatchEvent.api_bank_deposit)}</span>{' '}
            using live API data. No action needed.
          </p>
        </div>
      </div>
    );
  }

  // Case 2: Pushed but API disagrees — needs manual Correct & Repost
  if (
    mismatchEvent &&
    !mismatchEvent.auto_corrected &&
    ['pushed_to_xero', 'already_recorded'].includes(settlement.status || '')
  ) {
    return (
      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs">
          <p className="font-semibold text-amber-800 dark:text-amber-200">API data mismatch detected</p>
          <p className="text-amber-700 dark:text-amber-300 mt-0.5">
            API shows bank deposit of{' '}
            <span className="font-mono font-semibold">{formatAUD(mismatchEvent.api_bank_deposit)}</span>{' '}
            but this settlement was pushed to Xero with{' '}
            <span className="font-mono font-semibold">{formatAUD(mismatchEvent.stored_bank_deposit)}</span>.
            Use <strong>Correct &amp; Repost</strong> below to fix.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
