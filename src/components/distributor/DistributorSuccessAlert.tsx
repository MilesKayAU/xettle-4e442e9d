
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2 } from 'lucide-react';

const DistributorSuccessAlert: React.FC = () => {
  return (
    <Alert className="mb-6 bg-green-50 border-green-200">
      <CheckCircle2 className="h-4 w-4 text-green-600" />
      <AlertTitle className="text-green-800">Application Submitted Successfully!</AlertTitle>
      <AlertDescription className="text-green-700">
        Thank you for your interest in becoming a distributor. Our team will review your 
        application and get back to you soon.
      </AlertDescription>
    </Alert>
  );
};

export default DistributorSuccessAlert;
