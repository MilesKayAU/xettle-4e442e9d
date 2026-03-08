
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlogPost } from '@/types/blog';
import AiBlogEditor from "@/components/AiBlogEditor";

interface EditBlogPostDialogProps {
  post: BlogPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: any) => void;
}

const EditBlogPostDialog: React.FC<EditBlogPostDialogProps> = ({
  post,
  open,
  onOpenChange,
  onSubmit
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Blog Post</DialogTitle>
          <DialogDescription>
            Update your blog post content and details.
          </DialogDescription>
        </DialogHeader>
        
        <div>
          {post && (
            <AiBlogEditor 
              onSubmit={onSubmit} 
              initialValues={{
                title: post.title,
                excerpt: post.excerpt,
                content: post.content,
                category: post.category,
                imageUrl: post.imageUrl || "",
              }}
              submitText="Update Post"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditBlogPostDialog;
