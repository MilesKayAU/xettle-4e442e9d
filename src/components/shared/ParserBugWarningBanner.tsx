/**
 * Warning banner shown on Bunnings settlements affected by the greedy-Total parser bug.
 * Condition: bank_deposit = -50 AND sales_principal > 100 AND marketplace = 'bunnings'
 */

import { AlertTriangle } from 'lucide-react';

interface Props {
  settlement: {
    bank_deposit?: number;
    sales_principal?: number;
    marketplace?: string;
  };
}

export function isAffectedByParserBug(s: {
  bank_deposit?: number;
  sales_principal?: number;
  marketplace?: string;
}): boolean {
  return (
    s.marketplace?.toLowerCase() === 'bunnings' &&
    s.bank_deposit === -50 &&
    (s.sales_principal || 0) > 100
  );
}

export default function ParserBugWarningBanner({ settlement }: Props) {
  if (!isAffectedByParserBug(settlement)) return null;

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 p-3 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
          Bank deposit may be incorrect
        </p>
        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
          This settlement was parsed with a bug that captured the subscription fee (−$50.00) instead of the actual bank deposit.
          Please re-upload the original PDF to correct this settlement.
        </p>
      </div>
    </div>
  );
}
