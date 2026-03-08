import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Package, FileText, Users, BarChart3, Database, ShoppingCart, ClipboardList, Settings, Link2, CreditCard, Ship, DollarSign } from "lucide-react";
import ProductManagement from "@/components/admin/ProductManagement";
import BlogManagement from "@/components/admin/BlogManagement";
import DistributorManagement from "@/components/admin/DistributorManagement";
import ContactMessagesManager from "@/components/admin/ContactMessagesManager";
import FaqManagement from "@/components/admin/FaqManagement";
import WhereToBuyManagement from "@/components/admin/WhereToBuyManagement";
import ReportsManagement from "@/components/admin/ReportsManagement";
import SupplierTable from "@/components/admin/SupplierTable";
import ProductSupplierLinker from "@/components/admin/ProductSupplierLinker";
import { ProductIgnoreManager } from "@/components/admin/reports/ProductIgnoreManager";
import DataUploadManager from "@/components/admin/DataUploadManager";
import AlibabaManagement from "@/components/admin/AlibabaManagement";
import { PurchaseOrderManagement } from "@/components/admin/PurchaseOrderManagement";
import AlibabaAccountSettings from "@/components/admin/AlibabaAccountSettings";
import PaymentMethodsSettings from "@/components/admin/PaymentMethodsSettings";
import LogisticsManagement from "@/components/admin/LogisticsManagement";
import AccountingDashboard from "@/components/admin/accounting/AccountingDashboard";
import XeroConnectionStatus from "@/components/admin/XeroConnectionStatus";
import { BlogPost } from "@/components/admin/types";
import { useInventoryData } from "@/hooks/use-inventory-data";

interface AdminTabsProps {
  blogPosts: BlogPost[];
  setBlogPosts: React.Dispatch<React.SetStateAction<BlogPost[]>>;
}

// Tab groups for organization
const tabGroups = {
  content: [
    { value: 'products', label: 'Products', icon: Package },
    { value: 'blog', label: 'Blog', icon: FileText },
    { value: 'where-to-buy', label: 'Where to Buy', icon: ShoppingCart },
    { value: 'faq', label: 'FAQ', icon: FileText },
  ],
  communications: [
    { value: 'distributors', label: 'Distributors', icon: Users },
    { value: 'contact', label: 'Messages', icon: FileText },
  ],
  inventory: [
    { value: 'reports', label: 'Reports', icon: BarChart3 },
    { value: 'suppliers', label: 'Suppliers', icon: Users },
    { value: 'product-links', label: 'Product Links', icon: Package },
    { value: 'ignored-products', label: 'Ignored', icon: Package },
    { value: 'data-upload', label: 'Data Upload', icon: Database },
    { value: 'alibaba', label: 'Alibaba', icon: ShoppingCart },
    { value: 'logistics', label: 'Logistics', icon: Ship },
    { value: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
    { value: 'alibaba-accounts', label: 'Alibaba Accounts', icon: Settings },
    { value: 'payment-methods', label: 'Payment Methods', icon: CreditCard },
    { value: 'integrations', label: 'Integrations', icon: Link2 },
  ],
};

const allTabs = [...tabGroups.content, ...tabGroups.communications, ...tabGroups.inventory];

export default function AdminTabs({ blogPosts, setBlogPosts }: AdminTabsProps) {
  const { uploadedData, loadUserInventoryData } = useInventoryData();
  const [activeTab, setActiveTab] = useState('products');

  React.useEffect(() => {
    loadUserInventoryData();
  }, [loadUserInventoryData]);

  const triggerClass = "text-gray-700 data-[state=active]:bg-green-600 data-[state=active]:text-white hover:bg-gray-50 text-sm px-3";

  const getActiveTabLabel = (groupTabs: typeof tabGroups.content) => {
    const activeInGroup = groupTabs.find(t => t.value === activeTab);
    return activeInGroup?.label;
  };

  const isActiveInGroup = (groupTabs: typeof tabGroups.content) => {
    return groupTabs.some(t => t.value === activeTab);
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="mb-4 bg-white border border-gray-200 shadow-sm flex-wrap h-auto gap-1 p-1">
        {/* Content Group - Primary tabs shown directly */}
        <TabsTrigger value="products" className={triggerClass}>
          Products
        </TabsTrigger>
        <TabsTrigger value="blog" className={triggerClass}>
          Blog
        </TabsTrigger>
        
        {/* Content Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className={`text-sm px-3 h-8 ${isActiveInGroup([tabGroups.content[2], tabGroups.content[3]]) ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {getActiveTabLabel([tabGroups.content[2], tabGroups.content[3]]) || 'More Content'}
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-white z-50">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Content</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setActiveTab('where-to-buy')} className={activeTab === 'where-to-buy' ? 'bg-green-50' : ''}>
              Where to Buy
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('faq')} className={activeTab === 'faq' ? 'bg-green-50' : ''}>
              FAQ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Communications Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className={`text-sm px-3 h-8 ${isActiveInGroup(tabGroups.communications) ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <Users className="mr-1 h-3 w-3" />
              {getActiveTabLabel(tabGroups.communications) || 'Communications'}
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-white z-50">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Communications</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setActiveTab('distributors')} className={activeTab === 'distributors' ? 'bg-green-50' : ''}>
              Distributor Inquiries
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('contact')} className={activeTab === 'contact' ? 'bg-green-50' : ''}>
              Contact Messages
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Inventory & Reports Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className={`text-sm px-3 h-8 ${isActiveInGroup(tabGroups.inventory) ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <BarChart3 className="mr-1 h-3 w-3" />
              {getActiveTabLabel(tabGroups.inventory) || 'Inventory'}
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-white z-50">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Reports & Data</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setActiveTab('reports')} className={activeTab === 'reports' ? 'bg-green-50' : ''}>
              Reports
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('data-upload')} className={activeTab === 'data-upload' ? 'bg-green-50' : ''}>
              Data Upload & AI
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Suppliers</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setActiveTab('suppliers')} className={activeTab === 'suppliers' ? 'bg-green-50' : ''}>
              Suppliers
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('product-links')} className={activeTab === 'product-links' ? 'bg-green-50' : ''}>
              Product Links
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('ignored-products')} className={activeTab === 'ignored-products' ? 'bg-green-50' : ''}>
              Ignored Products
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Purchasing</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setActiveTab('purchase-orders')} className={activeTab === 'purchase-orders' ? 'bg-green-50' : ''}>
              Purchase Orders
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('alibaba')} className={activeTab === 'alibaba' ? 'bg-green-50' : ''}>
              Alibaba Invoices
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('logistics')} className={activeTab === 'logistics' ? 'bg-green-50' : ''}>
              <Ship className="mr-2 h-4 w-4" />
              Logistics
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Settings</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setActiveTab('alibaba-accounts')} className={activeTab === 'alibaba-accounts' ? 'bg-green-50' : ''}>
                  <Settings className="mr-2 h-4 w-4" />
                  Alibaba Accounts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('payment-methods')} className={activeTab === 'payment-methods' ? 'bg-green-50' : ''}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Payment Methods
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('integrations')} className={activeTab === 'integrations' ? 'bg-green-50' : ''}>
                  <Link2 className="mr-2 h-4 w-4" />
                  Integrations (Xero)
                </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Accounting Tab - Standalone */}
        <TabsTrigger value="accounting" className={triggerClass}>
          <DollarSign className="mr-1 h-3 w-3" />
          Accounting
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="products">
        <ProductManagement />
      </TabsContent>
      
      <TabsContent value="where-to-buy">
        <WhereToBuyManagement />
      </TabsContent>
      
      <TabsContent value="blog">
        <BlogManagement 
          blogPosts={blogPosts} 
          setBlogPosts={setBlogPosts} 
        />
      </TabsContent>
      
      <TabsContent value="distributors">
        <DistributorManagement />
      </TabsContent>
      
      <TabsContent value="contact">
        <ContactMessagesManager />
      </TabsContent>
      
      <TabsContent value="faq">
        <FaqManagement />
      </TabsContent>
      
      <TabsContent value="reports">
        <ReportsManagement />
      </TabsContent>
      
      <TabsContent value="suppliers">
        <SupplierTable />
      </TabsContent>
      
      <TabsContent value="product-links">
        <ProductSupplierLinker inventoryData={uploadedData} onDataUpdate={loadUserInventoryData} />
      </TabsContent>
      
      <TabsContent value="ignored-products">
        <ProductIgnoreManager />
      </TabsContent>
      
      <TabsContent value="data-upload">
        <DataUploadManager />
      </TabsContent>
      
      <TabsContent value="alibaba">
        <AlibabaManagement />
      </TabsContent>
      
      <TabsContent value="purchase-orders">
        <PurchaseOrderManagement />
      </TabsContent>

      <TabsContent value="logistics">
        <LogisticsManagement />
      </TabsContent>
      
      <TabsContent value="alibaba-accounts">
        <AlibabaAccountSettings />
      </TabsContent>
      
      <TabsContent value="payment-methods">
        <PaymentMethodsSettings />
      </TabsContent>
      
      <TabsContent value="integrations">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight mb-2">Integrations</h2>
            <p className="text-muted-foreground">Connect external services to sync your data automatically.</p>
          </div>
          <XeroConnectionStatus />
        </div>
      </TabsContent>

      <TabsContent value="accounting">
        <AccountingDashboard />
      </TabsContent>
    </Tabs>
  );
}
