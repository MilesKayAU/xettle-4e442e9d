import React from 'react';
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, FileSpreadsheet, Database, Settings, TrendingUp } from "lucide-react";

interface ForecastWorkflowProgressProps {
  currentStep: 'upload' | 'manage' | 'suppliers' | 'forecast';
  hasData: boolean;
  hasResults: boolean;
}

export const ForecastWorkflowProgress: React.FC<ForecastWorkflowProgressProps> = ({
  currentStep,
  hasData,
  hasResults
}) => {
  const steps = [
    { 
      key: 'upload', 
      label: 'Upload Data', 
      icon: FileSpreadsheet, 
      completed: hasData,
      description: 'Import inventory from Google Sheets'
    },
    { 
      key: 'manage', 
      label: 'Manage Data', 
      icon: Database, 
      completed: hasData,
      description: 'Review and edit inventory data'
    },
    { 
      key: 'suppliers', 
      label: 'Suppliers', 
      icon: Settings, 
      completed: hasData,
      description: 'Configure supplier information'
    },
    { 
      key: 'forecast', 
      label: 'Analysis', 
      icon: TrendingUp, 
      completed: hasResults,
      description: 'Generate and view forecast results'
    },
  ];

  return (
    <div className="bg-card border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-medium mb-3 text-foreground">Workflow Progress</h3>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.key === currentStep;
          const isCompleted = step.completed;
          
          return (
            <div key={step.key} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-2">
                <div 
                  className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors ${
                    isCompleted 
                      ? 'bg-green-100 border-green-600 text-green-700' 
                      : isActive 
                        ? 'bg-blue-100 border-blue-600 text-blue-700' 
                        : 'bg-muted border-border text-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <div className="text-center">
                  <div className={`text-xs font-medium ${
                    isActive || isCompleted ? 'text-foreground' : 'text-foreground/80'
                  }`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-foreground/70 max-w-20 leading-tight">
                    {step.description}
                  </div>
                </div>
                {isActive && (
                  <Badge variant="default" className="text-xs">
                    Current
                  </Badge>
                )}
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-3 transition-colors ${
                  steps[index + 1].completed ? 'bg-green-600' : 'bg-border'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};