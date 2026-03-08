import AdminHeader from "@/components/admin/AdminHeader";
import AdminLoginView from "@/components/admin/AdminLoginView";
import AccountingDashboard from "@/components/admin/accounting/AccountingDashboard";
import XeroConnectionStatus from "@/components/admin/XeroConnectionStatus";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import LoadingSpinner from "@/components/ui/loading-spinner";

export default function Admin() {
  const {
    isAuthenticated,
    setIsAuthenticated,
    isLoading,
    user,
    handleSignOut,
    signIn
  } = useAdminAuth();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <LoadingSpinner size="lg" text="Loading..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AdminLoginView 
        onLoginSuccess={() => setIsAuthenticated(true)}
        signIn={signIn}
      />
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <AdminHeader 
        onSignOut={handleSignOut()}
        userEmail={user?.email}
      />
      <div className="mt-6">
        <XeroConnectionStatus />
      </div>
      <div className="mt-6">
        <AccountingDashboard />
      </div>
    </div>
  );
}
