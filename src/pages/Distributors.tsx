
import React from 'react';
import SEOHead from '@/components/SEO/SEOHead';
import StructuredData from '@/components/SEO/StructuredData';
import { generateOrganizationStructuredData } from '@/utils/seo-utils';
import SimpleDistributorForm from '@/components/distributor/SimpleDistributorForm';

const Distributors = () => {
  return (
    <>
      <SEOHead
        title="Find Miles Kay Distributors | Authorized Retailer Network"
        description="Connect with authorized Miles Kay distributors worldwide. Find local retailers for our eco-friendly cleaning products or apply to become a distributor partner."
        keywords="Miles Kay distributors, authorized retailers, cleaning product dealers, eco-friendly product distributors, become a distributor, retail partnerships"
        url="/distributors"
        type="website"
      />
      
      <StructuredData data={generateOrganizationStructuredData()} />
      
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold mb-4">Become a Distributor</h1>
            <p className="text-muted-foreground mb-8">Join our network of distributors and be part of our growing success. Fill out the form below to apply.</p>
            
            <SimpleDistributorForm />
          </div>
        </div>
      </div>
    </>
  );
};

export default Distributors;
