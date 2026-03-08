
import React, { useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Product } from "@/services/product-service";
import ProductCard from './ProductCard';

interface ProductListProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onManageImages: (product: Product) => void;
}

const ProductList: React.FC<ProductListProps> = ({ 
  products, 
  onEdit, 
  onDelete,
  onManageImages 
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple search functionality
  const filteredProducts = searchTerm 
    ? products.filter(product => 
        product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.description.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : products;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Products</CardTitle>
        <CardDescription>View and edit your existing products</CardDescription>
        <div className="flex items-center mt-2 gap-2">
          <Input 
            placeholder="Search products..." 
            className="max-w-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Button variant="outline" size="sm">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {filteredProducts.length > 0 ? (
            filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={onEdit}
                onDelete={onDelete}
                onManageImages={onManageImages}
              />
            ))
          ) : (
            <p className="text-center py-4 text-muted-foreground">
              {searchTerm ? "No products match your search." : "No products available."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductList;
