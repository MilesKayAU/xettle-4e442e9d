
import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Star, ArrowRight, Leaf, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProductImagesSupabase } from '@/hooks/use-product-images-supabase';
import { useProducts } from '@/hooks/use-products';
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import { generateOrganizationStructuredData } from '@/utils/seo-utils';
import { generateAustralianKeywords } from '@/utils/australian-seo-utils';

const Index = () => {
  const navigate = useNavigate();
  const { getProductImages } = useProductImagesSupabase();
  const { products } = useProducts();
  const [productImages, setProductImages] = useState<{ [key: string]: string | null }>({});

  // Load only first 2 products for performance
  useEffect(() => {
    const loadProductImages = async () => {
      if (products.length === 0) return;
      
      const images: { [key: string]: string | null } = {};
      const productsToShow = products.slice(0, 2); // Reduced from 3 to 2
      
      for (const product of productsToShow) {
        const productImageData = await getProductImages(product.slug);
        images[product.slug] = productImageData.main;
      }
      
      setProductImages(images);
    };

    loadProductImages();
  }, [getProductImages, products]);

  const featuredProducts = products.slice(0, 2); // Reduced from 3 to 2
  const baseKeywords = "Miles Kay, natural cleaning products, eco-friendly cleaning, coffee machine cleaner, retainer cleaner, laundry sheets, dishwashing sheets, 0% PVA, sustainable cleaning";
  const australianKeywords = generateAustralianKeywords(baseKeywords);

  return (
    <>
      <SEOHead
        title="Miles Kay Australia - Natural Cleaning Products | Coffee Machine & Retainer Cleaners"
        description="Miles Kay - Premium natural cleaning products designed in Australia. Specialising in coffee machine cleaners, retainer cleaners, laundry sheets & eco-friendly solutions. 0% PVA, 100% Australian designed. Shop nationwide with fast delivery."
        keywords={australianKeywords}
        url="/"
        type="website"
      />
      
      <StructuredData data={generateOrganizationStructuredData()} />
      
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        {/* Simplified Hero Section */}
        <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 bg-gradient-to-r from-green-600 to-blue-600 text-white">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-sm mb-4">
                <Leaf className="w-3 h-3" />
                Australian Designed • 0% PVA
              </div>
              <h1 className="text-3xl md:text-5xl font-bold mb-4">
                Australia's Premium
                <span className="block text-yellow-300">Natural Cleaning</span>
              </h1>
              <p className="text-lg mb-6 text-white/90 max-w-2xl mx-auto">
                Australian-designed natural cleaning solutions for coffee machines, retainers, laundry and home.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button 
                  size="lg" 
                  className="bg-white text-green-600 hover:bg-gray-100 px-6 py-3 rounded-full"
                  onClick={() => navigate('/products')}
                >
                  Shop Products
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline"
                  className="border-white text-white hover:bg-white hover:text-green-600 px-6 py-3 rounded-full"
                  onClick={() => navigate('/where-to-buy')}
                >
                  Buy in Australia
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Simplified Features Section */}
        <section className="py-12">
          <div className="container mx-auto px-4">
            <div className="text-center mb-8">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                Why Australian Families Choose Miles Kay
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
              <div className="text-center bg-white rounded-xl p-4 shadow-md">
                <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 mx-auto flex items-center justify-center mb-3">
                  <Leaf className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Australian Designed, 0% PVA</h3>
                <p className="text-gray-600 text-sm">Formulated in Australia with zero PVA content for safe and effective cleaning.</p>
              </div>
              
              <div className="text-center bg-white rounded-xl p-4 shadow-md">
                <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-3">
                  <Star className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Professional Results</h3>
                <p className="text-gray-600 text-sm">Meeting the highest Australian standards for cleaning performance.</p>
              </div>
              
              <div className="text-center bg-white rounded-xl p-4 shadow-md">
                <div className="w-12 h-12 rounded-full bg-yellow-100 text-yellow-600 mx-auto flex items-center justify-center mb-3">
                  <Globe className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Australia-Wide Delivery</h3>
                <p className="text-gray-600 text-sm">Available across all Australian states through trusted retailers.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Simplified Products Preview - Only 2 products */}
        <section className="py-12 bg-gray-50">
          <div className="container mx-auto px-4">
            <div className="text-center mb-8">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                Our Natural Cleaning Range
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {featuredProducts.length > 0 ? (
                featuredProducts.map((product) => (
                  <Card key={product.id} className="bg-white shadow-md rounded-xl h-full flex flex-col">
                    <CardHeader className="p-0">
                      <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden rounded-t-xl">
                        {productImages[product.slug] ? (
                          <img 
                            src={productImages[product.slug] || ''} 
                            alt={`${product.title} - Australian natural cleaning product`}
                            className="w-full h-full object-contain p-4"
                            loading="lazy"
                            width="400"
                            height="300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-12 h-12 bg-green-200 rounded-full flex items-center justify-center">
                              <Leaf className="w-6 h-6 text-green-600" />
                            </div>
                          </div>
                        )}
                        <div className="absolute top-3 right-3">
                          <Badge className="bg-green-600 text-white text-xs">Australian</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="p-4 flex-1 flex flex-col">
                      <Badge className="bg-green-100 text-green-800 mb-2 w-fit text-xs">
                        {product.category}
                      </Badge>
                      
                      <h3 className="text-lg mb-2 font-semibold text-gray-900">
                        Miles Kay {product.title}
                      </h3>
                      
                      <p className="text-gray-600 mb-4 text-sm flex-1">
                        {product.description} - Natural Australian solution.
                      </p>
                      
                      <Button 
                        className="w-full bg-green-600 hover:bg-green-700 rounded-full py-2 text-sm mt-auto"
                        onClick={() => navigate(`/products/${product.slug}`)}
                      >
                        Learn More
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="col-span-full text-center py-8">
                  <p className="text-gray-600 text-sm">Loading products...</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Simplified CTA Section */}
        <section className="py-12 bg-gradient-to-r from-green-600 to-blue-600 text-white">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Join 10,000+ Australian Families
            </h2>
            <p className="text-lg mb-6 text-white/90 max-w-xl mx-auto">
              Switch to Miles Kay's Australian-designed natural cleaning solutions.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button 
                size="lg" 
                className="bg-white text-green-600 hover:bg-gray-100 px-6 py-3 rounded-full"
                onClick={() => navigate('/where-to-buy')}
              >
                Shop in Australia
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button 
                size="lg" 
                variant="secondary"
                className="px-6 py-3 rounded-full"
                onClick={() => navigate('/distributors')}
              >
                Become a Distributor
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default Index;
