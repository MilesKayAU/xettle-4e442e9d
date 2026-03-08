
import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DistributorApplicationRow from './DistributorApplicationRow';
import { DistributorApplication } from './types';

interface DistributorApplicationsTableProps {
  applications: DistributorApplication[];
  onStatusChange: (id: string, status: string) => void;
}

const DistributorApplicationsTable: React.FC<DistributorApplicationsTableProps> = ({
  applications,
  onStatusChange
}) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Company</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center py-8">
              No distributor applications found
              <div className="text-xs text-muted-foreground mt-2">
                Check browser console for debugging information
              </div>
            </TableCell>
          </TableRow>
        ) : (
          applications.map((app) => (
            <DistributorApplicationRow
              key={app.id}
              application={app}
              onStatusChange={onStatusChange}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
};

export default DistributorApplicationsTable;
