import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, X, Pencil } from 'lucide-react';
import { format } from 'date-fns';

export interface ReviewItem {
  shipment_id: string;
  goods_name: string;
  suggested_date: string; // ISO
  snippet: string;
  ship_date: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: ReviewItem[];
  onApprove: (approvals: Array<{ id: string; date: string }>) => Promise<void>;
}

type Decision = 'approve' | 'edit' | 'skip';

export default function ArrivalDateReviewDialog({ open, onClose, items, onApprove }: Props) {
  const [decisions, setDecisions] = useState<Record<string, { decision: Decision; date: string }>>(() => {
    const init: Record<string, { decision: Decision; date: string }> = {};
    items.forEach(item => {
      init[item.shipment_id] = { decision: 'approve', date: item.suggested_date };
    });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const setDecision = (id: string, decision: Decision) => {
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], decision } }));
  };

  const setDate = (id: string, date: string) => {
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], date, decision: 'edit' } }));
  };

  const handleConfirm = async () => {
    setSaving(true);
    const approvals = Object.entries(decisions)
      .filter(([_, v]) => v.decision !== 'skip')
      .map(([id, v]) => ({ id, date: v.date }));
    await onApprove(approvals);
    setSaving(false);
    onClose();
  };

  const approvedCount = Object.values(decisions).filter(d => d.decision !== 'skip').length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Suggested Arrival Dates</DialogTitle>
          <DialogDescription>
            These dates were inferred from the situation notes but need confirmation. Approve, edit, or skip each.
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Shipped</TableHead>
              <TableHead>Suggested Date</TableHead>
              <TableHead>Source Text</TableHead>
              <TableHead className="w-[160px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => {
              const d = decisions[item.shipment_id];
              return (
                <TableRow key={item.shipment_id} className={d?.decision === 'skip' ? 'opacity-50' : ''}>
                  <TableCell className="font-medium text-sm max-w-[150px] truncate">{item.goods_name}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {item.ship_date ? format(new Date(item.ship_date), 'd MMM yy') : '—'}
                  </TableCell>
                  <TableCell>
                    {d?.decision === 'edit' ? (
                      <Input
                        type="date"
                        value={d.date}
                        onChange={e => setDate(item.shipment_id, e.target.value)}
                        className="h-7 text-xs w-[130px]"
                      />
                    ) : (
                      <span className="text-sm font-mono">
                        {format(new Date(item.suggested_date), 'd MMM yyyy')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={item.snippet}>
                    "{item.snippet}"
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant={d?.decision === 'approve' ? 'default' : 'ghost'}
                        className="h-7 w-7"
                        title="Approve"
                        onClick={() => setDecision(item.shipment_id, 'approve')}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant={d?.decision === 'edit' ? 'default' : 'ghost'}
                        className="h-7 w-7"
                        title="Edit date"
                        onClick={() => setDecision(item.shipment_id, 'edit')}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant={d?.decision === 'skip' ? 'destructive' : 'ghost'}
                        className="h-7 w-7"
                        title="Skip"
                        onClick={() => setDecision(item.shipment_id, 'skip')}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <DialogFooter>
          <Badge variant="outline" className="mr-auto">
            {approvedCount} of {items.length} will be updated
          </Badge>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={saving || approvedCount === 0}>
            {saving ? 'Saving...' : `Confirm ${approvedCount} Date${approvedCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
