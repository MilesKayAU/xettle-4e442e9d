
import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import DistributorApplicationsManager from "@/components/DistributorApplicationsManager";
import { testSupabaseConnection } from "@/integrations/supabase/client";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const DistributorManagement: React.FC = () => {
  const [connectionStatus, setConnectionStatus] = useState<{
    checked: boolean;
    success?: boolean;
    message?: string;
    details?: any;
  }>({ checked: false });

  const handleTestConnection = async () => {
    const result = await testSupabaseConnection();
    setConnectionStatus({
      checked: true,
      success: result.success,
      message: result.message,
      details: result.details
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Distributor Applications</CardTitle>
        <CardDescription>Manage applications from potential distributors</CardDescription>
      </CardHeader>
      <CardContent>
        <DistributorApplicationsManager />

        {connectionStatus.checked && (
          <Alert className={`mt-4 ${connectionStatus.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            {connectionStatus.success ? 
              <CheckCircle2 className="h-4 w-4 text-green-600" /> : 
              <AlertCircle className="h-4 w-4 text-red-600" />
            }
            <AlertTitle>
              {connectionStatus.success ? 'Connection Successful' : 'Connection Issue'}
            </AlertTitle>
            <AlertDescription className="text-sm">
              {connectionStatus.message}
              {connectionStatus.details && (
                <pre className="mt-2 p-2 text-xs bg-slate-100 rounded overflow-auto">
                  {JSON.stringify(connectionStatus.details, null, 2)}
                </pre>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleTestConnection}
        >
          Test Database Connection
        </Button>
      </CardFooter>
    </Card>
  );
};

export default DistributorManagement;
