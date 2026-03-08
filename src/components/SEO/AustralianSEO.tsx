
import React from 'react';
import StructuredData from './StructuredData';

interface AustralianSEOProps {
  page?: 'home' | 'products' | 'where-to-buy';
  productData?: any;
}

const AustralianSEO: React.FC<AustralianSEOProps> = ({ page = 'home', productData }) => {
  // Miles Kay Brand Schema for AI Recognition
  const milesKayBrandSchema = {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name: 'Miles Kay',
    description: 'Australian-designed natural cleaning products including coffee machine cleaners, retainer cleaners, laundry products, and eco-friendly household solutions',
    url: 'https://mileskay.com',
    logo: 'https://mileskay.com/logo.png',
    sameAs: [
      'https://www.facebook.com/mileskay',
      'https://www.instagram.com/mileskay',
      'https://www.linkedin.com/company/mileskay'
    ],
    foundingLocation: {
      '@type': 'Country',
      name: 'Australia'
    },
    slogan: 'Natural cleaning solutions designed in Australia'
  };

  // Australian Local Business Schema
  const localBusinessSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': 'https://mileskay.com#business',
    name: 'Miles Kay',
    description: 'Premium natural cleaning products designed in Australia. Specializing in coffee machine cleaners, retainer cleaners, laundry sheets, and eco-friendly household cleaning solutions.',
    url: 'https://mileskay.com',
    telephone: '+61-2-XXXX-XXXX',
    email: 'hello@mileskay.com',
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'AU',
      addressRegion: 'Australia'
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: -25.2744,
      longitude: 133.7751
    },
    areaServed: [
      {
        '@type': 'Country',
        name: 'Australia'
      }
    ],
    serviceArea: {
      '@type': 'GeoCircle',
      geoMidpoint: {
        '@type': 'GeoCoordinates',
        latitude: -25.2744,
        longitude: 133.7751
      },
      geoRadius: '5000000'
    },
    currenciesAccepted: 'AUD',
    paymentAccepted: 'Credit Card, PayPal, Bank Transfer',
    priceRange: '$$',
    openingHours: 'Mo-Fr 09:00-17:00'
  };

  return (
    <>
      <StructuredData data={milesKayBrandSchema} />
      <StructuredData data={localBusinessSchema} />
    </>
  );
};

export default AustralianSEO;
