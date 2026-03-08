
import React from 'react';

interface SEOHeadProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'product';
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
    section?: string;
    tags?: string[];
  };
  product?: {
    brand?: string;
    category?: string;
    availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
    condition?: 'NewCondition' | 'UsedCondition' | 'RefurbishedCondition';
  };
}

const SEOHead: React.FC<SEOHeadProps> = ({
  title = "Miles Kay - Innovative Cleaning Solutions",
  description = "Discover Miles Kay's revolutionary cleaning products including 0% PVA dishwashing sheets, laundry sheets, and professional coffee machine cleaning solutions.",
  keywords = "cleaning products, PVA-free, eco-friendly, dishwashing sheets, laundry sheets, coffee machine cleaning, sustainable cleaning",
  image = "/placeholder.svg",
  url = window.location.href,
  type = "website",
  article,
  product
}) => {
  const siteUrl = window.location.origin;
  const fullImageUrl = image.startsWith('http') ? image : `${siteUrl}${image}`;
  const canonicalUrl = url.startsWith('http') ? url : `${siteUrl}${url}`;

  React.useEffect(() => {
    // Set document title
    document.title = title;

    // Helper function to set meta tag
    const setMetaTag = (name: string, content: string, property?: boolean) => {
      const attribute = property ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attribute}="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attribute, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    // Set canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', canonicalUrl);

    // Basic meta tags
    setMetaTag('description', description);
    setMetaTag('keywords', keywords);
    setMetaTag('author', 'Miles Kay');
    setMetaTag('robots', 'index, follow');
    setMetaTag('viewport', 'width=device-width, initial-scale=1.0');

    // Open Graph meta tags
    setMetaTag('og:title', title, true);
    setMetaTag('og:description', description, true);
    setMetaTag('og:type', type, true);
    setMetaTag('og:url', canonicalUrl, true);
    setMetaTag('og:image', fullImageUrl, true);
    setMetaTag('og:image:width', '1200', true);
    setMetaTag('og:image:height', '630', true);
    setMetaTag('og:site_name', 'Miles Kay', true);
    setMetaTag('og:locale', 'en_US', true);

    // Twitter Card meta tags
    setMetaTag('twitter:card', 'summary_large_image');
    setMetaTag('twitter:title', title);
    setMetaTag('twitter:description', description);
    setMetaTag('twitter:image', fullImageUrl);
    setMetaTag('twitter:site', '@mileskay');
    setMetaTag('twitter:creator', '@mileskay');

    // Article specific meta tags
    if (type === 'article' && article) {
      if (article.publishedTime) {
        setMetaTag('article:published_time', article.publishedTime, true);
      }
      if (article.modifiedTime) {
        setMetaTag('article:modified_time', article.modifiedTime, true);
      }
      if (article.author) {
        setMetaTag('article:author', article.author, true);
      }
      if (article.section) {
        setMetaTag('article:section', article.section, true);
      }
      if (article.tags) {
        article.tags.forEach((tag, index) => {
          setMetaTag(`article:tag:${index}`, tag, true);
        });
      }
    }

    // Product specific meta tags
    if (type === 'product' && product) {
      if (product.brand) {
        setMetaTag('product:brand', product.brand, true);
      }
      if (product.category) {
        setMetaTag('product:category', product.category, true);
      }
      if (product.availability) {
        setMetaTag('product:availability', product.availability, true);
      }
      if (product.condition) {
        setMetaTag('product:condition', product.condition, true);
      }
    }
  }, [title, description, keywords, fullImageUrl, canonicalUrl, type, article, product]);

  return null;
};

export default SEOHead;
