
import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, ArrowRight, Leaf, Droplet } from 'lucide-react';
import { useProductImagesSupabase } from '@/hooks/use-product-images-supabase';
import { useProducts } from '@/hooks/use-products';
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import { generateOrganizationStructuredData } from '@/utils/seo-utils';

const Products = () => {
  const navigate = useNavigate();
  const { products, isLoading } = useProducts();
  const { getProductImages } = useProductImagesSupabase();
  const [productImages, setProductImages] = useState<{ [slug: string]: { main: string | null } }>({});

  useEffect(() => {
    const loadImages = async () => {
      const imagePromises = products.map(async (product) => {
        if (product.slug) {
          const images = await getProductImages(product.slug);
          return { slug: product.slug, main: images.main };
        }
        return null;
      });

      const results = await Promise.all(imagePromises);
      const imageMap: { [slug: string]: { main: string | null } } = {};
      
      results.forEach((result) => {
        if (result) {
          imageMap[result.slug] = { main: result.main };
        }
      });

      setProductImages(imageMap);
    };

    if (products.length > 0) {
      loadImages();
    }
  }, [products, getProductImages]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center">
        <p className="text-lg">Loading products...</p>
      </div>
    );
  }
  
  return (
    <>
      <SEOHead
        title="Professional Cleaning Products | Miles Kay - 0% PVA Solutions"
        description="Browse Miles Kay's complete range of eco-friendly cleaning products. Professional dishwashing sheets, laundry solutions, and coffee machine cleaners. All 0% PVA and environmentally responsible."
        keywords="cleaning products catalog, PVA-free cleaning, dishwashing sheets, laundry sheets, coffee machine cleaning tablets, eco-friendly products, professional cleaning solutions"
        url="/products"
        type="website"
      />
      
      <StructuredData data={generateOrganizationStructuredData()} />
      
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        {/* Simplified Hero Section */}
        <section className="relative py-12 bg-gradient-to-r from-green-600 to-blue-600 text-white">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-sm mb-4">
                <Leaf className="w-3 h-3" />
                Eco-Friendly Solutions
              </div>
              <h1 className="text-3xl md:text-4xl font-bold mb-3">
                Professional Cleaning Solutions
              </h1>
              <p className="text-lg mb-4 text-white/90">
                Revolutionary 0% PVA cleaning products for a cleaner future
              </p>
            </div>
          </div>
        </section>

        {/* Products Grid */}
        <section className="py-12">
          <div className="container mx-auto px-4">
            <div className="text-center mb-8">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                Our Product Range
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {products.map((product) => (
                <Card key={product.id} className="group overflow-hidden border-0 shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-2xl bg-white h-full flex flex-col">
                  <CardHeader className="p-0">
                    <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
                      {productImages[product.slug || '']?.main ? (
                        <img 
                          src={productImages[product.slug || ''].main || ''} 
                          alt={product.title} 
                          className="w-full h-full object-contain p-4"
                          loading="lazy"
                          width="300"
                          height="225"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-12 h-12 bg-green-200 rounded-full flex items-center justify-center">
                            <Leaf className="w-6 h-6 text-green-600" />
                          </div>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  
                  <CardContent className="p-4 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                      <Badge className="bg-green-100 text-green-800 text-xs">
                        {product.category}
                      </Badge>
                      {product.slug === 'coffee-tablets' && (
                        <Badge className="bg-blue-100 text-blue-800 text-xs">Featured</Badge>
                      )}
                    </div>
                    
                    <CardTitle className="text-lg mb-2 group-hover:text-green-600 transition-colors">
                      {product.title}
                    </CardTitle>
                    
                    {product.slug === 'coffee-tablets' && (
                      <div className="flex items-center mb-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star key={star} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          ))}
                        </div>
                        <span className="text-xs text-gray-600 ml-2">5.0 (126 reviews)</span>
                      </div>
                    )}
                    
                    <p className="text-gray-600 mb-3 text-sm flex-1">{product.description}</p>
                    
                    <div className="flex items-center gap-3 text-xs text-gray-600 mb-3">
                      <div className="flex items-center">
                        <Leaf className="w-3 h-3 text-green-600 mr-1" />
                        PVA-Free
                      </div>
                      <div className="flex items-center">
                        <Droplet className="w-3 h-3 text-blue-600 mr-1" />
                        Powerful
                      </div>
                    </div>
                    
                    <Button 
                      asChild
                      className="w-full bg-green-600 hover:bg-green-700 rounded-full py-2 text-sm mt-auto"
                    >
                      <Link to={`/products/${product.slug}`} className="flex items-center justify-center gap-2">
                        View Details
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Simplified CTA */}
        <section className="py-12 bg-gradient-to-r from-green-600 to-blue-600 text-white">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Ready to Make the Switch?
            </h2>
            <p className="text-lg mb-4 text-white/90 max-w-xl mx-auto">
              Join thousands who have switched to eco-friendly cleaning
            </p>
            <Button 
              size="lg" 
              variant="secondary"
              className="px-6 py-3 rounded-full"
              onClick={() => navigate('/distributors')}
            >
              Find a Distributor
            </Button>
          </div>
        </section>
      </div>
    </>
  );
};

export default Products;
