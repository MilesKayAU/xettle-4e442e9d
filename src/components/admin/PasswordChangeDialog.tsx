
import React from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Key } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(6, { message: "Current password must be at least 6 characters." }),
  newPassword: z.string().min(6, { message: "New password must be at least 6 characters." }),
  confirmPassword: z.string().min(6, { message: "Confirm password must be at least 6 characters." }),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "New passwords don't match",
  path: ["confirmPassword"],
});

interface PasswordChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPassword: string;
  onPasswordChange: (newPassword: string) => void;
}

const PasswordChangeDialog: React.FC<PasswordChangeDialogProps> = ({
  open,
  onOpenChange,
  currentPassword,
  onPasswordChange
}) => {
  const passwordChangeForm = useForm<z.infer<typeof passwordChangeSchema>>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    }
  });

  const onPasswordChangeSubmit = (values: z.infer<typeof passwordChangeSchema>) => {
    if (values.currentPassword !== currentPassword) {
      toast({
        title: "Password Change Failed",
        description: "Current password is incorrect. Please try again.",
        variant: "destructive",
      });
      return;
    }
    
    localStorage.setItem('adminPassword', values.newPassword);
    onPasswordChange(values.newPassword);
    
    toast({
      title: "Password Changed",
      description: "Your admin password has been updated successfully.",
    });
    
    onOpenChange(false);
    passwordChangeForm.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Admin Password</DialogTitle>
          <DialogDescription>
            Update your administrator password.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...passwordChangeForm}>
          <form onSubmit={passwordChangeForm.handleSubmit(onPasswordChangeSubmit)} className="space-y-4">
            <FormField
              control={passwordChangeForm.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={passwordChangeForm.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={passwordChangeForm.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">
                <Key className="mr-2 h-4 w-4" />
                Update Password
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default PasswordChangeDialog;
