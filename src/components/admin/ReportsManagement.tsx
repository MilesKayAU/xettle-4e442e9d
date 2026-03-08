import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InventoryReport from './reports/InventoryReport';

const ReportsManagement = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Reports</h2>
        <p className="text-gray-600">Manage and generate various business reports</p>
      </div>

      <Tabs defaultValue="inventory">
        <TabsList className="mb-4">
          <TabsTrigger value="inventory">Inventory Report</TabsTrigger>
          {/* Future reports can be added here */}
        </TabsList>
        
        <TabsContent value="inventory">
          <InventoryReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportsManagement;