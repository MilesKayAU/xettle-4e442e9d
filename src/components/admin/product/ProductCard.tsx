
import React from 'react';
import { Edit, Trash2, Upload } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Product } from "@/services/product-service";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onManageImages: (product: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ 
  product, 
  onEdit, 
  onDelete,
  onManageImages 
}) => {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div>
        <h3 className="font-medium">{product.title}</h3>
        <p className="text-sm text-muted">{product.category}</p>
        <p className="text-sm">{product.description}</p>
      </div>
      <div className="flex gap-2">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => onManageImages(product)}
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => onEdit(product)}
        >
          <Edit className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onDelete(product.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default ProductCard;
