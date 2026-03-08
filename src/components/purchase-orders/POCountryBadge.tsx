import React from 'react';
import { Badge } from '@/components/ui/badge';

interface POCountryBadgeProps {
  country: 'Australia' | 'UK' | 'USA';
}

const POCountryBadge: React.FC<POCountryBadgeProps> = ({ country }) => {
  const countryConfig = {
    Australia: { flag: '🇦🇺', code: 'AU' },
    UK: { flag: '🇬🇧', code: 'UK' },
    USA: { flag: '🇺🇸', code: 'US' },
  };

  const config = countryConfig[country] || countryConfig.Australia;

  return (
    <Badge variant="outline" className="font-normal">
      {config.flag} {config.code}
    </Badge>
  );
};

export default POCountryBadge;
