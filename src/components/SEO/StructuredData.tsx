
import React from 'react';

interface BaseStructuredData {
  '@context': string;
  '@type': string;
  [key: string]: any;
}

interface StructuredDataProps {
  data: BaseStructuredData | BaseStructuredData[];
}

const StructuredData: React.FC<StructuredDataProps> = ({ data }) => {
  React.useEffect(() => {
    const structuredData = Array.isArray(data) ? data : [data];
    
    // Create or update structured data script tag
    let script = document.querySelector('script[type="application/ld+json"]');
    if (!script) {
      script = document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      document.head.appendChild(script);
    }
    
    script.textContent = JSON.stringify(structuredData.length === 1 ? structuredData[0] : structuredData, null, 2);

    // Cleanup function to remove the script when component unmounts
    return () => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [data]);

  return null;
};

export default StructuredData;
