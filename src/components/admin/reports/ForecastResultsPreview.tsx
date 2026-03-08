import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertTriangle, Package, DollarSign, Clock, ArrowRight, FileText } from "lucide-react";
import { ForecastWithInventory } from '@/hooks/use-inventory-database';
import { useNavigate } from "react-router-dom";

interface ForecastResultsPreviewProps {
  forecastData: ForecastWithInventory[];
  lastGenerated?: string;
  onViewFullAnalysis: () => void;
  isOutdated?: boolean;
}

export const ForecastResultsPreview: React.FC<ForecastResultsPreviewProps> = ({
  forecastData,
  lastGenerated,
  onViewFullAnalysis,
  isOutdated = false
}) => {
  const navigate = useNavigate();
  if (forecastData.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-medium text-muted-foreground mb-1">No Forecast Results</h3>
          <p className="text-sm text-muted-foreground">
            Generate a forecast to see results preview here
          </p>
        </CardContent>
      </Card>
    );
  }

  const stats = {
    total: forecastData.length,
    critical: forecastData.filter(item => item.urgency_level === 'critical').length,
    needReorder: forecastData.filter(item => item.reorder_quantity_required > 0).length,
    totalProfit: forecastData.reduce((sum, item) => sum + item.forecasted_profit, 0),
    totalMissedProfit: forecastData.reduce((sum, item) => sum + item.missed_profit, 0),
  };

  return (
    <Card className={isOutdated ? "border-amber-200 bg-amber-50/50" : "border-green-200 bg-green-50/50"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Latest Forecast Results
            {isOutdated && (
              <Badge variant="outline" className="ml-2 text-amber-600 border-amber-600">
                <Clock className="h-3 w-3 mr-1" />
                Outdated
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            <Button 
              onClick={() => navigate('/purchase-orders')}
              variant="default" 
              size="sm"
              className="flex items-center gap-2"
              disabled={stats.needReorder === 0}
            >
              <FileText className="h-4 w-4" />
              Generate POs
            </Button>
            <Button 
              onClick={onViewFullAnalysis}
              variant="outline" 
              size="sm"
              className="flex items-center gap-2"
            >
              View Full Analysis
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {lastGenerated && (
          <p className="text-xs text-muted-foreground">
            Generated: {new Date(lastGenerated).toLocaleString()}
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-600" />
            <div>
              <div className="text-lg font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total SKUs</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <div>
              <div className="text-lg font-bold text-red-600">{stats.critical}</div>
              <div className="text-xs text-muted-foreground">Critical</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-600" />
            <div>
              <div className="text-lg font-bold text-orange-600">{stats.needReorder}</div>
              <div className="text-xs text-muted-foreground">Reorder</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-600" />
            <div>
              <div className="text-lg font-bold text-green-600">
                ${Math.round(stats.totalProfit).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">Profit</div>
            </div>
          </div>
        </div>
        
        {isOutdated && (
          <div className="mt-3 p-2 bg-amber-100 border border-amber-200 rounded text-xs text-amber-700">
            Settings have changed since this forecast was generated. Consider regenerating for updated results.
          </div>
        )}
        
        {stats.critical > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span className="text-red-600 font-medium">
              {stats.critical} product{stats.critical !== 1 ? 's' : ''} need immediate attention
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};