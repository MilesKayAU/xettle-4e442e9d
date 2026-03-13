import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoadingSpinner from "@/components/ui/loading-spinner";
import PinGate from "@/components/PinGate";
import BugReportButton from "@/components/bug-report/BugReportButton";
import AuthenticatedLayout from "@/components/AuthenticatedLayout";

const Landing = lazy(() => import("@/pages/Landing"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Admin = lazy(() => import("@/pages/Admin"));
const Auth = lazy(() => import("@/pages/Auth"));
const XeroCallback = lazy(() => import("@/pages/XeroCallback"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const AmazonCallback = lazy(() => import("@/pages/AmazonCallback"));
const ShopifyCallback = lazy(() => import("@/pages/ShopifyCallback"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Setup = lazy(() => import("@/pages/Setup"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <PinGate>
              <Suspense fallback={
                <div className="flex items-center justify-center min-h-screen">
                  <LoadingSpinner size="lg" text="Loading..." />
                </div>
              }>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/xero/callback" element={<XeroCallback />} />
                  <Route path="/amazon/callback" element={<AmazonCallback />} />
                  <Route path="/shopify/callback" element={<ShopifyCallback />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/pricing" element={<Pricing />} />
                  {/* Authenticated routes — trial banner renders on all */}
                  <Route element={<AuthenticatedLayout />}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/setup" element={<Setup />} />
                    <Route path="/admin" element={<Admin />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </PinGate>
            <BugReportButton />
            <Toaster />
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
