
import React, { useEffect } from 'react';
import { useProducts } from '@/hooks/use-products';
import { generateSitemap, generateRobotsTxt } from '@/utils/seo-utils';

const SitemapGenerator: React.FC = () => {
  const { products } = useProducts();

  useEffect(() => {
    // Only generate once when we have meaningful data
    if (!products) return;
    
    const generateAndLogSitemap = () => {
      try {
        // Generate static routes
        const staticRoutes = [
          '/',
          '/products',
          '/distributors',
          '/where-to-buy'
        ];

        // Add dynamic product routes
        const productRoutes = products.length > 0 
          ? products.map(product => `/products/${product.slug}`)
          : [];

        // Combine all routes
        const allRoutes = [...staticRoutes, ...productRoutes];

        // Only log once to avoid spam
        if (!(window as any).sitemapGenerated) {
          console.log('📄 Generated sitemap.xml with routes:', allRoutes);
          console.log('🤖 Generated robots.txt content ready');
          (window as any).sitemapGenerated = true;
        }

        // Generate sitemap XML
        const sitemapXml = generateSitemap(allRoutes);
        const robotsTxt = generateRobotsTxt();

        // Store in window for debugging if needed
        window.generatedSitemap = {
          xml: sitemapXml,
          robots: robotsTxt,
          routes: allRoutes,
          timestamp: new Date().toISOString()
        };

      } catch (error) {
        console.error('❌ Sitemap generation error:', error);
      }
    };

    generateAndLogSitemap();
  }, [products?.length]);

  // This component doesn't render anything visible
  return null;
};

export default SitemapGenerator;
