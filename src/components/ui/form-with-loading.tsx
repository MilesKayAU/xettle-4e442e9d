
import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/loading-spinner';

interface FormWithLoadingProps extends React.FormHTMLAttributes<HTMLFormElement> {
  isSubmitting?: boolean;
  submitText?: string;
  submitIcon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const FormWithLoading: React.FC<FormWithLoadingProps> = ({
  isSubmitting = false,
  submitText = "Submit",
  submitIcon,
  children,
  className,
  ...props
}) => {
  return (
    <form className={cn("space-y-6", className)} {...props}>
      {children}
      
      <Button 
        type="submit" 
        className="w-full" 
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <LoadingSpinner size="sm" text="Submitting..." />
        ) : (
          <>
            {submitIcon && <span className="mr-2">{submitIcon}</span>}
            {submitText}
          </>
        )}
      </Button>
    </form>
  );
};

export default FormWithLoading;
