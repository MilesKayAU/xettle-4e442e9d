

# Plan: Strip Project to Accounting Module Only

## Summary
Remove all e-commerce, blog, chat, Alibaba, logistics, and inventory features. Keep only the accounting/Xero integration and auth. Make AccountingDashboard the main page after login.

## Files to KEEP (modify some)
- `src/App.tsx` — Simplify routes to: `/` (accounting dashboard behind auth), `/auth`, `/auth/xero/callback`
- `src/pages/Auth.tsx` — Keep, redirect to `/` on login (already does this)
- `src/pages/XeroCallback.tsx` — Keep as-is
- `src/components/admin/accounting/AccountingDashboard.tsx` — Keep as-is
- `src/components/admin/XeroConnectionStatus.tsx` — Keep as-is
- `src/components/admin/AdminHeader.tsx` — Keep (sign out, user info)
- `src/components/admin/AdminLoginView.tsx` — Keep
- `src/components/admin/LoginForm.tsx` — Keep
- `src/hooks/use-admin-auth.tsx` — Keep
- `src/utils/settlement-parser.ts` — Keep
- `src/utils/xero-csv-export.ts` — Keep
- `src/utils/input-sanitization.ts` — Keep (used by Auth)
- `src/integrations/supabase/client.ts` — Keep
- `src/integrations/supabase/client-extended.ts` — Keep
- `src/integrations/supabase/types.ts` — Keep
- `src/components/ui/*` — Keep all UI primitives
- `src/components/ErrorBoundary.tsx` — Keep
- `src/lib/utils.ts` — Keep
- `supabase/functions/xero-auth/index.ts` — Keep
- `supabase/functions/sync-amazon-journal/index.ts` — Keep
- All config files (vite, tailwind, tsconfig, etc.) — Keep

## Files to DELETE (~60+ files)
### Pages
- `src/pages/Index.tsx`, `Products.tsx`, `ProductDetail.tsx`, `Blog.tsx`, `BlogPost.tsx`, `Contact.tsx`, `Distributors.tsx`, `WhereToBuy.tsx`, `PurchaseOrders.tsx`, `POApproval.tsx`, `Header.tsx` (duplicate page)

### Components
- `src/components/Header.tsx`, `Footer.tsx`, `ChatMessenger.tsx`
- `src/components/AiBlogEditor.tsx`, `AiContentGenerator.tsx`, `AiImageGenerator.tsx`
- `src/components/DistributorApplicationsManager.tsx`
- `src/components/SEO/*` (all SEO components)
- `src/components/chat/*` (all chat components)
- `src/components/distributor/*` (all distributor components)
- `src/components/purchase-orders/*` (all PO components)
- `src/components/admin/AdminTabs.tsx` — Delete (replaced by direct AccountingDashboard rendering)
- `src/components/admin/AlibabaManagement.tsx`, `AlibabaAccountSettings.tsx`, `AmazonProductManagement.tsx`
- `src/components/admin/BlogManagement.tsx`, `BlogPostItem.tsx`, `EditBlogPostDialog.tsx`
- `src/components/admin/ContactMessagesManager.tsx`, `DistributorManagement.tsx`
- `src/components/admin/DataManipulationTools.tsx`, `DataTable.tsx`, `DataUploadManager.tsx`
- `src/components/admin/EnhancedAlibabaInvoiceForm.tsx`, `QuickAlibabaInvoiceCreator.tsx`
- `src/components/admin/FaqManagement.tsx`, `LogisticsManagement.tsx`
- `src/components/admin/NotificationSettings.tsx`, `PasswordChangeDialog.tsx`
- `src/components/admin/PaymentMethodsSettings.tsx`, `ProductImageManager.tsx`, `ProductImageManagerSupabase.tsx`
- `src/components/admin/ProductManagement.tsx`, `ProductSupplierLinker.tsx`
- `src/components/admin/PurchaseOrderManagement.tsx`, `ReportsManagement.tsx`
- `src/components/admin/SheetSelector.tsx`, `SupabaseAuthDialog.tsx`, `SupplierTable.tsx`
- `src/components/admin/WhereToBuyManagement.tsx`, `ArrivalDateReviewDialog.tsx`
- `src/components/admin/product/*` (all product sub-components)
- `src/components/admin/reports/*` (all report components)
- `src/components/admin/AIDataOrchestrator.tsx`
- `src/components/admin/types.ts` — Delete (BlogPost type no longer needed)

### Hooks
- `src/hooks/use-blog-posts.ts`, `use-forecast-calculations.ts`, `use-ignored-products.ts`
- `src/hooks/use-inventory-data.ts`, `use-inventory-database.ts`, `use-inventory-upload.ts`
- `src/hooks/use-logistics.ts`, `use-notification-settings.ts`, `use-payment-methods.ts`
- `src/hooks/use-product-images.tsx`, `use-product-images-supabase.ts`, `use-products.ts`
- `src/hooks/use-purchase-orders.ts`, `use-seo.ts`, `use-supabase-config.ts`
- `src/hooks/useDistributorForm.ts`, `useDistributorSubmission.ts`
- `src/hooks/useForecastSettings.ts`, `useSupplierMapping.ts`
- `src/hooks/use-alibaba-accounts.ts`

### Utils
- `src/utils/arrival-date-extractor.ts`, `australian-seo-utils.ts`, `blogApi.ts`
- `src/utils/image-utils.ts`, `inventory-calculations.ts`, `logistics-parser.ts`
- `src/utils/seo-utils.ts`, `xero-po-export.ts`

### Services
- `src/services/*` (all service files)

### Types
- `src/types/blog.d.ts`, `globals.d.ts`, `inventory.ts`, `product-images.ts`, `purchase-orders.ts`, `supabase-types.ts`
- `src/constants/inventory-mapping.ts`

### Edge Functions to DELETE
- `supabase/functions/ai-data-orchestrator/`, `extract-invoice-data/`, `get-exchange-rate/`
- `supabase/functions/notify-po-approval/`, `parse-alibaba-order/`, `parse-alibaba-pdfs/`
- `supabase/functions/process-data-upload/`, `send-invoice-notification/`, `send-purchase-order/`
- `supabase/functions/sync-amazon-products/`, `sync-google-sheets/`, `sync-to-xero/`

## Key Modifications

### `src/App.tsx`
- Remove Header, Footer, SitemapGenerator, ChatMessenger
- Routes: `/` renders a protected accounting page (auth check + AccountingDashboard), `/auth` renders Auth, `/auth/xero/callback` renders XeroCallback, `*` renders NotFound
- Create a simple `ProtectedRoute` wrapper using `useAdminAuth`

### `src/pages/Admin.tsx` → Repurpose as Home Page
- Remove AdminTabs, BlogPost state
- Render AdminHeader + AccountingDashboard + XeroConnectionStatus directly
- This becomes the `/` route

### `src/pages/Auth.tsx`
- Remove signup tab (admin-only app), or keep if desired
- Navigate to `/` on success (already does this)

