import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Edit2, Trash2, Plus, Building2, Save, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';

interface Supplier {
  id: string;
  name: string;
  company_name?: string;
  company?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  website?: string;
  street?: string;
  city?: string;
  province_region_state?: string;
  postal_code?: string;
  country?: string;
  supplier_date?: string;
  tax_id_number?: string;
  address?: string;
  notes?: string;
}

const SupplierTable: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [newSupplier, setNewSupplier] = useState<Partial<Supplier>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('name');

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error: any) {
      toast({
        title: "Error Loading Suppliers",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const saveSupplier = async (supplier: Supplier) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('suppliers')
        .update(supplier)
        .eq('id', supplier.id);

      if (error) throw error;

      setEditingSupplier(null);
      loadSuppliers();
      
      toast({
        title: "Success",
        description: "Supplier updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error Updating Supplier",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addSupplier = async () => {
    if (!newSupplier.name) {
      toast({
        title: "Error",
        description: "Supplier name is required",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('suppliers')
        .insert([newSupplier as any]);

      if (error) throw error;

      setNewSupplier({});
      setShowAddDialog(false);
      loadSuppliers();
      
      toast({
        title: "Success",
        description: "Supplier added successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error Adding Supplier",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteSupplier = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);

      if (error) throw error;

      loadSuppliers();
      
      toast({
        title: "Success",
        description: "Supplier deleted successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error Deleting Supplier",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const EditableCell: React.FC<{
    value: string;
    field: keyof Supplier;
    supplier: Supplier;
    type?: string;
  }> = ({ value, field, supplier, type = "text" }) => {
    const [editValue, setEditValue] = useState(value || '');

    const handleSave = () => {
      const updatedSupplier = { ...supplier, [field]: editValue };
      setEditingSupplier(updatedSupplier);
    };

    if (editingSupplier?.id === supplier.id) {
      return (
        <div className="flex items-center gap-2">
          <Input
            type={type}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="min-w-32"
            onBlur={handleSave}
            onKeyPress={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
      );
    }

    return (
      <span 
        className="cursor-pointer hover:bg-muted p-1 rounded min-h-6 block"
        onClick={() => {
          setEditingSupplier(supplier);
          setEditValue(value || '');
        }}
      >
        {value || <span className="text-muted-foreground">Click to edit</span>}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Supplier Database
            </CardTitle>
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Supplier
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Supplier</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Supplier Name *</Label>
                    <Input
                      id="name"
                      value={newSupplier.name || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, name: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="company">Company</Label>
                    <Input
                      id="company"
                      value={newSupplier.company || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, company: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="contact_person">Contact Person</Label>
                    <Input
                      id="contact_person"
                      value={newSupplier.contact_person || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, contact_person: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newSupplier.email || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, email: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={newSupplier.phone || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, phone: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="mobile">Mobile</Label>
                    <Input
                      id="mobile"
                      value={newSupplier.mobile || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, mobile: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      value={newSupplier.website || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, website: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={newSupplier.country || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, country: e.target.value})}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={addSupplier} disabled={loading}>
                    {loading ? 'Adding...' : 'Add Supplier'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <EditableCell
                        value={supplier.name}
                        field="name"
                        supplier={supplier}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={supplier.company || supplier.company_name || ''}
                        field="company"
                        supplier={supplier}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={supplier.contact_person || ''}
                        field="contact_person"
                        supplier={supplier}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={supplier.email || ''}
                        field="email"
                        supplier={supplier}
                        type="email"
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={supplier.phone || ''}
                        field="phone"
                        supplier={supplier}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={supplier.mobile || ''}
                        field="mobile"
                        supplier={supplier}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={supplier.country || ''}
                        field="country"
                        supplier={supplier}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {editingSupplier?.id === supplier.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveSupplier(editingSupplier)}
                              disabled={loading}
                            >
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingSupplier(null)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingSupplier(supplier)}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deleteSupplier(supplier.id)}
                              disabled={loading}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {suppliers.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                No suppliers found. Add your first supplier to get started.
              </p>
            </div>
          )}
          
          <div className="mt-4 text-sm text-muted-foreground">
            <Badge variant="outline">{suppliers.length} suppliers</Badge>
            <span className="ml-2">Click on any cell to edit directly</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SupplierTable;