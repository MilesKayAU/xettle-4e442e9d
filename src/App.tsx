// App entry point - v2
import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoadingSpinner from "@/components/ui/loading-spinner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SitemapGenerator from "@/components/SEO/SitemapGenerator";

const Index = lazy(() => import("@/pages/Index"));
const Products = lazy(() => import("@/pages/Products"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const Distributors = lazy(() => import("@/pages/Distributors"));
const Contact = lazy(() => import("@/pages/Contact"));
const WhereToBuy = lazy(() => import("@/pages/WhereToBuy"));
const Admin = lazy(() => import("@/pages/Admin"));
const PurchaseOrders = lazy(() => import("@/pages/PurchaseOrders"));
const POApproval = lazy(() => import("@/pages/POApproval"));
const Auth = lazy(() => import("@/pages/Auth"));
const XeroCallback = lazy(() => import("@/pages/XeroCallback"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const ChatMessenger = lazy(() => import("@/components/ChatMessenger"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});

// Layout wrapper that conditionally shows header/footer
const AppLayout = () => {
  const location = useLocation();
  const isPublicApprovalPage = location.pathname.startsWith('/po-approval/');

  return (
    <div className="min-h-screen flex flex-col">
      {!isPublicApprovalPage && <Header />}
      <main className="flex-1">
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[50vh]">
            <LoadingSpinner size="lg" text="Loading..." />
          </div>
        }>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:slug" element={<ProductDetail />} />
            <Route path="/distributors" element={<Distributors />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/where-to-buy" element={<WhereToBuy />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/purchase-orders" element={<PurchaseOrders />} />
            <Route path="/po-approval/:token" element={<POApproval />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/xero/callback" element={<XeroCallback />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {!isPublicApprovalPage && <Footer />}
      {!isPublicApprovalPage && <SitemapGenerator />}
      
      {/* Lazy-loaded ChatMessenger - only show on internal pages */}
      {!isPublicApprovalPage && (
        <Suspense fallback={null}>
          <ChatMessenger />
        </Suspense>
      )}
    </div>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <AppLayout />
            <Toaster />
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
