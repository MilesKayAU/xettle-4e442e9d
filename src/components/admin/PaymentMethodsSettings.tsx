import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Plus, Trash2, CreditCard, GripVertical, Edit2, Check, X } from 'lucide-react';
import { usePaymentMethods } from '@/hooks/use-payment-methods';

export default function PaymentMethodsSettings() {
  const {
    paymentMethods,
    loading,
    saving,
    addPaymentMethod,
    removePaymentMethod,
    updatePaymentMethod,
  } = usePaymentMethods();

  const [newMethod, setNewMethod] = useState('');
  const [editingMethod, setEditingMethod] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = async () => {
    if (!newMethod.trim()) return;
    await addPaymentMethod(newMethod);
    setNewMethod('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const startEdit = (method: string) => {
    setEditingMethod(method);
    setEditValue(method);
  };

  const cancelEdit = () => {
    setEditingMethod(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (editingMethod && editValue.trim()) {
      await updatePaymentMethod(editingMethod, editValue);
      setEditingMethod(null);
      setEditValue('');
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

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
            <div className="p-2 bg-primary/10 rounded-lg">
              <CreditCard className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>Payment Methods</CardTitle>
              <CardDescription>
                Configure the payment methods available when creating Alibaba invoices and purchase orders.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <CreditCard className="h-4 w-4" />
            <AlertDescription>
              These payment methods appear in dropdown menus when recording payments. 
              Add your credit cards, bank accounts, or payment services.
            </AlertDescription>
          </Alert>

          {/* Add new payment method */}
          <div className="space-y-2">
            <Label htmlFor="new-method">Add Payment Method</Label>
            <div className="flex gap-2">
              <Input
                id="new-method"
                placeholder="e.g., ANZ Business Card"
                value={newMethod}
                onChange={(e) => setNewMethod(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={saving}
              />
              <Button onClick={handleAdd} disabled={saving || !newMethod.trim()}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-2">Add</span>
              </Button>
            </div>
          </div>

          {/* List of payment methods */}
          <div className="space-y-2">
            <Label>Current Payment Methods ({paymentMethods.length})</Label>
            <div className="border rounded-lg divide-y">
              {paymentMethods.map((method) => (
                <div
                  key={method}
                  className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                  
                  {editingMethod === method ? (
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        className="h-8"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-primary hover:text-primary/80"
                        onClick={saveEdit}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={cancelEdit}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <Badge variant="secondary" className="font-normal">
                          {method}
                        </Badge>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(method)}
                        disabled={saving}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removePaymentMethod(method)}
                        disabled={saving || paymentMethods.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {paymentMethods.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No payment methods configured. Add one above.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
