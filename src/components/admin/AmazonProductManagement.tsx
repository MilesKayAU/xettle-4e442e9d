
import React, { useState, useEffect } from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, RefreshCw, LinkIcon, Trash2, Filter, Search, Save } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';

const asinFormSchema = z.object({
  asins: z.string().min(1, { message: "Please enter at least one ASIN" }),
});

const urlFormSchema = z.object({
  url: z.string().url({ message: "Please enter a valid Amazon URL" }),
});

interface AmazonProduct {
  id: string;
  asin: string;
  title: string;
  price: number | null;
  currency: string | null;
  brand: string | null;
  category: string | null;
  synced_at: string | null;
  sync_status: string | null;
  local_product_id: string | null;
}

interface SyncLog {
  id: string;
  start_time: string;
  end_time: string | null;
  status: string;
  products_synced: number;
  details: string | null;
}

const AmazonProductManagement: React.FC = () => {
  const [products, setProducts] = useState<AmazonProduct[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const asinForm = useForm<z.infer<typeof asinFormSchema>>({
    resolver: zodResolver(asinFormSchema),
    defaultValues: {
      asins: '',
    }
  });
  
  const urlForm = useForm<z.infer<typeof urlFormSchema>>({
    resolver: zodResolver(urlFormSchema),
    defaultValues: {
      url: '',
    }
  });

  const fetchProducts = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('amazon_products')
        .select('*')
        .order('synced_at', { ascending: false });
        
      if (error) {
        throw error;
      }
      
      setProducts(data || []);
    } catch (error: any) {
      toast({
        title: "Error fetching products",
        description: error.message || "An error occurred",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const fetchSyncLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('amazon_sync_logs')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(5);
        
      if (error) {
        throw error;
      }
      
      setSyncLogs(data || []);
    } catch (error: any) {
      toast({
        title: "Error fetching sync logs",
        description: error.message || "An error occurred",
        variant: "destructive"
      });
    }
  };
  
  useEffect(() => {
    fetchProducts();
    fetchSyncLogs();
    checkAuthStatus();
  }, []);
  
  const checkAuthStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setAuthError("You are not authenticated. Please log in to use this feature.");
      } else {
        setAuthError(null);
      }
    } catch (error: any) {
      console.error("Auth check error:", error);
      setAuthError(`Authentication error: ${error.message}`);
    }
  };
  
  const extractAsinFromUrl = (url: string): string | null => {
    // Extract ASIN from Amazon URL
    // Common patterns:
    // https://www.amazon.com/dp/XXXXXXXXXX
    // https://www.amazon.com/gp/product/XXXXXXXXXX
    // https://www.amazon.com/*/dp/XXXXXXXXXX
    // https://www.amazon.com/*/XXXXXXXXXX/
    
    let asin: string | null = null;
    
    // Pattern: /dp/XXXXXXXXXX
    const dpPattern = /\/dp\/([A-Z0-9]{10})/i;
    const dpMatch = url.match(dpPattern);
    if (dpMatch && dpMatch[1]) {
      asin = dpMatch[1];
      return asin;
    }
    
    // Pattern: /gp/product/XXXXXXXXXX
    const gpPattern = /\/gp\/product\/([A-Z0-9]{10})/i;
    const gpMatch = url.match(gpPattern);
    if (gpMatch && gpMatch[1]) {
      asin = gpMatch[1];
      return asin;
    }
    
    // Pattern: ASIN in URL path
    const asinPattern = /\/([A-Z0-9]{10})(?:\/|\?|$)/i;
    const asinMatch = url.match(asinPattern);
    if (asinMatch && asinMatch[1]) {
      asin = asinMatch[1];
      return asin;
    }
    
    return asin;
  };
  
  const onSubmitURL = async (values: z.infer<typeof urlFormSchema>) => {
    setIsSyncing(true);
    
    try {
      const asin = extractAsinFromUrl(values.url);
      
      if (!asin) {
        throw new Error("Could not extract ASIN from the provided URL");
      }
      
      // Get the current authenticated user ID
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error("Authentication required. Please log in and try again.");
      }

      console.log("Calling edge function with user:", user.id, "and ASIN:", asin);
      
      // Call the Supabase edge function to sync products with the extracted ASIN
      const { data, error } = await supabase.functions.invoke('sync-amazon-products', {
        body: { 
          asins: [asin],
          userId: user.id
        }
      });
      
      console.log("Edge function response:", data, "Error:", error);
      
      if (error) {
        throw new Error(error.message || "Failed to sync product");
      }
      
      if (data && data.error) {
        throw new Error(data.message || data.error || "Failed to sync product");
      }
      
      toast({
        title: "Sync initiated",
        description: `Syncing Amazon product with ASIN: ${asin}`,
      });
      
      // Refresh the product list and sync logs
      await fetchProducts();
      await fetchSyncLogs();
      
      // Reset the form
      urlForm.reset();
      
    } catch (error: any) {
      console.error("Sync error:", error);
      toast({
        title: "Sync failed",
        description: error.message || "An error occurred during sync",
        variant: "destructive"
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const onSubmitASINs = async (values: z.infer<typeof asinFormSchema>) => {
    setIsSyncing(true);
    
    try {
      // Split ASINs by commas, spaces, or new lines and trim whitespace
      const asinList = values.asins
        .split(/[\s,\n]+/)
        .map(asin => asin.trim())
        .filter(asin => asin.length > 0);
      
      if (asinList.length === 0) {
        throw new Error("No valid ASINs provided");
      }
      
      // Get the current authenticated user ID
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error("Authentication required. Please log in and try again.");
      }
      
      console.log("Calling edge function with user:", user.id, "and ASINs:", asinList);
      
      // Call the Supabase edge function to sync products
      const { data, error } = await supabase.functions.invoke('sync-amazon-products', {
        body: { 
          asins: asinList,
          userId: user.id
        }
      });
      
      console.log("Edge function response:", data, "Error:", error);
      
      if (error) {
        throw new Error(error.message || "Failed to sync products");
      }
      
      if (data && data.error) {
        throw new Error(data.message || data.error || "Failed to sync products");
      }
      
      toast({
        title: "Sync initiated",
        description: `Syncing ${asinList.length} products from Amazon`,
      });
      
      // Refresh the product list and sync logs
      await fetchProducts();
      await fetchSyncLogs();
      
      // Reset the form
      asinForm.reset();
      
    } catch (error: any) {
      console.error("Sync error:", error);
      toast({
        title: "Sync failed",
        description: error.message || "An error occurred during sync",
        variant: "destructive"
      });
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Filter products based on search term
  const filteredProducts = searchTerm 
    ? products.filter(product => 
        product.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.asin.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.brand && product.brand.toLowerCase().includes(searchTerm.toLowerCase())))
    : products;
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        {authError && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardHeader className="py-3">
              <CardTitle className="text-base text-red-800">Authentication Error</CardTitle>
            </CardHeader>
            <CardContent className="py-3 text-sm text-red-700">
              <p>{authError}</p>
              <p className="mt-2">Please sign in with a Supabase account to use this feature.</p>
            </CardContent>
          </Card>
        )}
      
        <Card>
          <CardHeader>
            <CardTitle>Sync by Amazon URL</CardTitle>
            <CardDescription>Enter an Amazon product URL to sync</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...urlForm}>
              <form onSubmit={urlForm.handleSubmit(onSubmitURL)} className="space-y-4">
                <FormField
                  control={urlForm.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amazon Product URL</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="https://www.amazon.com/dp/XXXXXXXXXX" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSyncing || !!authError}>
                  {isSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync by URL
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Sync by ASIN</CardTitle>
            <CardDescription>Enter Amazon Standard Identification Numbers</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...asinForm}>
              <form onSubmit={asinForm.handleSubmit(onSubmitASINs)} className="space-y-4">
                <FormField
                  control={asinForm.control}
                  name="asins"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amazon ASINs</FormLabel>
                      <FormControl>
                        <textarea 
                          placeholder="Enter ASINs separated by commas or new lines" 
                          className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSyncing || !!authError}>
                  {isSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync by ASINs
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent Sync Activities</CardTitle>
            <CardDescription>Status of recent product synchronizations</CardDescription>
          </CardHeader>
          <CardContent>
            {syncLogs.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No sync activities found
              </div>
            ) : (
              <div className="space-y-4">
                {syncLogs.map((log) => (
                  <div key={log.id} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">
                        {format(new Date(log.start_time), 'MMM d, yyyy h:mm a')}
                      </div>
                      <Badge 
                        variant={
                          log.status === 'completed' ? 'default' :
                          log.status === 'in_progress' ? 'outline' :
                          log.status === 'completed_with_errors' ? 'secondary' :
                          'destructive'
                        }
                      >
                        {log.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {log.details && <p className="text-sm mt-1 text-muted-foreground">{log.details}</p>}
                    {log.products_synced > 0 && (
                      <p className="text-sm mt-1">
                        Products synced: <span className="font-medium">{log.products_synced}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button variant="outline" size="sm" onClick={fetchSyncLogs}>
              <RefreshCw className="mr-2 h-3 w-3" />
              Refresh
            </Button>
          </CardFooter>
        </Card>
      </div>
      
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Amazon Products</CardTitle>
            <CardDescription>Manage your imported Amazon products</CardDescription>
            <div className="flex items-center mt-2 gap-2">
              <Input 
                placeholder="Search products..." 
                className="max-w-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={fetchProducts}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {products.length === 0 ? 
                  "No Amazon products found. Sync products to get started." : 
                  "No products matching your search criteria."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ASIN</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.asin}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{product.title}</TableCell>
                        <TableCell>{product.brand || "—"}</TableCell>
                        <TableCell>
                          {product.price ? `${product.currency || 'USD'} ${product.price}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={
                              product.sync_status === 'synced' ? 'default' :
                              product.sync_status === 'pending' ? 'outline' :
                              product.sync_status === 'error' ? 'destructive' :
                              'secondary'
                            }
                          >
                            {product.sync_status || "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" className="mr-2" asChild>
                            <a href={`https://amazon.com/dp/${product.asin}`} target="_blank" rel="noopener noreferrer">
                              <LinkIcon className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button variant="outline" size="sm">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AmazonProductManagement;
