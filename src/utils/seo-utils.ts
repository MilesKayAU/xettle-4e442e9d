
export const generateSitemap = (routes: string[]): string => {
  const baseUrl = window.location.origin;
  const currentDate = new Date().toISOString();

  const urlEntries = routes.map(route => {
    const priority = route === '/' ? '1.0' : 
                    route.startsWith('/products') ? '0.9' : 
                    route === '/where-to-buy' ? '0.8' :
                    route.startsWith('/blog') ? '0.7' : '0.6';
    
    const changefreq = route === '/' ? 'weekly' :
                      route.startsWith('/products') ? 'weekly' :
                      route === '/where-to-buy' ? 'weekly' :
                      route.startsWith('/blog') ? 'monthly' : 'monthly';

    return `  <url>
    <loc>${baseUrl}${route}</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
};

export const generateRobotsTxt = (): string => {
  const baseUrl = window.location.origin;
  
  return `User-agent: *
Allow: /

# Prioritize important pages for Australian market
User-agent: Googlebot
Allow: /
Crawl-delay: 1

User-agent: Bingbot
Allow: /
Crawl-delay: 1

# Social media crawlers
User-agent: Twitterbot
Allow: /

User-agent: facebookexternalhit
Allow: /

# Block admin areas
User-agent: *
Disallow: /admin

Sitemap: ${baseUrl}/sitemap.xml

# Additional Australian-focused directives
# Prioritize product pages for search visibility
User-agent: *
Allow: /products/
Allow: /where-to-buy`;
};

export const generateProductStructuredData = (product: any, images: any) => {
  const baseUrl = window.location.origin;
  
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${baseUrl}/products/${product.slug}#product`,
    name: `Miles Kay ${product.title}`,
    description: `${product.description} - Australian-designed natural cleaning solution`,
    brand: {
      '@type': 'Brand',
      '@id': `${baseUrl}#brand`,
      name: 'Miles Kay',
      description: 'Australian-designed natural cleaning products',
      logo: `${baseUrl}/placeholder.svg`,
      url: baseUrl,
      foundingLocation: {
        '@type': 'Country',
        name: 'Australia'
      }
    },
    manufacturer: {
      '@type': 'Organization',
      name: 'Miles Kay',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'AU'
      }
    },
    category: product.category,
    image: images.main ? [images.main] : [`${baseUrl}/placeholder.svg`],
    url: `${baseUrl}/products/${product.slug}`,
    countryOfOrigin: 'Australia',
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'PVA Content',
        value: '0%'
      },
      {
        '@type': 'PropertyValue',
        name: 'Design Origin',
        value: 'Australia'
      },
      {
        '@type': 'PropertyValue',
        name: 'Natural Ingredients',
        value: 'Yes'
      }
    ],
    offers: {
      '@type': 'AggregateOffer',
      availability: 'https://schema.org/InStock',
      priceCurrency: 'AUD',
      seller: {
        '@type': 'Organization',
        name: 'Miles Kay Australia',
        address: {
          '@type': 'PostalAddress',
          addressCountry: 'AU'
        }
      }
    },
    audience: {
      '@type': 'Audience',
      geographicArea: {
        '@type': 'Country',
        name: 'Australia'
      }
    }
  };
};

export const generateOrganizationStructuredData = () => {
  const baseUrl = window.location.origin;
  
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${baseUrl}#organization`,
    name: 'Miles Kay',
    alternateName: 'Miles Kay Australia',
    url: baseUrl,
    logo: `${baseUrl}/placeholder.svg`,
    description: 'Australian-designed natural cleaning solutions including coffee machine cleaners, retainer cleaners, laundry sheets, and eco-friendly household products. Specializing in PVA-free formulations.',
    foundingLocation: {
      '@type': 'Country',
      name: 'Australia'
    },
    areaServed: {
      '@type': 'Country',
      name: 'Australia'
    },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+61-2-XXXX-XXXX',
      email: 'hello@mileskay.com',
      contactType: 'Customer Service',
      areaServed: 'AU',
      availableLanguage: 'English'
    },
    sameAs: [
      'https://www.facebook.com/mileskay',
      'https://www.instagram.com/mileskay',
      'https://www.linkedin.com/company/mileskay',
      'https://www.amazon.com.au/s?srs=24307900051'
    ],
    knowsAbout: [
      'Natural cleaning products',
      'Coffee machine cleaning',
      'Retainer cleaning',
      'Eco-friendly laundry solutions',
      'PVA-free cleaning products',
      'Australian household products'
    ],
    makesOffer: [
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: 'Coffee Machine Cleaner',
          category: 'Cleaning Products'
        }
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: 'Retainer Cleaner',
          category: 'Dental Care'
        }
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: 'Laundry Sheets',
          category: 'Laundry Products'
        }
      }
    ]
  };
};

export const generateArticleStructuredData = (post: any) => {
  const baseUrl = window.location.origin;
  
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${baseUrl}/blog/${post.id}#article`,
    headline: post.title,
    description: post.excerpt || post.description,
    author: {
      '@type': 'Organization',
      name: 'Miles Kay',
      url: baseUrl
    },
    publisher: {
      '@type': 'Organization',
      name: 'Miles Kay',
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/placeholder.svg`
      },
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'AU'
      }
    },
    datePublished: post.date || new Date().toISOString(),
    dateModified: post.date || new Date().toISOString(),
    image: post.imageUrl || `${baseUrl}/placeholder.svg`,
    url: `${baseUrl}/blog/${post.id}`,
    isPartOf: {
      '@type': 'Blog',
      name: 'Miles Kay Blog',
      description: 'Natural cleaning tips and product information from Australia'
    },
    inLanguage: 'en-AU',
    audience: {
      '@type': 'Audience',
      geographicArea: {
        '@type': 'Country',
        name: 'Australia'
      }
    }
  };
};
