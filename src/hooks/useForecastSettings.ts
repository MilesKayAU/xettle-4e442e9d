import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/hooks/use-toast';

export interface ForecastSettings {
  forecastPeriodMonths: number;
  leadTimeDays: number;
  bufferDays: number;
  safetyStockMultiplier: number;
  calculationMode: 'from_today' | 'post_arrival';
}

const DEFAULT_SETTINGS: ForecastSettings = {
  forecastPeriodMonths: 3,
  leadTimeDays: 30,
  bufferDays: 7,
  safetyStockMultiplier: 1.5,
  calculationMode: 'post_arrival'
};

const STORAGE_KEY = 'forecast-settings-v2';

export const useForecastSettings = () => {
  const [settings, setSettings] = useState<ForecastSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings(parsed);
      }
    } catch (error) {
      console.error('Failed to load forecast settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: Partial<ForecastSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSettings));
      toast({
        title: "Settings Saved",
        description: "Your forecast settings have been saved successfully.",
      });
    } catch (error) {
      console.error('Failed to save forecast settings:', error);
      toast({
        title: "Save Failed",
        description: "Could not save settings. Please try again.",
        variant: "destructive",
      });
    }
  }, [settings]);

  // Update specific setting
  const updateSetting = useCallback((key: keyof ForecastSettings, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  }, [settings]);

  // Reset to defaults
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(STORAGE_KEY);
    toast({
      title: "Settings Reset",
      description: "All forecast settings have been reset to defaults.",
    });
  }, []);

  return {
    settings,
    isLoading,
    saveSettings,
    updateSetting,
    resetSettings,
  };
};