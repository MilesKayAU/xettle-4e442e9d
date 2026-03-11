
import React from 'react';
import { LogOut, Key, ShieldAlert } from 'lucide-react';
import AccountResetButton from './AccountResetButton';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

interface AdminHeaderProps {
  onSignOut: () => void;
  userEmail?: string;
}

export default function AdminHeader({ onSignOut, userEmail }: AdminHeaderProps) {
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          {userEmail && (
            <p className="text-sm text-muted-foreground mt-1">
              Signed in as: {userEmail}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <AccountResetButton />
          <Button 
            variant="destructive"
            size="sm"
            onClick={onSignOut}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
      
      <Card className="mb-4 border-orange-200 bg-orange-50">
        <CardHeader className="py-3">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="h-5 w-5 text-orange-600" />
            <CardTitle className="text-base text-orange-800">Admin Access</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="py-3 text-sm text-orange-700 flex justify-between items-center">
          <p>You are now in admin mode. Changes made here will affect the live website.</p>
          <span className="font-mono text-xs text-orange-500">v1.7.0</span>
        </CardContent>
      </Card>
    </>
  );
}
