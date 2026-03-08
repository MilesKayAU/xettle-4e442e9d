import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Clock, Calendar, Shield, Calculator } from "lucide-react";
import { ForecastSettings } from '@/hooks/useForecastSettings';

interface SettingsPreviewCardProps {
  settings: ForecastSettings;
  isLoading?: boolean;
}

export const SettingsPreviewCard: React.FC<SettingsPreviewCardProps> = ({
  settings,
  isLoading = false
}) => {
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="py-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Loading settings...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Current Forecast Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Period</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {settings.forecastPeriodMonths} months
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Mode</span>
              </div>
              <Badge variant="outline" className="text-xs">
                {settings.calculationMode === 'from_today' ? 'From Today' : 'Post-Arrival'}
              </Badge>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Lead Time</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {settings.leadTimeDays} days
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Buffer</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {settings.bufferDays} days
              </Badge>
            </div>
          </div>
        </div>
        
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            These settings will be used for forecast calculations. You can modify them when generating forecasts.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};