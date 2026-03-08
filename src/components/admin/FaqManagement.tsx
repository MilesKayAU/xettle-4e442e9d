
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Table, 
  TableHeader, 
  TableRow, 
  TableHead, 
  TableBody, 
  TableCell 
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Pencil, Trash2, Plus } from "lucide-react";

interface FAQ {
  id: number;
  question: string;
  answer: string;
}

const FaqManagement: React.FC = () => {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [currentFaq, setCurrentFaq] = useState<FAQ>({ id: 0, question: '', answer: '' });

  useEffect(() => {
    // Load FAQs from localStorage
    const savedFaqs = localStorage.getItem('faqs');
    if (savedFaqs) {
      setFaqs(JSON.parse(savedFaqs));
    }
  }, []);

  // Save FAQs to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('faqs', JSON.stringify(faqs));
  }, [faqs]);

  const handleAddFaq = () => {
    if (!currentFaq.question || !currentFaq.answer) {
      toast({
        title: "Missing Information",
        description: "Please provide both a question and an answer.",
        variant: "destructive",
      });
      return;
    }

    const newId = faqs.length > 0 ? Math.max(...faqs.map(faq => faq.id)) + 1 : 1;
    
    const newFaq: FAQ = {
      ...currentFaq,
      id: newId
    };
    
    setFaqs([...faqs, newFaq]);
    setCurrentFaq({ id: 0, question: '', answer: '' });
    setIsAddDialogOpen(false);
    
    toast({
      title: "FAQ Added",
      description: "Your FAQ has been added successfully.",
    });
  };

  const handleEditFaq = () => {
    if (!currentFaq.question || !currentFaq.answer) {
      toast({
        title: "Missing Information",
        description: "Please provide both a question and an answer.",
        variant: "destructive",
      });
      return;
    }

    const updatedFaqs = faqs.map(faq => 
      faq.id === currentFaq.id ? currentFaq : faq
    );
    
    setFaqs(updatedFaqs);
    setCurrentFaq({ id: 0, question: '', answer: '' });
    setIsEditDialogOpen(false);
    
    toast({
      title: "FAQ Updated",
      description: "Your FAQ has been updated successfully.",
    });
  };

  const handleDeleteFaq = (id: number) => {
    if (confirm("Are you sure you want to delete this FAQ?")) {
      const updatedFaqs = faqs.filter(faq => faq.id !== id);
      setFaqs(updatedFaqs);
      
      toast({
        title: "FAQ Deleted",
        description: "Your FAQ has been deleted successfully.",
      });
    }
  };

  const openEditDialog = (faq: FAQ) => {
    setCurrentFaq({ ...faq });
    setIsEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">FAQ Management</h2>
        <Button onClick={() => {
          setCurrentFaq({ id: 0, question: '', answer: '' });
          setIsAddDialogOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" /> Add FAQ
        </Button>
      </div>

      {faqs.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">ID</TableHead>
              <TableHead className="max-w-[400px]">Question</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {faqs.map((faq) => (
              <TableRow key={faq.id}>
                <TableCell>{faq.id}</TableCell>
                <TableCell className="max-w-[400px] truncate">{faq.question}</TableCell>
                <TableCell className="flex space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => openEditDialog(faq)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={() => handleDeleteFaq(faq.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-center py-6 border rounded-md bg-muted">
          <p className="text-muted-foreground">No FAQs have been added yet.</p>
        </div>
      )}

      {/* Add FAQ Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New FAQ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="question" className="text-sm font-medium">Question</label>
              <Input
                id="question"
                placeholder="Enter the question"
                value={currentFaq.question}
                onChange={(e) => setCurrentFaq({ ...currentFaq, question: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="answer" className="text-sm font-medium">Answer</label>
              <Textarea
                id="answer"
                placeholder="Enter the answer"
                className="min-h-[100px]"
                value={currentFaq.answer}
                onChange={(e) => setCurrentFaq({ ...currentFaq, answer: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddFaq}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit FAQ Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit FAQ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="edit-question" className="text-sm font-medium">Question</label>
              <Input
                id="edit-question"
                placeholder="Enter the question"
                value={currentFaq.question}
                onChange={(e) => setCurrentFaq({ ...currentFaq, question: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-answer" className="text-sm font-medium">Answer</label>
              <Textarea
                id="edit-answer"
                placeholder="Enter the answer"
                className="min-h-[100px]"
                value={currentFaq.answer}
                onChange={(e) => setCurrentFaq({ ...currentFaq, answer: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditFaq}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FaqManagement;
