
import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import LoginForm from "@/components/admin/LoginForm";

interface AdminLoginViewProps {
  onLoginSuccess: () => void;
  signIn: (email: string, password: string) => Promise<any>;
}

export default function AdminLoginView({ onLoginSuccess, signIn }: AdminLoginViewProps) {
  return (
    <div className="container mx-auto py-16 px-4">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>
            Sign in to access the admin dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm 
            onLoginSuccess={onLoginSuccess}
            signIn={signIn}
          />
        </CardContent>
      </Card>
    </div>
  );
}
