import { Suspense } from "react";
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
import { AuthProvider } from "@/contexts/AuthContext";
import { lazyWithRetry } from "@/utils/lazy-with-retry";

const Landing = lazyWithRetry(() => import("@/pages/Landing"));
const Dashboard = lazyWithRetry(() => import("@/pages/Dashboard"));
const Admin = lazyWithRetry(() => import("@/pages/Admin"));
const Auth = lazyWithRetry(() => import("@/pages/Auth"));
const XeroCallback = lazyWithRetry(() => import("@/pages/XeroCallback"));
const Privacy = lazyWithRetry(() => import("@/pages/Privacy"));
const Terms = lazyWithRetry(() => import("@/pages/Terms"));
const ResetPassword = lazyWithRetry(() => import("@/pages/ResetPassword"));
const AmazonCallback = lazyWithRetry(() => import("@/pages/AmazonCallback"));
const ShopifyCallback = lazyWithRetry(() => import("@/pages/ShopifyCallback"));
const EbayCallback = lazyWithRetry(() => import("@/pages/EbayCallback"));
const Pricing = lazyWithRetry(() => import("@/pages/Pricing"));
const Amazon = lazyWithRetry(() => import("@/pages/Amazon"));
const Marketplaces = lazyWithRetry(() => import("@/pages/Marketplaces"));
const Insights = lazyWithRetry(() => import("@/pages/Insights"));
const Setup = lazyWithRetry(() => import("@/pages/Setup"));
const XeroPostingAudit = lazyWithRetry(() => import("@/pages/XeroPostingAudit"));
const FulfillmentBridge = lazyWithRetry(() => import("@/pages/FulfillmentBridge"));
const NotFound = lazyWithRetry(() => import("@/pages/NotFound"));

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
            <AuthProvider>
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
                  <Route path="/ebay/callback" element={<EbayCallback />} />
                  <Route path="/shopify/callback" element={<ShopifyCallback />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/amazon" element={<Amazon />} />
                  <Route path="/fulfillment-bridge" element={<FulfillmentBridge />} />
                  <Route path="/marketplaces" element={<Marketplaces />} />
                  <Route path="/insights" element={<Insights />} />
                  {/* Authenticated routes — trial banner renders on all */}
                  <Route element={<AuthenticatedLayout />}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/setup" element={<Setup />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/audit/xero-posting" element={<XeroPostingAudit />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </PinGate>
            </AuthProvider>
            <BugReportButton />
            <Toaster />
            <SonnerToaster position="bottom-right" richColors />
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
