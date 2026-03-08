
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface UseSEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  noindex?: boolean;
}

export const useSEO = ({
  title,
  description,
  keywords,
  image,
  noindex = false
}: UseSEOProps = {}) => {
  const location = useLocation();

  useEffect(() => {
    // Set canonical URL
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', window.location.href);

    // Set robots meta tag
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }
    robots.setAttribute('content', noindex ? 'noindex, nofollow' : 'index, follow');

    // Update title if provided
    if (title) {
      document.title = title;
    }

    // Update meta description if provided
    if (description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', description);
    }

    // Update meta keywords if provided
    if (keywords) {
      let metaKeywords = document.querySelector('meta[name="keywords"]');
      if (!metaKeywords) {
        metaKeywords = document.createElement('meta');
        metaKeywords.setAttribute('name', 'keywords');
        document.head.appendChild(metaKeywords);
      }
      metaKeywords.setAttribute('content', keywords);
    }
  }, [location, title, description, keywords, image, noindex]);

  return {
    currentUrl: window.location.href,
    pathname: location.pathname
  };
};
