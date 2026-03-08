
import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ProductForm from './ProductForm';
import { ProductFormValues } from './product-schema';

interface AddProductCardProps {
  onAddProduct: (values: ProductFormValues) => void;
}

const AddProductCard: React.FC<AddProductCardProps> = ({ onAddProduct }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add New Product</CardTitle>
        <CardDescription>Create a new product listing</CardDescription>
      </CardHeader>
      <CardContent>
        <ProductForm onSubmit={onAddProduct} />
      </CardContent>
    </Card>
  );
};

export default AddProductCard;
