import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Settings, Zap } from "lucide-react";
import { ForecastSettings } from '@/hooks/useForecastSettings';

interface QuickSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (settings: ForecastSettings, saveAsDefault?: boolean) => void;
  currentSettings: ForecastSettings;
  isGenerating: boolean;
}

export const QuickSettingsModal: React.FC<QuickSettingsModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  currentSettings,
  isGenerating
}) => {
  const [customSettings, setCustomSettings] = useState<ForecastSettings>(currentSettings);
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const handleGenerate = () => {
    onGenerate(customSettings, saveAsDefault);
    onClose();
  };

  const handleReset = () => {
    setCustomSettings(currentSettings);
    setSaveAsDefault(false);
  };

  const isModified = JSON.stringify(customSettings) !== JSON.stringify(currentSettings);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Custom Forecast Settings
          </DialogTitle>
          <DialogDescription>
            Modify settings for this forecast generation. You can optionally save these as your new defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current vs Custom Comparison */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-muted">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Current Saved Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Forecast Period:</span>
                  <span>{currentSettings.forecastPeriodMonths} months</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Calculation Mode:</span>
                  <span className="capitalize">{currentSettings.calculationMode.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lead Time:</span>
                  <span>{currentSettings.leadTimeDays} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Buffer Days:</span>
                  <span>{currentSettings.bufferDays} days</span>
                </div>
              </CardContent>
            </Card>

            <Card className={`border-2 ${isModified ? 'border-primary' : 'border-muted'}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Custom Settings {isModified && <span className="text-xs text-primary">(Modified)</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forecastPeriod">Forecast Period (Months)</Label>
                  <Input
                    id="forecastPeriod"
                    type="number"
                    min="1"
                    max="12"
                    value={customSettings.forecastPeriodMonths}
                    onChange={(e) => setCustomSettings(prev => ({
                      ...prev,
                      forecastPeriodMonths: parseInt(e.target.value) || 1
                    }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="calculationMode">Calculation Mode</Label>
                  <Select
                    value={customSettings.calculationMode}
                    onValueChange={(value: 'from_today' | 'post_arrival') => 
                      setCustomSettings(prev => ({ ...prev, calculationMode: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="from_today">Calculate from Today</SelectItem>
                      <SelectItem value="post_arrival">Calculate Post-Arrival</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="leadTime">Default Lead Time (Days)</Label>
                  <Input
                    id="leadTime"
                    type="number"
                    min="1"
                    max="365"
                    value={customSettings.leadTimeDays}
                    onChange={(e) => setCustomSettings(prev => ({
                      ...prev,
                      leadTimeDays: parseInt(e.target.value) || 1
                    }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bufferDays">Buffer Days</Label>
                  <Input
                    id="bufferDays"
                    type="number"
                    min="0"
                    max="90"
                    value={customSettings.bufferDays}
                    onChange={(e) => setCustomSettings(prev => ({
                      ...prev,
                      bufferDays: parseInt(e.target.value) || 0
                    }))}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* Save Options */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="saveAsDefault"
                checked={saveAsDefault}
                onCheckedChange={(checked) => setSaveAsDefault(checked as boolean)}
              />
              <Label htmlFor="saveAsDefault" className="text-sm">
                Save these settings as my new defaults
              </Label>
            </div>
            
            {saveAsDefault && (
              <p className="text-xs text-muted-foreground pl-6">
                These settings will be automatically used for future forecast generations.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReset} disabled={!isModified}>
            Reset to Saved
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? "Generating..." : "Generate Forecast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};