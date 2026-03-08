import React from 'react';
import { Badge } from '@/components/ui/badge';
import { PurchaseOrder } from '@/types/purchase-orders';

interface POStatusBadgeProps {
  status: PurchaseOrder['status'];
}

const POStatusBadge: React.FC<POStatusBadgeProps> = ({ status }) => {
  const statusConfig: Record<string, { variant: 'secondary' | 'default' | 'destructive' | 'outline'; label: string; className?: string }> = {
    draft: { variant: 'secondary', label: 'Draft' },
    sent: { variant: 'default', label: 'Sent' },
    approved: { variant: 'default', label: 'Approved', className: 'bg-green-500 hover:bg-green-600' },
    rejected: { variant: 'destructive', label: 'Rejected' },
    completed: { variant: 'outline', label: 'Completed' },
  };

  const config = statusConfig[status] || statusConfig.draft;

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
};

export default POStatusBadge;
