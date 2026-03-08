
import React from 'react';
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MessageSquare } from 'lucide-react';
import { toast } from "@/hooks/use-toast";
import { DistributorApplication } from './types';

interface DistributorApplicationRowProps {
  application: DistributorApplication;
  onStatusChange: (id: string, status: string) => void;
}

const DistributorApplicationRow: React.FC<DistributorApplicationRowProps> = ({
  application,
  onStatusChange
}) => {
  const handleMessageClick = () => {
    toast({
      title: "Message sent",
      description: `Email sent to ${application.full_name} at ${application.email}`,
    });
  };

  return (
    <TableRow key={application.id}>
      <TableCell>
        <div className="font-medium">{application.company_name || 'No company name'}</div>
      </TableCell>
      <TableCell>
        <div>{application.full_name}</div>
        <div className="text-sm text-muted-foreground">{application.email}</div>
        {application.phone && <div className="text-xs text-muted-foreground">{application.phone}</div>}
      </TableCell>
      <TableCell>{application.date}</TableCell>
      <TableCell>
        <div className={`inline-block px-2 py-1 rounded-full text-xs ${
          application.status === 'approved' 
            ? 'bg-green-100 text-green-800' 
            : application.status === 'rejected'
            ? 'bg-red-100 text-red-800'
            : 'bg-yellow-100 text-yellow-800'
        }`}>
          {application.status.charAt(0).toUpperCase() + application.status.slice(1)}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          {application.status === 'new' && (
            <>
              <Button 
                variant="outline" 
                size="sm"
                className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                onClick={() => onStatusChange(application.id, 'approved')}
              >
                Approve
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                onClick={() => onStatusChange(application.id, 'rejected')}
              >
                Reject
              </Button>
            </>
          )}
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleMessageClick}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

export default DistributorApplicationRow;
