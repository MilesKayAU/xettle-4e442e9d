import { useState, useEffect } from 'react';
import { fetchBlogPosts, createBlogPost, updateBlogPost, deleteBlogPost, updateLocalBlogPageData } from '@/utils/blogApi';
import { BlogPost } from '@/types/blog';
import { toast } from "@/hooks/use-toast";

export const useBlogPosts = () => {
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Fetch blog posts on mount
  useEffect(() => {
    loadBlogPosts();
  }, []);
  
  const loadBlogPosts = async () => {
    setIsLoading(true);
    try {
      const posts = await fetchBlogPosts();
      setBlogPosts(posts);
      updateLocalBlogPageData(posts);
    } catch (error) {
      console.error('Failed to load blog posts:', error);
      // Fallback to localStorage if Supabase fetch fails
      const storedPosts = localStorage.getItem('blogPosts');
      if (storedPosts) {
        try {
          const parsedPosts = JSON.parse(storedPosts);
          setBlogPosts(parsedPosts);
        } catch (parseError) {
          console.error('Failed to parse stored blog posts:', parseError);
          setBlogPosts([]);
        }
      } else {
        setBlogPosts([]);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleCreateBlogPost = async (values: any) => {
    setIsLoading(true);
    try {
      const newPost = await createBlogPost(values);
      
      if (newPost) {
        const updatedPosts = [newPost, ...blogPosts];
        setBlogPosts(updatedPosts);
        updateLocalBlogPageData(updatedPosts);
        
        toast({
          title: "Blog post created",
          description: "Your post has been successfully created.",
        });
      }
    } catch (error) {
      console.error('Failed to create blog post:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleUpdateBlogPost = async (post: BlogPost, values: any) => {
    setIsLoading(true);
    try {
      await updateBlogPost(post.id, values);
      
      const updatedPost = {
        ...post,
        title: values.title,
        excerpt: values.excerpt,
        content: values.content,
        category: values.category,
        imageUrl: values.imageUrl || post.imageUrl
      };
      
      const updatedPosts = blogPosts.map(p => 
        p.id === post.id ? updatedPost : p
      );
      
      setBlogPosts(updatedPosts);
      updateLocalBlogPageData(updatedPosts);
      
      toast({
        title: "Blog post updated",
        description: "The blog post has been successfully updated"
      });
      
      return true; // Return success status
    } catch (error) {
      // Error is already handled in the API function
      return false;
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDeleteBlogPost = async (id: number | string) => {
    setIsLoading(true);
    try {
      await deleteBlogPost(id);
      
      const updatedPosts = blogPosts.filter(post => post.id !== id);
      setBlogPosts(updatedPosts);
      updateLocalBlogPageData(updatedPosts);
      
      toast({
        title: "Blog post deleted",
        description: "The post has been successfully removed.",
        variant: "default",
      });
    } catch (error) {
      // Error is already handled in the API function
    } finally {
      setIsLoading(false);
    }
  };
  
  return {
    blogPosts,
    setBlogPosts,
    isLoading,
    handleCreateBlogPost,
    handleUpdateBlogPost,
    handleDeleteBlogPost
  };
};
