import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, CheckCircle, AlertTriangle, Settings } from 'lucide-react';
import { useAlibabaAccounts, AlibabaAccountDetails, CountryKey } from '@/hooks/use-alibaba-accounts';

const COUNTRY_FLAGS: Record<CountryKey, string> = {
  Australia: '🇦🇺',
  UK: '🇬🇧',
  USA: '🇺🇸',
};

const COUNTRY_COLORS: Record<CountryKey, string> = {
  Australia: 'bg-green-500',
  UK: 'bg-blue-500',
  USA: 'bg-amber-500',
};

interface CountryFormProps {
  country: CountryKey;
  details: AlibabaAccountDetails;
  saving: boolean;
  isConfigured: boolean;
  onSave: (details: AlibabaAccountDetails) => void;
}

const CountryForm: React.FC<CountryFormProps> = ({
  country,
  details,
  saving,
  isConfigured,
  onSave,
}) => {
  const [form, setForm] = useState<AlibabaAccountDetails>(details);

  React.useEffect(() => {
    setForm(details);
  }, [details]);

  const handleChange = (field: keyof AlibabaAccountDetails) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(details);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Status Indicator */}
      <div className="flex items-center gap-2">
        {isConfigured ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Configured</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-medium">Not Configured</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`email-${country}`}>
            Alibaba Registered Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`email-${country}`}
            type="email"
            placeholder="your-alibaba-account@example.com"
            value={form.alibaba_buyer_email}
            onChange={handleChange('alibaba_buyer_email')}
          />
          <p className="text-xs text-muted-foreground">
            The email address registered with your Alibaba buyer account
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`company-${country}`}>
            Buyer/Company Name on Alibaba <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`company-${country}`}
            placeholder="MilesKay Australia Pty Ltd"
            value={form.alibaba_buyer_company}
            onChange={handleChange('alibaba_buyer_company')}
          />
          <p className="text-xs text-muted-foreground">
            Your company name as it appears on Alibaba
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`id-${country}`}>Alibaba Member/Buyer ID</Label>
          <Input
            id={`id-${country}`}
            placeholder="e.g., au1234567890"
            value={form.alibaba_buyer_id}
            onChange={handleChange('alibaba_buyer_id')}
          />
          <p className="text-xs text-muted-foreground">
            Your Alibaba member ID (optional but recommended)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`instructions-${country}`}>Additional Instructions (Optional)</Label>
          <Textarea
            id={`instructions-${country}`}
            placeholder="Any additional instructions for suppliers..."
            value={form.additional_instructions || ''}
            onChange={handleChange('additional_instructions')}
            rows={3}
          />
        </div>
      </div>

      {/* Preview */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-red-600 px-4 py-2">
          <p className="text-white text-sm font-bold">📧 Email Preview</p>
        </div>
        <div className="bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800 mb-2">
            🚨 ALIBABA PAYMENT (TRADE ASSURANCE) – CREATE ORDER TO THIS BUYER ACCOUNT
          </p>
          <div className="bg-white p-3 rounded border text-sm space-y-2">
            <div className="border-b pb-2">
              <span className="text-muted-foreground">Alibaba Registered Email:</span>
              <p className="font-bold">{form.alibaba_buyer_email || '(Not set)'}</p>
            </div>
            <div className="border-b pb-2">
              <span className="text-muted-foreground">Buyer/Company Name on Alibaba:</span>
              <p className="font-bold">{form.alibaba_buyer_company || '(Not set)'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Alibaba Member/Buyer ID:</span>
              <p className="font-bold">{form.alibaba_buyer_id || '(Not set)'}</p>
            </div>
          </div>
          {form.additional_instructions && (
            <p className="text-xs text-red-700 mt-2 italic">
              {form.additional_instructions}
            </p>
          )}
        </div>
      </div>

      <Button type="submit" disabled={saving || !hasChanges} className="w-full">
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            Save {country} Settings
          </>
        )}
      </Button>
    </form>
  );
};

export default function AlibabaAccountSettings() {
  const { accounts, loading, saving, saveAccount, isConfigured } = useAlibabaAccounts();
  const countries: CountryKey[] = ['Australia', 'UK', 'USA'];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <Settings className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <CardTitle>Alibaba Trade Assurance Accounts</CardTitle>
              <CardDescription>
                Configure your Alibaba buyer account details for each entity. These details are included in purchase orders sent to suppliers.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Important:</strong> These details tell suppliers which Alibaba account to create Trade Assurance orders against. 
              Incorrect details will cause suppliers to send payment requests to the wrong account.
            </AlertDescription>
          </Alert>

          <Tabs defaultValue="Australia" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              {countries.map(country => (
                <TabsTrigger
                  key={country}
                  value={country}
                  className="flex items-center gap-2"
                >
                  <span>{COUNTRY_FLAGS[country]}</span>
                  <span>{country}</span>
                  {isConfigured(country) ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {countries.map(country => (
              <TabsContent key={country} value={country}>
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <span className={`p-3 rounded-lg text-2xl ${COUNTRY_COLORS[country]} bg-opacity-20`}>
                        {COUNTRY_FLAGS[country]}
                      </span>
                      <div>
                        <CardTitle className="text-lg">{country} Alibaba Account</CardTitle>
                        <CardDescription>
                          Configure the Trade Assurance details for your {country} entity
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CountryForm
                      country={country}
                      details={accounts[country]}
                      saving={saving === country}
                      isConfigured={isConfigured(country)}
                      onSave={(details) => saveAccount(country, details)}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
