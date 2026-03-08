import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Settings, Calculator, Clock, Calendar, Save } from "lucide-react";
import { useForecastSettings, ForecastSettings } from "@/hooks/useForecastSettings";

interface SimpleForecastSettingsProps {
  onGenerate: (settings: ForecastSettings) => void;
  isGenerating?: boolean;
}

const SimpleForecastSettings: React.FC<SimpleForecastSettingsProps> = ({
  onGenerate,
  isGenerating = false
}) => {
  const { settings, updateSetting, saveSettings } = useForecastSettings();

  const handleGenerate = () => {
    onGenerate(settings);
  };

  const handleSave = () => {
    saveSettings({});
  };

  const periodOptions = [
    { value: 1, label: '1 Month', description: 'Short-term' },
    { value: 3, label: '3 Months', description: 'Quarterly' },
    { value: 6, label: '6 Months', description: 'Semi-annual' },
    { value: 12, label: '12 Months', description: 'Annual' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Forecast Configuration
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure your forecast parameters and generate analysis
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Forecast Period */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Forecast Period
          </Label>
          <Select
            value={settings.forecastPeriodMonths.toString()}
            onValueChange={(value) => updateSetting('forecastPeriodMonths', parseInt(value))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  <div className="flex items-center justify-between w-full">
                    <span>{option.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {option.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Calculation Method */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Calculation Method
          </Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card 
              className={`cursor-pointer transition-all ${
                settings.calculationMode === 'from_today' 
                  ? 'ring-2 ring-primary bg-primary/5' 
                  : 'hover:bg-muted/50'
              }`}
              onClick={() => updateSetting('calculationMode', 'from_today')}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-sm font-medium">📅 From Today</div>
                  {settings.calculationMode === 'from_today' && (
                    <Badge variant="default" className="text-xs">Active</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Calculate total stock needed from today through {settings.forecastPeriodMonths} months
                </div>
              </CardContent>
            </Card>

            <Card 
              className={`cursor-pointer transition-all ${
                settings.calculationMode === 'post_arrival' 
                  ? 'ring-2 ring-primary bg-primary/5' 
                  : 'hover:bg-muted/50'
              }`}
              onClick={() => updateSetting('calculationMode', 'post_arrival')}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-sm font-medium">🚀 Post Arrival</div>
                  {settings.calculationMode === 'post_arrival' && (
                    <Badge variant="default" className="text-xs">Active</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Calculate stock for {settings.forecastPeriodMonths} months after new shipment arrives
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Advanced Parameters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Lead Time (Days)
            </Label>
            <Input
              type="number"
              value={settings.leadTimeDays}
              onChange={(e) => updateSetting('leadTimeDays', parseInt(e.target.value) || 30)}
              min="1"
              max="365"
            />
          </div>

          <div className="space-y-2">
            <Label>Buffer Days</Label>
            <Input
              type="number"
              value={settings.bufferDays}
              onChange={(e) => updateSetting('bufferDays', parseInt(e.target.value) || 7)}
              min="0"
              max="90"
            />
          </div>

          <div className="space-y-2">
            <Label>Safety Stock (×)</Label>
            <Input
              type="number"
              step="0.1"
              value={settings.safetyStockMultiplier}
              onChange={(e) => updateSetting('safetyStockMultiplier', parseFloat(e.target.value) || 1.5)}
              min="1.0"
              max="3.0"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex-1"
          >
            {isGenerating ? 'Generating...' : `Generate ${settings.forecastPeriodMonths}-Month Forecast`}
          </Button>
          <Button
            onClick={handleSave}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>

        {/* Current Settings Summary */}
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-sm font-medium mb-2">Current Configuration</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Period: {settings.forecastPeriodMonths} months</div>
            <div>Method: {settings.calculationMode === 'from_today' ? 'From Today' : 'Post Arrival'}</div>
            <div>Lead Time: {settings.leadTimeDays} days</div>
            <div>Buffer: {settings.bufferDays} days</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SimpleForecastSettings;