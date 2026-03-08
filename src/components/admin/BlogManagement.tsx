
import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AiBlogEditor from "@/components/AiBlogEditor";
import { useBlogPosts } from "@/hooks/use-blog-posts";
import BlogPostItem from "@/components/admin/BlogPostItem";
import EditBlogPostDialog from "@/components/admin/EditBlogPostDialog";
import { BlogPost } from '@/types/blog';

interface BlogManagementProps {
  blogPosts: BlogPost[];
  setBlogPosts: React.Dispatch<React.SetStateAction<BlogPost[]>>;
}

const BlogManagement: React.FC<BlogManagementProps> = ({ blogPosts, setBlogPosts }) => {
  const [editingBlogPost, setEditingBlogPost] = useState<BlogPost | null>(null);
  const [showEditBlogDialog, setShowEditBlogDialog] = useState(false);
  
  const {
    isLoading,
    handleCreateBlogPost,
    handleUpdateBlogPost,
    handleDeleteBlogPost
  } = useBlogPosts();

  const handleOpenEditBlogPost = (post: BlogPost) => {
    setEditingBlogPost(post);
    setShowEditBlogDialog(true);
  };
  
  const handleEditBlogPostSubmit = async (values: any) => {
    if (!editingBlogPost) return;
    
    const success = await handleUpdateBlogPost(editingBlogPost, values);
    if (success) {
      setShowEditBlogDialog(false);
      setEditingBlogPost(null);
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle>Create Blog Post</CardTitle>
            <CardDescription>Write a new blog article</CardDescription>
          </CardHeader>
          <CardContent>
            <AiBlogEditor onSubmit={handleCreateBlogPost} />
          </CardContent>
        </Card>
      </div>
      
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle>Manage Posts</CardTitle>
            <CardDescription>View and edit your published blog posts</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="flex flex-col p-4 border rounded-lg animate-pulse">
                    <div className="w-3/4 h-5 bg-gray-200 rounded mb-2"></div>
                    <div className="w-1/4 h-4 bg-gray-200 rounded mb-2"></div>
                    <div className="w-full h-4 bg-gray-200 rounded"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {blogPosts.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    No blog posts yet. Create your first post!
                  </p>
                ) : (
                  blogPosts.map((post) => (
                    <BlogPostItem
                      key={post.id}
                      post={post}
                      onEdit={handleOpenEditBlogPost}
                      onDelete={handleDeleteBlogPost}
                    />
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <EditBlogPostDialog
        post={editingBlogPost}
        open={showEditBlogDialog}
        onOpenChange={setShowEditBlogDialog}
        onSubmit={handleEditBlogPostSubmit}
      />
    </div>
  );
};

export default BlogManagement;
