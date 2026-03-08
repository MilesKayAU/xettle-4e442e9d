
import React from 'react';
import { Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Product } from "@/services/product-service";
import ProductForm from './ProductForm';
import { ProductFormValues } from './product-schema';

interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSave: (values: ProductFormValues) => void;
}

const EditProductDialog: React.FC<EditProductDialogProps> = ({
  open,
  onOpenChange,
  product,
  onSave
}) => {
  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
          <DialogDescription>
            Make changes to the product details.
          </DialogDescription>
        </DialogHeader>
        
        <ProductForm
          onSubmit={onSave}
          defaultValues={{
            title: product.title,
            description: product.description,
            category: product.category
          }}
          submitButtonText="Save Changes"
          submitButtonIcon={<Save className="mr-2 h-4 w-4" />}
        />
      </DialogContent>
    </Dialog>
  );
};

export default EditProductDialog;
