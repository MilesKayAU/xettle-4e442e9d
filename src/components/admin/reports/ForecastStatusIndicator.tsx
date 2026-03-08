import React from 'react';
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, AlertTriangle, Zap } from "lucide-react";

interface ForecastStatusIndicatorProps {
  hasData: boolean;
  isGenerating?: boolean;
  lastGenerated?: string;
  isOutdated?: boolean;
}

export const ForecastStatusIndicator: React.FC<ForecastStatusIndicatorProps> = ({
  hasData,
  isGenerating,
  lastGenerated,
  isOutdated
}) => {
  if (isGenerating) {
    return (
      <Badge variant="outline" className="text-blue-600 border-blue-600 animate-pulse">
        <Zap className="h-3 w-3 mr-1" />
        Generating...
      </Badge>
    );
  }

  if (!hasData) {
    return (
      <Badge variant="outline" className="text-gray-600 border-gray-600">
        <Clock className="h-3 w-3 mr-1" />
        No Results
      </Badge>
    );
  }

  if (isOutdated) {
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-600">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Outdated
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-green-600 border-green-600">
      <CheckCircle className="h-3 w-3 mr-1" />
      Current
    </Badge>
  );
};