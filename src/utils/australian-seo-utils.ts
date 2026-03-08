
export const generateAustralianProductSchema = (product: any, images: any) => {
  const baseUrl = window.location.origin;
  
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${baseUrl}/products/${product.slug}#product`,
    name: `Miles Kay ${product.title}`,
    description: `${product.description} - Natural cleaning solution designed in Australia`,
    brand: {
      '@type': 'Brand',
      '@id': `${baseUrl}#brand`,
      name: 'Miles Kay',
      description: 'Australian-designed natural cleaning products',
      logo: `${baseUrl}/placeholder.svg`,
      url: baseUrl,
      sameAs: [
        'https://www.facebook.com/mileskay',
        'https://www.instagram.com/mileskay'
      ]
    },
    manufacturer: {
      '@type': 'Organization',
      name: 'Miles Kay',
      description: 'Australian company specializing in natural cleaning products',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'AU'
      }
    },
    category: product.category || 'Natural Cleaning Products',
    image: images.main ? [images.main] : [`${baseUrl}/placeholder.svg`],
    url: `${baseUrl}/products/${product.slug}`,
    countryOfOrigin: 'Australia',
    material: 'Natural ingredients, 0% PVA',
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'PVA Content',
        value: '0%'
      },
      {
        '@type': 'PropertyValue',
        name: 'Country of Design',
        value: 'Australia'
      },
      {
        '@type': 'PropertyValue',
        name: 'Eco-Friendly',
        value: 'Yes'
      }
    ],
    offers: {
      '@type': 'AggregateOffer',
      availability: 'https://schema.org/InStock',
      priceCurrency: 'AUD',
      seller: {
        '@type': 'Organization',
        name: 'Miles Kay',
        url: baseUrl
      },
      offerCount: 3,
      offers: [
        {
          '@type': 'Offer',
          name: 'Miles Kay Australia Direct',
          url: 'https://www.mileskayaustralia.com',
          availability: 'https://schema.org/InStock',
          priceCurrency: 'AUD',
          seller: {
            '@type': 'Organization',
            name: 'Miles Kay Australia'
          }
        },
        {
          '@type': 'Offer',
          name: 'Amazon Australia',
          url: 'https://www.amazon.com.au',
          availability: 'https://schema.org/InStock',
          priceCurrency: 'AUD',
          seller: {
            '@type': 'Organization',
            name: 'Amazon Australia'
          }
        }
      ]
    },
    audience: {
      '@type': 'Audience',
      geographicArea: {
        '@type': 'Country',
        name: 'Australia'
      }
    },
    review: [
      {
        '@type': 'Review',
        reviewRating: {
          '@type': 'Rating',
          ratingValue: 5,
          bestRating: 5
        },
        author: {
          '@type': 'Person',
          name: 'Sarah M.'
        },
        reviewBody: 'Excellent natural cleaning product. So glad to find an Australian brand that actually works!'
      }
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: 4.8,
      reviewCount: 127,
      bestRating: 5,
      worstRating: 1
    }
  };
};

export const generateAustralianKeywords = (baseKeywords: string) => {
  const australianKeywords = [
    'australia',
    'australian made',
    'australian designed',
    'natural cleaning australia',
    'eco friendly australia',
    'green cleaning products australia',
    'melbourne cleaning products',
    'sydney cleaning products',
    'brisbane cleaning products',
    'perth cleaning products',
    'adelaide cleaning products',
    'australian natural products',
    'aussie cleaning',
    'environmentally friendly australia'
  ];
  
  return `${baseKeywords}, ${australianKeywords.join(', ')}`;
};

export const generateLocalBusinessSchema = () => {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': 'https://mileskay.com#localbusiness',
    name: 'Miles Kay',
    description: 'Premium natural cleaning products designed in Australia. Coffee machine cleaners, retainer cleaners, laundry products and eco-friendly solutions.',
    url: 'https://mileskay.com',
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'AU',
      addressRegion: 'Australia'
    },
    areaServed: {
      '@type': 'Country',
      name: 'Australia'
    },
    currenciesAccepted: 'AUD',
    openingHours: 'Mo-Fr 09:00-17:00',
    telephone: '+61-2-XXXX-XXXX',
    email: 'hello@mileskay.com',
    sameAs: [
      'https://www.facebook.com/mileskay',
      'https://www.instagram.com/mileskay',
      'https://www.linkedin.com/company/mileskay'
    ]
  };
};
