
import React from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Save } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { productSchema } from './product-schema';

interface ProductFormProps {
  onSubmit: (values: z.infer<typeof productSchema>) => void;
  defaultValues?: z.infer<typeof productSchema>;
  submitButtonText?: string;
  submitButtonIcon?: React.ReactNode;
}

const ProductForm: React.FC<ProductFormProps> = ({ 
  onSubmit, 
  defaultValues = {
    title: "",
    description: "",
    category: "",
  },
  submitButtonText = "Add Product",
  submitButtonIcon = <Plus className="mr-2 h-4 w-4" />
}) => {
  const form = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues
  });

  const handleSubmit = (values: z.infer<typeof productSchema>) => {
    onSubmit(values);
    if (!defaultValues.title) {
      form.reset();
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Product Title</FormLabel>
              <FormControl>
                <Input placeholder="Enter product title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <FormControl>
                <Input placeholder="Product category" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="Product description" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit" className="w-full">
          {submitButtonIcon}
          {submitButtonText}
        </Button>
      </form>
    </Form>
  );
};

export default ProductForm;
