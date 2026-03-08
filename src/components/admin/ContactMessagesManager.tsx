import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Mail, AlertCircle } from 'lucide-react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  message: string;
  date: string;
  created_at: string | null;
};

type PolicyData = {
  command: string;
  definition: string;
  schema: string;
  table: string;
  policy_name: string;
};

const ContactMessagesManager = () => {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  
  useEffect(() => {
    fetchContactMessages();
  }, []);
  
  const fetchContactMessages = async () => {
    const loadingState = isRefreshing ? setIsRefreshing : setIsLoading;
    loadingState(true);
    setError(null);
    setDebugInfo(null);
    
    try {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching contact messages:', error);
        setError(`Database error: ${error.message}`);
        setDebugInfo({ fetchError: error });
        loadingState(false);
        return;
      }
      
      console.log(`Retrieved ${data?.length || 0} contact messages:`, data);
      
      if (data && data.length > 0) {
        const formattedData = data.map(msg => ({
          ...msg,
          date: new Date(msg.created_at || '').toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
          })
        }));
        
        setMessages(formattedData);
      } else {
        console.log('No contact messages found in the database');
        setMessages([]);
      }
    } catch (err: any) {
      console.error('Exception fetching contact messages:', err);
      setError(err.message || 'Unknown error occurred');
      setDebugInfo({ fetchException: err });
    } finally {
      loadingState(false);
    }
  };
  
  const handleSendReply = (email: string, name: string) => {
    window.location.href = `mailto:${email}?subject=RE: Your inquiry to Miles Kay&body=Hello ${name},%0D%0A%0D%0AThank you for contacting Miles Kay.%0D%0A%0D%0A`;
    
    toast({
      title: "Email client opened",
      description: `Composing reply to ${name} at ${email}`,
    });
  };
  
  const handleRefresh = () => {
    fetchContactMessages();
  };
  
  const testDirectInsertion = async () => {
    try {
      console.log('Testing direct insertion to contact_messages table...');
      
      const { data: minimalData, error: minimalError } = await supabase
        .from('contact_messages')
        .insert([{
          name: 'Test User (Minimal)',
          email: 'test-minimal@example.com',
          message: 'This is a minimal test message from admin panel.'
        }]);
      
      console.log('Minimal test result:', { data: minimalData, error: minimalError });
      
      const { data, error } = await supabase
        .from('contact_messages')
        .insert([{
          name: 'Test User',
          email: 'test@example.com',
          message: 'This is a test message from admin panel.'
        }]);
      
      if (error) {
        console.error('Test insertion error:', error);
        toast({
          title: 'Test Failed',
          description: `Error: ${error.message}`,
          variant: 'destructive',
        });
        setDebugInfo({ 
          testInsertion: { 
            success: false, 
            error,
            minimalTest: { success: !minimalError, error: minimalError }
          }
        });
      } else {
        console.log('Test insertion successful:', data);
        toast({
          title: 'Test Successful',
          description: 'Test message was inserted successfully.',
        });
        setDebugInfo({ 
          testInsertion: { 
            success: true, 
            data,
            minimalTest: { success: !minimalError, data: minimalData }
          }
        });
        
        setTimeout(() => {
          fetchContactMessages();
        }, 500);
      }
    } catch (err: any) {
      console.error('Exception during test insertion:', err);
      toast({
        title: 'Test Exception',
        description: err.message || 'Unknown error occurred',
        variant: 'destructive',
      });
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Contact Messages</h2>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={testDirectInsertion}
          >
            <AlertCircle className="h-4 w-4 mr-2" />
            Test Insert
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>
      
      {error && (
        <Alert className="p-4 mb-4 bg-red-50 border border-red-200 rounded-md text-red-800">
          <AlertTitle className="font-semibold">Error occurred:</AlertTitle>
          <AlertDescription>
            <p className="text-sm">{error}</p>
            <p className="text-sm mt-2">Make sure you're logged in as an administrator.</p>
          </AlertDescription>
        </Alert>
      )}
      
      {debugInfo && (
        <Alert className="p-4 mb-4 bg-blue-50 border border-blue-200 rounded-md">
          <AlertTitle className="font-semibold text-blue-800">Debug Information:</AlertTitle>
          <AlertDescription className="text-blue-700">
            <div className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(debugInfo, null, 2)}
            </div>
          </AlertDescription>
        </Alert>
      )}
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            [1, 2, 3].map((i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                <TableCell><Skeleton className="h-8 w-16" /></TableCell>
              </TableRow>
            ))
          ) : messages.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8">
                {error ? 'Error loading messages' : 'No contact messages found in database'}
              </TableCell>
            </TableRow>
          ) : (
            messages.map((msg) => (
              <TableRow key={msg.id}>
                <TableCell className="font-medium">{msg.name}</TableCell>
                <TableCell>{msg.email}</TableCell>
                <TableCell>{msg.date}</TableCell>
                <TableCell className="max-w-xs truncate">{msg.message}</TableCell>
                <TableCell>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleSendReply(msg.email, msg.name)}
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    Reply
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default ContactMessagesManager;
