
import { useState, useEffect } from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Send, CheckCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { 
  submitContactForm, 
  ContactFormData, 
  supabase, 
  debugAuthStatus
} from "@/integrations/supabase/client";

const formSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  message: z.string().min(10, { message: "Message must be at least 10 characters." })
});

const Contact = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [debug, setDebug] = useState<any>(null);

  // Debug check on component mount
  useEffect(() => {
    const verifyAuth = async () => {
      await debugAuthStatus();
    };
    
    verifyAuth().catch(console.error);
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      message: ""
    }
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    setSubmitSuccess(false);
    setDebug(null);
    
    try {
      console.log("Starting contact message submission process:", values);
      
      const formData: ContactFormData = {
        name: values.name,
        email: values.email.toLowerCase().trim(),
        message: values.message
      };
      
      const result = await submitContactForm(formData);
      
      if (!result.success) {
        console.error("Error submitting contact form:", result.error);
        setDebug({
          submission: values,
          error: result.error,
          timestamp: new Date().toISOString()
        });
        throw new Error(result.message || "Failed to submit contact form");
      }
      
      toast({
        title: "Message sent",
        description: "Thank you for getting in touch. We'll respond shortly.",
      });
      
      setSubmitSuccess(true);
      form.reset();
    } catch (error: any) {
      console.error("Exception in contact form submission:", error);
      
      toast({
        title: "Message Failed",
        description: error.message || "There was an error sending your message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-16 animate-fadeIn">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-3 text-primary">Contact Us</h1>
        <p className="text-muted mb-8 text-lg">Have questions or want to learn more? Get in touch with our team.</p>
        
        {submitSuccess && (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-700" />
            <AlertTitle className="text-green-800">Message Sent Successfully</AlertTitle>
            <AlertDescription className="text-green-700">
              Thank you for contacting us. We'll respond to your message shortly.
            </AlertDescription>
          </Alert>
        )}
        
        {debug && (
          <Alert className="mb-6 bg-blue-50 border-blue-200">
            <AlertTitle className="text-blue-800">Debug Information</AlertTitle>
            <AlertDescription className="text-blue-700 whitespace-pre-wrap overflow-auto max-h-40">
              {JSON.stringify(debug, null, 2)}
            </AlertDescription>
          </Alert>
        )}
        
        <div className="bg-white p-8 rounded-lg shadow-md">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="your.email@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="message"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Tell us about your inquiry" 
                        className="min-h-[150px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isSubmitting}
              >
                {isSubmitting ? "Sending..." : "Send Message"}
                <Send className="ml-2 h-4 w-4" />
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
};

export default Contact;
