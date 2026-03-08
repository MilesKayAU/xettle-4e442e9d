import React, { useState } from 'react';
import { toast } from "@/hooks/use-toast";
import AddProductCard from './product/AddProductCard';
import ProductList from './product/ProductList';
import EditProductDialog from './product/EditProductDialog';
import ProductImageManagerSupabase from './ProductImageManagerSupabase';
import { ProductFormValues } from './product/product-schema';
import { useProducts } from '@/hooks/use-products';
import { ProductService, Product } from '@/services/product-service';

const ProductManagement: React.FC = () => {
  const { products, fetchProducts, isLoading } = useProducts();
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showEditProductDialog, setShowEditProductDialog] = useState(false);
  const [showImageManagerDialog, setShowImageManagerDialog] = useState(false);
  const [selectedProductSlug, setSelectedProductSlug] = useState<string | null>(null);

  const handleAddProduct = async (values: ProductFormValues) => {
    try {
      // Ensure all required fields are present
      const productData = {
        title: values.title,
        description: values.description,
        category: values.category
      };
      
      const newProduct = await ProductService.create(productData);
      
      if (newProduct) {
        await fetchProducts(); // Refresh the list
        toast({
          title: "Product added",
          description: "The product has been successfully added.",
        });
      } else {
        throw new Error('Failed to create product');
      }
    } catch (error: any) {
      toast({
        title: "Error adding product",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setShowEditProductDialog(true);
  };
  
  const handleSaveEditedProduct = async (values: ProductFormValues) => {
    if (!editingProduct) return;
    
    try {
      // Ensure all required fields are present
      const productData = {
        title: values.title,
        description: values.description,
        category: values.category
      };
      
      const updatedProduct = await ProductService.update(editingProduct.id, productData);
      
      if (updatedProduct) {
        await fetchProducts(); // Refresh the list
        toast({
          title: "Product updated",
          description: "The product has been successfully updated."
        });
        
        setShowEditProductDialog(false);
        setEditingProduct(null);
      } else {
        throw new Error('Failed to update product');
      }
    } catch (error: any) {
      toast({
        title: "Error updating product",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      const success = await ProductService.delete(id);
      
      if (success) {
        await fetchProducts(); // Refresh the list
        toast({
          title: "Product deleted",
          description: "The product has been successfully removed.",
        });
      } else {
        throw new Error('Failed to delete product');
      }
    } catch (error: any) {
      toast({
        title: "Error deleting product",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleOpenImageManager = (product: Product) => {
    if (!product.slug) {
      toast({
        title: "Error",
        description: "Product slug is missing.",
        variant: "destructive"
      });
      return;
    }
    
    setSelectedProductSlug(product.slug);
    setShowImageManagerDialog(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <p>Loading products...</p>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-1">
        <AddProductCard onAddProduct={handleAddProduct} />
      </div>
      
      <div className="md:col-span-2">
        <ProductList 
          products={products} 
          onEdit={handleEditProduct} 
          onDelete={handleDeleteProduct}
          onManageImages={handleOpenImageManager}
        />
      </div>
      
      <EditProductDialog 
        open={showEditProductDialog} 
        onOpenChange={setShowEditProductDialog}
        product={editingProduct}
        onSave={handleSaveEditedProduct}
      />
      
      {/* Product Image Manager Dialog */}
      {showImageManagerDialog && selectedProductSlug && (
        <ProductImageManagerSupabase
          open={showImageManagerDialog}
          onOpenChange={setShowImageManagerDialog}
          productSlug={selectedProductSlug}
        />
      )}
    </div>
  );
};

export default ProductManagement;
