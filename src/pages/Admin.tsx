
import { useState, useEffect } from "react";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminLoginView from "@/components/admin/AdminLoginView";
import PasswordChangeDialog from "@/components/admin/PasswordChangeDialog";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { BlogPost } from "@/components/admin/types";

export default function Admin() {
  const {
    isAuthenticated,
    setIsAuthenticated,
    isLoading,
    session,
    user,
    handleSignOut,
    signIn
  } = useAdminAuth();
  
  
  
  // Blog posts state (products are now managed by useProducts hook)
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);

  if (isLoading) {
    return (
      <div className="container mx-auto py-16">
        <div className="flex justify-center items-center min-h-[50vh]">
          <p>Loading...</p>
        </div>
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
    <div className="container mx-auto py-16 px-4">
      <AdminHeader 
        onSignOut={handleSignOut()}
        userEmail={user?.email}
      />
      
      <AdminTabs 
        blogPosts={blogPosts}
        setBlogPosts={setBlogPosts}
      />
    </div>
  );
}
