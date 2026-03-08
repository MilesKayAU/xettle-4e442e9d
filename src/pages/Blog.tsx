import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, User, ArrowRight } from 'lucide-react';
import { BlogPost } from "@/types/blog";
import { useBlogPosts } from "@/hooks/use-blog-posts";
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import { generateOrganizationStructuredData } from '@/utils/seo-utils';

const Blog = () => {
  const { blogPosts, isLoading } = useBlogPosts();

  // No state needed as blogPosts are fetched from the hook
  
  if (isLoading) {
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

  return (
    <>
      <SEOHead
        title="Miles Kay Blog - Cleaning Tips & Sustainability Insights"
        description="Discover expert cleaning tips, sustainability insights, and product guides from Miles Kay. Learn about eco-friendly cleaning solutions and sustainable living practices."
        keywords="Miles Kay blog, cleaning tips, sustainability, eco-friendly cleaning, green living, cleaning guides, sustainable products"
        url="/blog"
        type="website"
      />
      
      <StructuredData data={generateOrganizationStructuredData()} />
      
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        {/* Hero Section */}
        <section className="relative py-24 bg-gradient-to-r from-green-600 to-blue-600 text-white overflow-hidden">
          <div className="absolute inset-0 bg-black/10"></div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
                Explore Our Blog
              </h1>
              <p className="text-xl md:text-2xl mb-8 text-white/90 leading-relaxed">
                Insights, tips, and news from the world of eco-friendly cleaning
              </p>
            </div>
          </div>
        </section>

        {/* Blog Posts Grid */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            {blogPosts.length === 0 ? (
              <div className="text-center py-16 max-w-xl mx-auto">
                <div className="text-6xl mb-4">📝</div>
                <h2 className="text-2xl font-semibold text-gray-800 mb-4">No blog posts yet</h2>
                <p className="text-gray-600 mb-6">
                  We're working on creating amazing content for you. Check back soon for cleaning tips, sustainability insights, and product guides!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
                {blogPosts.map((post) => (
                  <Card key={post.id} className="group overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-500 rounded-3xl bg-white">
                    <CardHeader className="p-6">
                      <CardTitle className="text-2xl mb-2 group-hover:text-green-600 transition-colors duration-300">
                        {post.title}
                      </CardTitle>
                      <CardDescription className="text-gray-600">
                        {post.excerpt}
                      </CardDescription>
                    </CardHeader>
                    
                    <CardContent className="p-6">
                      <div className="flex justify-between items-center mb-4">
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                          {post.category}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 text-green-600 mr-1" />
                          {post.date}
                        </div>
                        <div className="flex items-center">
                          <User className="w-4 h-4 text-blue-600 mr-1" />
                          Miles Kay
                        </div>
                      </div>
                      
                      <Button 
                        asChild
                        className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 rounded-full py-4 text-lg shadow-lg hover:shadow-xl transition-all duration-300"
                      >
                        <Link to={`/blog/${post.id}`} className="flex items-center justify-center gap-2">
                          Read More
                          <ArrowRight className="w-5 h-5" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};

export default Blog;
