
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ExternalLink, Star, Globe } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import AustralianSEO from '@/components/SEO/AustralianSEO';
import { generateOrganizationStructuredData } from '@/utils/seo-utils';

interface WhereToBuyOption {
  id: string;
  name: string;
  description: string;
  website_url?: string;
  url?: string;
  address?: string;
  is_featured?: boolean;
  featured?: boolean;
  rating?: number;
  review_count?: number;
  image_url?: string;
  type: string;
  region: string;
  benefits: string[];
}

const WhereToBuy = () => {
  const navigate = useNavigate();
  const [whereToBuyOptions, setWhereToBuyOptions] = useState<WhereToBuyOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWhereToBuyOptions();
  }, []);

  const fetchWhereToBuyOptions = async () => {
    try {
      const { data, error } = await supabase
        .from('where_to_buy_options')
        .select('*')
        .order('featured', { ascending: false });

      if (error) throw error;
      setWhereToBuyOptions(data || []);
    } catch (error) {
      console.error('Error fetching where to buy options:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEOHead
        title="Where to Buy Miles Kay Products | Find Retailers & Online Stores"
        description="Find authorized retailers and online stores selling Miles Kay's natural cleaning products. Locate a distributor near you!"
        keywords="Miles Kay retailers, where to buy cleaning products, find Miles Kay near me, cleaning product distributors"
        url="/where-to-buy"
        type="website"
      />
      <StructuredData data={generateOrganizationStructuredData()} />
      <AustralianSEO page="where-to-buy" />

      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        <div className="container mx-auto px-4 py-12">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="mb-8 hover:bg-green-100 hover:text-green-700"
          >
            <Globe className="w-4 h-4 mr-2" />
            Back to Homepage
          </Button>

          <section className="mb-16">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Find Miles Kay Products Near You
              </h2>
              <p className="text-xl text-gray-600">
                Discover where to purchase our eco-friendly cleaning solutions
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center">
                <p className="text-gray-700">Loading options...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {whereToBuyOptions.map((option) => (
                  <Card key={option.id} className="bg-white shadow-lg rounded-lg overflow-hidden h-full flex flex-col">
                    <CardHeader className="p-4 relative">
                      <CardTitle className="text-lg font-semibold text-gray-900 pr-20">{option.name}</CardTitle>
                      {(option.is_featured || option.featured) && (
                        <Badge className="absolute top-4 right-4 bg-green-500 text-white">Featured</Badge>
                      )}
                    </CardHeader>
                    <CardContent className="p-4 flex-1 flex flex-col">
                      {option.image_url && (
                        <img
                          src={option.image_url}
                          alt={option.name}
                          className="w-full h-32 object-cover mb-4 rounded"
                        />
                      )}
                      <p className="text-gray-700 mb-4 flex-1">{option.description}</p>
                      
                      <div className="space-y-3 mt-auto">
                        {option.address && (
                          <div className="flex items-start">
                            <MapPin className="h-4 w-4 mr-2 text-gray-500 mt-0.5 flex-shrink-0" />
                            <a 
                              href={`https://maps.google.com/?q=${encodeURIComponent(option.address)}`} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-blue-500 hover:underline text-sm"
                            >
                              {option.address}
                            </a>
                          </div>
                        )}
                        
                        {(option.website_url || option.url) && (
                          <div className="flex items-center">
                            <ExternalLink className="h-4 w-4 mr-2 text-gray-500 flex-shrink-0" />
                            <a 
                              href={option.website_url || option.url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-blue-500 hover:underline text-sm"
                            >
                              Visit Website
                            </a>
                          </div>
                        )}
                        
                        {option.rating && (
                          <div className="flex items-center">
                            <Star className="h-4 w-4 mr-1 text-yellow-500" />
                            <span className="text-gray-700 text-sm">{option.rating}</span>
                            {option.review_count && (
                              <span className="text-gray-500 ml-1 text-sm">({option.review_count} reviews)</span>
                            )}
                          </div>
                        )}
                        
                        <Button
                          className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-full py-3 mt-4"
                          onClick={() => window.open(option.website_url || option.url, '_blank')}
                        >
                          View Details →
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Can't Find a Store Near You?
            </h2>
            <p className="text-xl text-gray-600 mb-8">
              Shop online and have Miles Kay products delivered to your door
            </p>
            <Button
              size="lg"
              className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white rounded-full px-8 py-3"
              onClick={() => navigate('/products')}
            >
              Shop Online Now
            </Button>
          </section>
        </div>
      </div>
    </>
  );
};

export default WhereToBuy;
