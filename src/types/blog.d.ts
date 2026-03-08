
export interface BlogPost {
  id: number | string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  date: string;
  imageUrl?: string | null;
}
