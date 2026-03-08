import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Tag } from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { typedSupabase } from "@/integrations/supabase/client-extended";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { BlogPost as BlogPostType } from "@/types/blog";
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import { generateArticleStructuredData, generateOrganizationStructuredData } from '@/utils/seo-utils';

const BlogPost = () => {
  const { id } = useParams();
  const [post, setPost] = useState<BlogPostType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPost = async () => {
      setLoading(true);
      try {
        // Use the typed client
        const { data, error } = await typedSupabase
          .from('blog_posts')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          // If there's an error with Supabase, try localStorage
          throw error;
        }

        if (data) {
          setPost({
            id: data.id,
            title: data.title,
            content: data.content,
            excerpt: data.excerpt || "No excerpt available",
            category: "General", // Default category since it's not in schema
            date: format(new Date(data.created_at), 'MMMM d, yyyy'),
            imageUrl: data.featured_image
          });
        } else {
          // If no data in Supabase, fall back to localStorage
          throw new Error("Post not found in database");
        }
      } catch (error) {
        console.error('Error fetching blog post from Supabase:', error);
        
        // Fallback to localStorage
        try {
          const storedPosts = localStorage.getItem('blogPosts');
          if (storedPosts) {
            const posts = JSON.parse(storedPosts);
            const foundPost = posts.find((p: BlogPostType) => p.id.toString() === id);
            if (foundPost) {
              setPost(foundPost);
            }
          }
        } catch (localError) {
          console.error('Error fetching from localStorage:', localError);
          toast({
            title: "Error loading blog post",
            description: "Could not find the requested blog post.",
            variant: "destructive"
          });
        }
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchPost();
    }
  }, [id]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Blog Post Not Found</h1>
        <p className="mb-8">We couldn't find the blog post you were looking for.</p>
        <Button asChild>
          <Link to="/blog">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Blog
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title={`${post.title} | Miles Kay Blog`}
        description={post.excerpt}
        keywords={`Miles Kay blog, ${post.category}, cleaning tips, eco-friendly cleaning, sustainable living`}
        url={`/blog/${post.id}`}
        type="article"
        image={post.imageUrl}
        article={{
          publishedTime: post.date,
          modifiedTime: post.date,
          author: "Miles Kay",
          section: post.category,
          tags: [post.category, "cleaning", "sustainability"]
        }}
      />
      
      <StructuredData 
        data={[
          generateArticleStructuredData(post),
          generateOrganizationStructuredData()
        ]} 
      />
      
      <div className="container mx-auto px-4 py-16">
        <Link to="/blog" className="inline-flex items-center text-primary mb-6 hover:underline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Blog
        </Link>
        
        <article className="prose prose-zinc lg:prose-xl max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
          
          <div className="flex flex-wrap gap-4 items-center text-sm text-muted-foreground mb-8">
            <div className="flex items-center">
              <Calendar className="h-4 w-4 mr-1" />
              <span>{post.date}</span>
            </div>
            <div className="flex items-center">
              <Tag className="h-4 w-4 mr-1" />
              <span>{post.category}</span>
            </div>
          </div>
          
          {post.imageUrl && (
            <div className="mb-8">
              <img 
                src={post.imageUrl} 
                alt={post.title} 
                className="w-full h-auto max-h-[500px] object-cover rounded-lg" 
              />
            </div>
          )}
          
          <div className="whitespace-pre-wrap">
            {post.content.split('\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </article>
      </div>
    </>
  );
};

export default BlogPost;
