import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Star, Check, ArrowLeft, Leaf, Droplet, Shield, ChevronLeft, ChevronRight, Coffee, Sparkles, Heart, Award } from 'lucide-react';
import { useProductImagesSupabase } from '@/hooks/use-product-images-supabase';
import { ProductService, Product } from '@/services/product-service';
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import AustralianSEO from '@/components/SEO/AustralianSEO';
import { generateAustralianProductSchema, generateAustralianKeywords } from '@/utils/australian-seo-utils';

const ProductDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  
  const { getProductImages } = useProductImagesSupabase();
  const [productImages, setProductImages] = useState<{ main: string | null; gallery: (string | null)[] }>({
    main: null,
    gallery: [null, null, null, null]
  });
  
  useEffect(() => {
    const loadProduct = async () => {
      if (!slug) return;
      
      try {
        const foundProduct = await ProductService.getBySlug(slug);
        setProduct(foundProduct);
        
        if (foundProduct) {
          const images = await getProductImages(foundProduct.slug);
          setProductImages(images);
        }
      } catch (error) {
        console.error('Error loading product:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProduct();
  }, [slug, getProductImages]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-xl">Loading Australian natural cleaning product...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Miles Kay Product Not Found</h1>
          <p className="text-gray-600 mb-4">The Australian natural cleaning product you're looking for isn't available.</p>
          <Button onClick={() => navigate('/products')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Browse All Natural Cleaning Products
          </Button>
        </div>
      </div>
    );
  }

  const allImages = [productImages.main, ...productImages.gallery].filter(Boolean);
  
  const nextImage = () => {
    setSelectedImageIndex((prev) => (prev + 1) % allImages.length);
  };
  
  const prevImage = () => {
    setSelectedImageIndex((prev) => (prev - 1 + allImages.length) % allImages.length);
  };

  // Generate enhanced SEO data
  const generateProductSEOData = () => {
    const baseKeywords = `${product.title}, ${product.category}, Miles Kay Australia, natural cleaning products`;
    const australianKeywords = generateAustralianKeywords(baseKeywords);
    
    const longDescription = product.slug === 'coffee-tablets' 
      ? `${product.description} Professional-grade coffee machine cleaning tablets designed in Australia. Our 0% PVA formula ensures your espresso machine stays clean while protecting the environment. Suitable for all major coffee machine brands including Breville, De'Longhi, and commercial espresso machines. Each pack contains 30 tablets for long-lasting cleaning performance.`
      : `${product.description} Australian-designed natural cleaning solution with 0% PVA formula. Part of Miles Kay's eco-friendly product range that delivers professional cleaning results without compromising environmental responsibility. Safe for Australian families and the planet.`;

    return {
      title: `${product.title} | Miles Kay Australia - Natural ${product.category} | 0% PVA`,
      description: longDescription,
      keywords: australianKeywords
    };
  };

  const seoData = generateProductSEOData();

  return (
    <>
      <SEOHead
        title={seoData.title}
        description={seoData.description}
        keywords={seoData.keywords}
        url={`/products/${product.slug}`}
        type="product"
        product={{
          brand: "Miles Kay",
          category: product.category,
          availability: "InStock",
          condition: "NewCondition"
        }}
        image={productImages.main || undefined}
      />
      
      <StructuredData 
        data={generateAustralianProductSchema(product, productImages)}
      />
      
      <AustralianSEO page="products" productData={product} />
      
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        {/* Enhanced Breadcrumb with Schema */}
        <div className="bg-white border-b">
          <div className="container mx-auto px-4 py-4">
            <nav className="flex items-center space-x-2 text-sm text-gray-600" itemScope itemType="https://schema.org/BreadcrumbList">
              <div itemProp="itemListElement" itemScope itemType="https://schema.org/ListItem">
                <Link to="/" className="hover:text-green-600 transition-colors" itemProp="item">
                  <span itemProp="name">Miles Kay Australia</span>
                </Link>
                <meta itemProp="position" content="1" />
              </div>
              <span>/</span>
              <div itemProp="itemListElement" itemScope itemType="https://schema.org/ListItem">
                <Link to="/products" className="hover:text-green-600 transition-colors" itemProp="item">
                  <span itemProp="name">Natural Cleaning Products</span>
                </Link>
                <meta itemProp="position" content="2" />
              </div>
              <span>/</span>
              <div itemProp="itemListElement" itemScope itemType="https://schema.org/ListItem">
                <span className="text-gray-900 font-medium" itemProp="name">{product.title}</span>
                <meta itemProp="position" content="3" />
              </div>
            </nav>
          </div>
        </div>

        <div className="container mx-auto px-4 py-12">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/products')}
            className="mb-8 hover:bg-green-100 hover:text-green-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Natural Cleaning Products
          </Button>

          <div className="grid lg:grid-cols-2 gap-12 mb-16">
            {/* Product Images */}
            <div className="space-y-6">
              <Card className="overflow-hidden border-0 shadow-2xl rounded-3xl">
                <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 relative">
                  {allImages.length > 0 && allImages[selectedImageIndex] ? (
                    <img 
                      src={allImages[selectedImageIndex]} 
                      alt={`${product.title} - Australian natural cleaning product by Miles Kay`}
                      className="w-full h-full object-contain p-8"
                      itemProp="image"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-32 h-32 bg-gradient-to-br from-green-200 to-blue-200 rounded-full flex items-center justify-center">
                        {product.slug === 'coffee-tablets' ? (
                          <Coffee className="w-16 h-16 text-green-600" />
                        ) : (
                          <Droplet className="w-16 h-16 text-green-600" />
                        )}
                      </div>
                    </div>
                  )}
                  
                  {allImages.length > 1 && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white shadow-lg rounded-full"
                        onClick={prevImage}
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white shadow-lg rounded-full"
                        onClick={nextImage}
                      >
                        <ChevronRight className="w-5 h-5" />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
              
              {allImages.length > 1 && (
                <div className="grid grid-cols-4 gap-4">
                  {allImages.map((image, index) => (
                    <Card 
                      key={index}
                      className={`cursor-pointer overflow-hidden transition-all duration-300 ${
                        selectedImageIndex === index 
                          ? 'ring-2 ring-green-500 shadow-lg' 
                          : 'hover:shadow-md'
                      }`}
                      onClick={() => setSelectedImageIndex(index)}
                    >
                      <div className="aspect-square bg-gray-100">
                        <img 
                          src={image} 
                          alt={`${product.title} ${index + 1}`}
                          className="w-full h-full object-contain p-2"
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Enhanced Product Info */}
            <div className="space-y-8" itemScope itemType="https://schema.org/Product">
              <div>
                <div className="flex gap-2 mb-4">
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                    {product.category}
                  </Badge>
                  <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200">
                    Australian Designed
                  </Badge>
                  <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200">
                    0% PVA
                  </Badge>
                </div>
                
                <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4 leading-tight" itemProp="name">
                  Miles Kay {product.title}
                </h1>
                
                <div className="text-sm text-gray-600 mb-4">
                  <span itemProp="brand" itemScope itemType="https://schema.org/Brand">
                    <span itemProp="name">Miles Kay</span> - 
                  </span>
                  <span itemProp="category"> {product.category}</span> | 
                  <span> Made in Australia</span>
                </div>
                
                <div className="text-xl text-gray-600 mb-6 leading-relaxed" itemProp="description">
                  {product.slug === 'coffee-tablets' ? (
                    <>
                      <p className="mb-4">
                        Professional-grade coffee machine cleaning tablets designed in Australia for superior cleaning performance. 
                        Our revolutionary 0% PVA formula ensures your espresso machine operates at peak performance while protecting the environment.
                      </p>
                      <p>
                        Compatible with all major coffee machine brands including Breville, De'Longhi, Sunbeam, and commercial espresso machines. 
                        Each pack contains 30 premium cleaning tablets for long-lasting value.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mb-4">{product.description}</p>
                      <p>
                        Part of Miles Kay's Australian-designed natural cleaning range, formulated with 0% PVA for maximum environmental responsibility 
                        without compromising on cleaning power.
                      </p>
                    </>
                  )}
                </div>
                
                {product.slug === 'coffee-tablets' && (
                  <div className="flex items-center mb-6" itemProp="aggregateRating" itemScope itemType="https://schema.org/AggregateRating">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <span className="text-gray-600 ml-3">
                      <span itemProp="ratingValue">5.0</span> 
                      (<span itemProp="reviewCount">126</span> Australian customer reviews)
                    </span>
                  </div>
                )}
              </div>

              {/* Enhanced Key Features */}
              <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg rounded-2xl">
                <CardContent className="p-8">
                  <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
                    <Shield className="w-6 h-6 text-green-600 mr-2" />
                    Australian Natural Cleaning Benefits
                  </h3>
                  <div className="space-y-4">
                    {product.slug === 'coffee-tablets' ? (
                      <>
                        <div className="flex items-start">
                          <Coffee className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">Removes coffee oils, mineral buildup & bitter residue completely from all espresso machines</span>
                        </div>
                        <div className="flex items-start">
                          <Check className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">Compatible with Breville, De'Longhi, Sunbeam & all major Australian coffee machine brands</span>
                        </div>
                        <div className="flex items-start">
                          <Award className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">Professional barista-quality results for home and commercial use</span>
                        </div>
                        <div className="flex items-start">
                          <Sparkles className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">30 premium cleaning tablets per pack - exceptional value for Australian families</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start">
                          <Check className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">Australian-designed formula for superior cleaning performance</span>
                        </div>
                        <div className="flex items-start">
                          <Award className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">Professional-grade results for Australian households</span>
                        </div>
                      </>
                    )}
                    
                    <div className="flex items-start">
                      <Leaf className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-700">100% PVA-free, biodegradable & environmentally responsible Australian formula</span>
                    </div>
                    <div className="flex items-start">
                      <Heart className="h-5 w-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-700">Safe for Australian families, pets & waterways</span>
                    </div>
                    <div className="flex items-start">
                      <Droplet className="h-5 w-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-700">Powerful natural cleaning without harsh chemicals</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Button 
                  size="lg" 
                  className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-lg py-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300"
                  onClick={() => navigate('/distributors')}
                >
                  Contact Our Distributors
                </Button>
                
                <p className="text-sm text-gray-600 text-center">
                  Available through our authorized distributor network
                </p>
              </div>
            </div>
          </div>

          {/* Enhanced Detailed Information */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg rounded-3xl">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">How Miles Kay Products Work</h3>
                {product.slug === 'coffee-tablets' ? (
                  <div className="space-y-4 text-gray-700 leading-relaxed">
                    <p>
                      Our Australian-designed professional coffee machine cleaning tablets use advanced natural cleaning technology 
                      to dissolve coffee oils, mineral deposits, and bitter residue that can affect your espresso's taste.
                    </p>
                    <p>
                      Simply dissolve one tablet in water according to your machine's cleaning cycle. The powerful yet eco-friendly 
                      formula works with all Australian coffee machine brands including Breville Barista Express, De'Longhi Magnifica, 
                      and Sunbeam Café Series.
                    </p>
                    <p>
                      Regular use ensures every cup tastes as the roaster intended, extending your machine's lifespan while 
                      protecting Australian waterways with our 0% PVA formula.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 text-gray-700 leading-relaxed">
                    <p>
                      Our Australian-designed {product.title.toLowerCase()} deliver professional-strength cleaning power 
                      using natural ingredients that are safe for your family and the environment.
                    </p>
                    <p>
                      The 0% PVA formula ensures powerful cleaning action while maintaining our commitment to environmental 
                      responsibility - perfect for Australian families who care about their impact.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg rounded-3xl">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Why Choose Miles Kay Australia</h3>
                <div className="space-y-4 text-gray-700 leading-relaxed">
                  <p>
                    Miles Kay is proudly Australian-designed, creating natural cleaning solutions that don't compromise 
                    between effectiveness and environmental responsibility.
                  </p>
                  <p>
                    Our revolutionary 0% PVA formula means you get powerful cleaning results while supporting 
                    a sustainable future for Australia and the planet.
                  </p>
                  <p>
                    Trusted by Australian families nationwide, our products deliver professional-grade results 
                    you can feel good about using in your home.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg rounded-3xl">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Australian Quality Standards</h3>
                <div className="space-y-4 text-gray-700 leading-relaxed">
                  <p>
                    Every Miles Kay product is formulated to meet Australian quality standards and environmental guidelines, 
                    ensuring safety for your family and our unique ecosystem.
                  </p>
                  <p>
                    Our natural ingredients are carefully selected for their cleaning efficacy and biodegradability, 
                    making them safe for Australian waterways and marine life.
                  </p>
                  <p>
                    Available through our trusted distributor network across Australia, from Sydney to Perth, 
                    Melbourne to Brisbane, and everywhere in between.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Australian Customer Reviews Section */}
          {product.slug === 'coffee-tablets' && (
            <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg rounded-3xl mb-16">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">What Australian Coffee Lovers Say</h3>
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="bg-green-50 p-6 rounded-2xl">
                    <div className="flex mb-4">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <p className="text-gray-700 mb-4">
                      "Finally found an Australian cleaning product that actually works! My Breville Barista Express has never 
                      performed better. Love that it's eco-friendly too."
                    </p>
                    <p className="text-sm text-gray-600">- Sarah M., Melbourne</p>
                  </div>
                  <div className="bg-blue-50 p-6 rounded-2xl">
                    <div className="flex mb-4">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <p className="text-gray-700 mb-4">
                      "Great to support an Australian brand that cares about the environment. These tablets clean my 
                      De'Longhi perfectly and taste difference is amazing!"
                    </p>
                    <p className="text-sm text-gray-600">- Mark T., Sydney</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* SEO-Enhanced FAQ Section */}
          <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg rounded-3xl mb-16">
            <CardContent className="p-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">
                Frequently Asked Questions About {product.title}
              </h3>
              <div className="space-y-6">
                {product.slug === 'coffee-tablets' ? (
                  <>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Will these coffee cleaning tablets work with my Australian coffee machine?
                      </h4>
                      <p className="text-gray-700">
                        Yes! Our tablets are compatible with all major Australian coffee machine brands including Breville, 
                        De'Longhi, Sunbeam, and Kmart coffee machines. They work with both automatic and manual cleaning cycles.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        How often should I clean my coffee machine with Miles Kay tablets?
                      </h4>
                      <p className="text-gray-700">
                        For home use, we recommend cleaning every 2-4 weeks depending on usage. Commercial or high-use machines 
                        should be cleaned weekly. Regular cleaning ensures optimal taste and extends machine life.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Are Miles Kay cleaning tablets safe for Australian waterways?
                      </h4>
                      <p className="text-gray-700">
                        Absolutely! Our 0% PVA formula is completely biodegradable and safe for Australian waterways, 
                        marine life, and septic systems. We're committed to protecting Australia's unique environment.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Is this {product.title.toLowerCase()} safe for Australian families?
                      </h4>
                      <p className="text-gray-700">
                        Yes! All Miles Kay products are formulated with natural ingredients and are safe for Australian families, 
                        pets, and the environment. Our 0% PVA formula ensures no harmful chemicals enter your home or waterways.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Where can I buy Miles Kay products in Australia?
                      </h4>
                      <p className="text-gray-700">
                        Miles Kay products are available through our authorized distributor network across Australia. 
                        Visit our "Where to Buy" page to find stockists near you or purchase online.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default ProductDetail;
