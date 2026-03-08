
import React from 'react';
import DistributorApplicationsHeader from './distributor/DistributorApplicationsHeader';
import DistributorApplicationsTable from './distributor/DistributorApplicationsTable';
import { useDistributorData } from './distributor/hooks/useDistributorData';

const DistributorApplicationsManager = () => {
  const {
    applications,
    isLoading,
    isRefreshing,
    updateStatus,
    refresh
  } = useDistributorData();
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p>Loading applications...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <DistributorApplicationsHeader
        totalApplications={applications.length}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
      />
      
      <DistributorApplicationsTable
        applications={applications}
        onStatusChange={updateStatus}
      />
    </div>
  );
};

export default DistributorApplicationsManager;
