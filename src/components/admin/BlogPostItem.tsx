
import React from 'react';
import { Edit, Trash2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { BlogPost } from '@/types/blog';

interface BlogPostItemProps {
  post: BlogPost;
  onEdit: (post: BlogPost) => void;
  onDelete: (id: number | string) => void;
}

const BlogPostItem: React.FC<BlogPostItemProps> = ({ post, onEdit, onDelete }) => {
  return (
    <div key={post.id} className="flex flex-col p-4 border rounded-lg">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-medium">{post.title}</h3>
        <div className="flex gap-1">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => onEdit(post)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onDelete(post.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted">
        {post.category} | {post.date}
      </p>
      <p className="text-sm mt-1">{post.excerpt}</p>
    </div>
  );
};

export default BlogPostItem;
