
/**
 * Utilities for image processing and transformation
 */

/**
 * Convert a file to base64 string for storage
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

/**
 * Get a default product image structure
 */
export const getDefaultProductImage = () => ({
  main: null,
  gallery: [null, null, null, null]
});
