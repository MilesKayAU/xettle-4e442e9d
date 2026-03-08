
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface WhereToBuyOption {
  id: string;
  region: string;
  name: string;
  url: string;
  description: string;
  type: string;
  benefits: string[];
  featured: boolean;
  created_at: string;
}

const WhereToBuyManagement = () => {
  const [options, setOptions] = useState<WhereToBuyOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingOption, setEditingOption] = useState<WhereToBuyOption | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    region: '',
    name: '',
    url: '',
    description: '',
    type: '',
    benefits: '',
    featured: false
  });

  useEffect(() => {
    fetchOptions();
  }, []);

  const fetchOptions = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('where_to_buy_options')
        .select('*')
        .order('region', { ascending: true });

      if (error) throw error;
      setOptions(data || []);
    } catch (error) {
      console.error('Error fetching where to buy options:', error);
      toast({
        title: "Error",
        description: "Failed to load where to buy options",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const benefitsArray = formData.benefits.split('\n').filter(b => b.trim() !== '');
      
      const optionData = {
        region: formData.region,
        name: formData.name,
        url: formData.url,
        description: formData.description,
        type: formData.type,
        benefits: benefitsArray,
        featured: formData.featured
      };

      let error;
      
      if (editingOption) {
        const { error: updateError } = await (supabase as any)
          .from('where_to_buy_options')
          .update(optionData)
          .eq('id', editingOption.id);
        error = updateError;
      } else {
        const { error: insertError } = await (supabase as any)
          .from('where_to_buy_options')
          .insert(optionData);
        error = insertError;
      }

      if (error) throw error;

      toast({
        title: "Success",
        description: `Where to buy option ${editingOption ? 'updated' : 'created'} successfully`
      });

      setIsDialogOpen(false);
      setEditingOption(null);
      resetForm();
      fetchOptions();
    } catch (error) {
      console.error('Error saving where to buy option:', error);
      toast({
        title: "Error",
        description: "Failed to save where to buy option",
        variant: "destructive"
      });
    }
  };

  const handleEdit = (option: WhereToBuyOption) => {
    setEditingOption(option);
    setFormData({
      region: option.region,
      name: option.name,
      url: option.url,
      description: option.description,
      type: option.type,
      benefits: option.benefits.join('\n'),
      featured: option.featured
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this where to buy option?')) return;

    try {
      const { error } = await (supabase as any)
        .from('where_to_buy_options')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Where to buy option deleted successfully"
      });

      fetchOptions();
    } catch (error) {
      console.error('Error deleting where to buy option:', error);
      toast({
        title: "Error",
        description: "Failed to delete where to buy option",
        variant: "destructive"
      });
    }
  };

  const resetForm = () => {
    setFormData({
      region: '',
      name: '',
      url: '',
      description: '',
      type: '',
      benefits: '',
      featured: false
    });
  };

  const handleNewOption = () => {
    setEditingOption(null);
    resetForm();
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Where to Buy Management</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNewOption}>
              <Plus className="w-4 h-4 mr-2" />
              Add New Option
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingOption ? 'Edit Where to Buy Option' : 'Add New Where to Buy Option'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="region">Region</Label>
                <Select value={formData.region} onValueChange={(value) => setFormData({...formData, region: value})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Australia">Australia</SelectItem>
                    <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                    <SelectItem value="United States">United States</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="name">Store Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                />
              </div>

              <div>
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({...formData, url: e.target.value})}
                  required
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  required
                />
              </div>

              <div>
                <Label htmlFor="type">Type</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({...formData, type: value})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Official Store">Official Store</SelectItem>
                    <SelectItem value="Marketplace">Marketplace</SelectItem>
                    <SelectItem value="Retailer">Retailer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="benefits">Benefits (one per line)</Label>
                <Textarea
                  id="benefits"
                  value={formData.benefits}
                  onChange={(e) => setFormData({...formData, benefits: e.target.value})}
                  placeholder="Enter each benefit on a new line"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="featured"
                  checked={formData.featured}
                  onChange={(e) => setFormData({...formData, featured: e.target.checked})}
                />
                <Label htmlFor="featured">Featured Region</Label>
              </div>

              <Button type="submit" className="w-full">
                {editingOption ? 'Update Option' : 'Add Option'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {options.map((option) => (
          <Card key={option.id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {option.name}
                    {option.featured && <Badge className="bg-green-600">Featured</Badge>}
                  </CardTitle>
                  <p className="text-sm text-gray-600">{option.region} • {option.type}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(option.url, '_blank')}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(option)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(option.id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 mb-3">{option.description}</p>
              <div>
                <h4 className="text-sm font-semibold mb-2">Benefits:</h4>
                <ul className="space-y-1">
                  {option.benefits.map((benefit, index) => (
                    <li key={index} className="text-sm text-gray-600 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default WhereToBuyManagement;
