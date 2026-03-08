import React, { useState, useEffect } from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import AiContentGenerator from "./AiContentGenerator";
import AiImageGenerator from "./AiImageGenerator";
import { FileText, Save, Key, Edit, Upload, Image, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useOpenAiKey } from "@/hooks/use-supabase-config";

const apiKeySchema = z.object({
  apiKey: z.string().min(20, { message: "API key should be at least 20 characters." }),
});

const blogPostSchema = z.object({
  title: z.string().min(5, { message: "Title must be at least 5 characters." }),
  excerpt: z.string().min(10, { message: "Excerpt must be at least 10 characters." }),
  content: z.string().min(50, { message: "Content must be at least 50 characters." }),
  category: z.string().min(1, { message: "Please select a category." }),
  imageUrl: z.string().optional(),
});

interface AiBlogEditorProps {
  onSubmit: (values: z.infer<typeof blogPostSchema>) => void;
  initialValues?: Partial<z.infer<typeof blogPostSchema>>;
  submitText?: string;
}

const AiBlogEditor: React.FC<AiBlogEditorProps> = ({
  onSubmit,
  initialValues = {},
  submitText = "Create Post"
}) => {
  const { apiKey: openaiApiKey, setApiKey: setOpenaiApiKey, isLoaded } = useOpenAiKey();
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [blogImage, setBlogImage] = useState<string | null>(initialValues.imageUrl || null);
  const [activeTab, setActiveTab] = useState("editor");
  const [generatedContentReceived, setGeneratedContentReceived] = useState(false);

  const apiKeyForm = useForm<z.infer<typeof apiKeySchema>>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      apiKey: "",
    }
  });

  useEffect(() => {
    if (isLoaded && openaiApiKey) {
      apiKeyForm.setValue("apiKey", openaiApiKey);
    }
  }, [isLoaded, openaiApiKey]);

  const form = useForm<z.infer<typeof blogPostSchema>>({
    resolver: zodResolver(blogPostSchema),
    defaultValues: {
      title: initialValues.title || "",
      excerpt: initialValues.excerpt || "",
      content: initialValues.content || "",
      category: initialValues.category || "",
      imageUrl: initialValues.imageUrl || "",
    }
  });

  const handleApiKeySave = (values: z.infer<typeof apiKeySchema>) => {
    setOpenaiApiKey(values.apiKey);
    setIsApiKeyDialogOpen(false);
    
    toast({
      title: "API Key Saved",
      description: "Your OpenAI API key has been saved successfully.",
    });
  };

  const handleImageGenerated = (imageUrl: string) => {
    setBlogImage(imageUrl);
    form.setValue("imageUrl", imageUrl);
    toast({
      title: "Image Added",
      description: "The generated image has been added to your blog post",
    });
  };

  const handleSubmit = (values: z.infer<typeof blogPostSchema>) => {
    if (blogImage) {
      values.imageUrl = blogImage;
    }
    
    onSubmit(values);
    
    setActiveTab("editor");
    
    toast({
      title: "Blog Post Saved",
      description: "Your blog post has been saved successfully",
    });
  };

  const handleContentGenerated = (content: string) => {
    let title = "";
    let excerpt = "";
    let mainContent = content;

    const lines = content.split("\n");
    if (lines.length > 0 && (lines[0].startsWith("# ") || lines[0].startsWith("Title: "))) {
      title = lines[0].replace(/^# |^Title: /, "").trim();
      mainContent = lines.slice(1).join("\n").trim();
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("Title:")) {
        excerpt = trimmed;
        break;
      }
    }

    form.setValue("content", mainContent, { shouldValidate: true });
    
    if (title) {
      form.setValue("title", title, { shouldValidate: true });
    }
    
    if (excerpt) {
      form.setValue("excerpt", excerpt, { shouldValidate: true });
    }
    
    setGeneratedContentReceived(true);
    
    toast({
      title: "Content Applied",
      description: "AI generated content has been applied to your blog post",
    });
  };

  const handleSaveFromAiTools = () => {
    const isValid = form.trigger();
    isValid.then((valid) => {
      if (valid) {
        const values = form.getValues();
        onSubmit(values);
        toast({
          title: "Blog Post Saved",
          description: "Your blog post has been saved successfully",
        });
      } else {
        toast({
          title: "Validation Error",
          description: "Please fill in all required fields before saving",
          variant: "destructive"
        });
        setActiveTab("editor");
      }
    });
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Image size should be less than 5MB",
        variant: "destructive"
      });
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setBlogImage(result);
      form.setValue("imageUrl", result);
      
      toast({
        title: "Image Uploaded",
        description: "Your image has been uploaded successfully",
      });
    };
    
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setBlogImage(null);
    form.setValue("imageUrl", "");
    
    toast({
      title: "Image Removed",
      description: "The blog image has been removed",
    });
  };

  return (
    <div className="space-y-8">
      <Card className="border border-muted">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">OpenAI API Key</h3>
              <p className="text-sm text-muted-foreground">
                {openaiApiKey ? 
                  "Your API key is saved and ready to use" : 
                  "No API key saved. Please add your OpenAI API key to use AI features."}
              </p>
            </div>
            <Dialog open={isApiKeyDialogOpen} onOpenChange={setIsApiKeyDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Key className="mr-2 h-4 w-4" />
                  {openaiApiKey ? "Edit API Key" : "Add API Key"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Manage OpenAI API Key</DialogTitle>
                  <DialogDescription>
                    Enter your OpenAI API key to use AI features. Your key will be stored locally on your device.
                  </DialogDescription>
                </DialogHeader>
                
                <Form {...apiKeyForm}>
                  <form onSubmit={apiKeyForm.handleSubmit(handleApiKeySave)} className="space-y-4">
                    <FormField
                      control={apiKeyForm.control}
                      name="apiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>API Key</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="sk-..." 
                              {...field} 
                              type="password" 
                              autoComplete="off"
                            />
                          </FormControl>
                          <FormDescription>
                            Your API key is stored only on this device and is never sent to our servers.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsApiKeyDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit">
                        <Save className="mr-2 h-4 w-4" />
                        Save API Key
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2">
          <TabsTrigger value="editor">Blog Editor</TabsTrigger>
          <TabsTrigger value="aiTools">AI Tools</TabsTrigger>
        </TabsList>
        
        <TabsContent value="editor" className="space-y-4 pt-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Post Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter post title" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <Input placeholder="Post category" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="excerpt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Excerpt</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Brief summary of the post" 
                        className="min-h-[80px]" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Write the full blog post content here..." 
                        className="min-h-[200px]" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blog Image</FormLabel>
                    <FormControl>
                      <div className="space-y-4">
                        {blogImage && (
                          <div className="relative">
                            <img 
                              src={blogImage} 
                              alt="Blog featured" 
                              className="w-full max-w-md h-auto rounded-md border"
                            />
                            <Button 
                              variant="outline" 
                              size="icon" 
                              className="absolute top-2 right-2 bg-white rounded-full h-8 w-8"
                              onClick={handleRemoveImage}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        
                        <div className="grid grid-cols-2 gap-3">
                          <Button 
                            type="button" 
                            variant="outline" 
                            className="w-full flex items-center justify-center"
                            asChild
                          >
                            <label className="cursor-pointer">
                              <Upload className="mr-2 h-4 w-4" />
                              Upload Image
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                onChange={handleImageUpload}
                              />
                            </label>
                          </Button>
                          
                          <Input 
                            placeholder="Or paste image URL..." 
                            {...field}
                            onChange={(e) => {
                              field.onChange(e);
                              if (e.target.value) {
                                setBlogImage(e.target.value);
                              }
                            }} 
                          />
                        </div>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Upload an image or enter an image URL for your blog post
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button type="submit" className="w-full">
                <FileText className="mr-2 h-4 w-4" />
                {submitText}
              </Button>
            </form>
          </Form>
        </TabsContent>
        
        <TabsContent value="aiTools" className="pt-4">
          <div className="grid md:grid-cols-2 gap-6">
            <AiContentGenerator 
              onContentGenerated={handleContentGenerated}
              initialPrompt={`Write a blog post about ${form.getValues().title || "eco-friendly cleaning products"}`}
            />
            
            <AiImageGenerator 
              onImageGenerated={handleImageGenerated}
              initialPrompt={`Create a professional, high-quality image for a blog post about ${form.getValues().title || "eco-friendly cleaning products"}`}
            />
          </div>

          <div className="mt-6 text-center">
            <Button 
              onClick={handleSaveFromAiTools}
              className="px-8"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Blog Post
            </Button>
          </div>
          
          {generatedContentReceived && (
            <div className="mt-4 p-4 border border-green-200 bg-green-50 rounded-md">
              <h3 className="text-green-800 font-medium mb-1">Content Generated Successfully</h3>
              <p className="text-sm text-green-700">
                AI has generated content for your blog post. Click "Save Blog Post" above to save it, or switch to the Editor tab to review and edit before saving.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AiBlogEditor;
