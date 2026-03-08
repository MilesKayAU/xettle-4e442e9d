
export type Product = {
  id: number;
  title: string;
  description: string;
  category: string;
  slug?: string;
  mainImage?: string | null;
  galleryImages?: (string | null)[];
};

export type BlogPost = {
  id: number | string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  date: string;
  imageUrl: string | null;
};

export type Distributor = {
  id: number;
  fullName: string;
  companyName: string;
  email: string;
  phone: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
};
