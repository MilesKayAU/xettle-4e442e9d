import { typedSupabase } from "@/integrations/supabase/client-extended";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { BlogPost } from "@/types/blog";

// Fetch all blog posts from Supabase
export const fetchBlogPosts = async (): Promise<BlogPost[]> => {
  try {
    const { data, error } = await typedSupabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error fetching blog posts:', error);
      throw error;
    }

    if (data) {
      // Format the posts to match our BlogPost type
      return data.map(post => ({
        id: post.id,
        title: post.title,
        excerpt: post.excerpt || '',
        content: post.content,
        category: 'General',
        date: format(new Date(post.created_at), 'MMMM d, yyyy'),
        imageUrl: post.featured_image
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    // Don't show toast error on initial load to avoid UI pollution
    // Just log the error and return empty array
    return [];
  }
};

// Create a new blog post
export const createBlogPost = async (values: any): Promise<BlogPost | null> => {
  try {
    const { data, error } = await typedSupabase
      .from('blog_posts')
      .insert({
        title: values.title,
        excerpt: values.excerpt,
        content: values.content,
        slug: values.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        author_id: 'anonymous', // This should be a valid user ID in a real app
        featured_image: values.imageUrl || null,
        published: true
      })
      .select();
    
    if (error) throw error;
    
    if (data && data[0]) {
      return {
        id: data[0].id,
        title: data[0].title,
        excerpt: data[0].excerpt || '',
        content: data[0].content,
        category: 'General',
        date: format(new Date(data[0].created_at), 'MMMM d, yyyy'),
        imageUrl: data[0].featured_image
      };
    }
    
    return null;
  } catch (error) {
    console.error("Error creating blog post:", error);
    toast({
      title: "Error creating blog post",
      description: "There was a problem creating your blog post.",
      variant: "destructive"
    });
    
    throw error;
  }
};

// Update a blog post
export const updateBlogPost = async (id: string | number, values: any): Promise<void> => {
  try {
    // Convert the ID to string if it's a number
    const postId = String(id);
    
    const { error } = await typedSupabase
      .from('blog_posts')
      .update({
        title: values.title,
        excerpt: values.excerpt,
        content: values.content,
        featured_image: values.imageUrl || null
      })
      .eq('id', postId);
    
    if (error) throw error;
  } catch (error) {
    console.error("Error updating blog post:", error);
    toast({
      title: "Error updating blog post",
      description: "There was a problem updating your blog post.",
      variant: "destructive"
    });
    
    throw error;
  }
};

// Delete a blog post
export const deleteBlogPost = async (id: string | number): Promise<void> => {
  try {
    // Convert the ID to string if it's a number
    const postId = String(id);
    
    const { error } = await typedSupabase
      .from('blog_posts')
      .delete()
      .eq('id', postId);
    
    if (error) throw error;
  } catch (error) {
    console.error("Error deleting blog post:", error);
    toast({
      title: "Error deleting blog post",
      description: "There was a problem deleting your blog post.",
      variant: "destructive"
    });
    
    throw error;
  }
};

// Save blog posts to local storage for quick access
export const updateLocalBlogPageData = (posts: BlogPost[]): void => {
  try {
    const blogPageData = posts.map(post => ({
      id: post.id,
      title: post.title,
      excerpt: post.excerpt,
      date: post.date,
      category: post.category,
      imageUrl: post.imageUrl
    }));
    
    localStorage.setItem('blogPagePosts', JSON.stringify(blogPageData));
  } catch (error) {
    console.error("Failed to update blog page data:", error);
  }
};
