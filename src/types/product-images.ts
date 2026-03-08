
// Types for product images functionality
export type ProductImage = {
  main: string | null;
  gallery: (string | null)[];
};

export type ProductImagesMap = {
  [productId: string]: ProductImage;
};
