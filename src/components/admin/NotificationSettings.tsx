import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mail, Check, X, Bell, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSettings } from '@/hooks/use-notification-settings';

export function NotificationSettings() {
  const { toast } = useToast();
  const { notificationEmail, saveNotificationEmail, clearNotificationEmail, isConfigured, loading } = useNotificationSettings();
  const [emailInput, setEmailInput] = useState(notificationEmail);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEmailInput(notificationEmail);
  }, [notificationEmail]);

  const handleSave = async () => {
    if (!emailInput.trim()) {
      toast({
        title: "Email required",
        description: "Please enter an email address",
        variant: "destructive"
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput.trim())) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    const success = await saveNotificationEmail(emailInput.trim());
    setSaving(false);

    if (success) {
      toast({
        title: "Settings saved",
        description: "Invoice notification email updated"
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to save notification email",
        variant: "destructive"
      });
    }
  };

  const handleClear = async () => {
    setSaving(true);
    const success = await clearNotificationEmail();
    setSaving(false);

    if (success) {
      setEmailInput('');
      toast({
        title: "Notifications disabled",
        description: "Invoice email notifications have been turned off"
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to disable notifications",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Invoice Notifications
        </CardTitle>
        <CardDescription>
          Configure email notifications for new invoices ready for Xero sync
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label>Status:</Label>
          {isConfigured ? (
            <Badge variant="default" className="bg-green-500">
              <Check className="h-3 w-3 mr-1" />
              Enabled
            </Badge>
          ) : (
            <Badge variant="secondary">
              <X className="h-3 w-3 mr-1" />
              Disabled
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="notification-email">
            <Mail className="h-4 w-4 inline mr-2" />
            Notification Email
          </Label>
          <div className="flex gap-2">
            <Input
              id="notification-email"
              type="email"
              placeholder="admin@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="flex-1"
              disabled={saving}
            />
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
            {isConfigured && (
              <Button variant="outline" onClick={handleClear} disabled={saving}>
                Disable
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            When set, you'll receive an email notification each time a new invoice is created
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
