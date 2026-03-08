
import React from 'react';
import { Button } from "@/components/ui/button";
import { RefreshCw } from 'lucide-react';

interface DistributorApplicationsHeaderProps {
  totalApplications: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const DistributorApplicationsHeader: React.FC<DistributorApplicationsHeaderProps> = ({
  totalApplications,
  onRefresh,
  isRefreshing
}) => {
  return (
    <div className="flex justify-between items-center">
      <div className="text-sm text-muted-foreground">
        Total applications: {totalApplications}
      </div>
      <Button 
        variant="outline" 
        size="sm" 
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </Button>
    </div>
  );
};

export default DistributorApplicationsHeader;
