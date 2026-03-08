
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ImagePlus, Save, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOpenAiKey } from "@/hooks/use-supabase-config";
import { supabase } from "@/integrations/supabase/client";

interface AiImageGeneratorProps {
  onImageGenerated: (imageUrl: string) => void;
  initialPrompt?: string;
  buttonText?: string;
}

const AiImageGenerator: React.FC<AiImageGeneratorProps> = ({
  onImageGenerated,
  initialPrompt = "",
  buttonText = "Generate Image"
}) => {
  const { apiKey } = useOpenAiKey();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [savedImagePath, setSavedImagePath] = useState<string | null>(null);

  const generateImage = async () => {
    if (!prompt) {
      toast({
        title: "Empty Prompt",
        description: "Please enter a prompt to generate an image",
        variant: "destructive"
      });
      return;
    }

    if (!apiKey) {
      toast({
        title: "API Key Required",
        description: "Please add your OpenAI API key in the Admin settings",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    setSavedImagePath(null);
    
    try {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard"
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Failed to generate image");
      }

      const data = await response.json();
      const imageUrl = data.data[0].url;
      setGeneratedImage(imageUrl);
      
      toast({
        title: "Image Generated",
        description: "AI image has been successfully generated"
      });

      // Immediately save the generated image to Supabase storage
      await saveImageToSupabase(imageUrl);
      
    } catch (error) {
      console.error("Error generating image:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate image",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const saveImageToSupabase = async (imageUrl: string) => {
    if (!imageUrl) return;
    
    setIsSaving(true);
    try {
      // Fetch the image as a blob
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error("Failed to fetch image");
      }
      
      const imageBlob = await imageResponse.blob();
      
      // Generate a unique filename
      const timestamp = new Date().getTime();
      const filename = `blog-image-${timestamp}.jpg`;
      const filePath = `${filename}`;
      
      // Upload to Supabase storage
      const { data, error } = await supabase.storage
        .from('blog-images')
        .upload(filePath, imageBlob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });
      
      if (error) {
        throw error;
      }
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('blog-images')
        .getPublicUrl(filePath);
      
      setSavedImagePath(publicUrl);
      toast({
        title: "Image Saved",
        description: "AI image has been saved to storage"
      });
      
      // Update the current image URL to use the stored version
      onImageGenerated(publicUrl);
      
    } catch (error) {
      console.error("Error saving image to storage:", error);
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save image to storage",
        variant: "destructive"
      });
      
      // Still provide the temporary URL if storage failed
      if (generatedImage) {
        onImageGenerated(generatedImage);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async () => {
    const imageUrl = savedImagePath || generatedImage;
    if (!imageUrl) return;
    
    try {
      // Create an anchor element and trigger download
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `blog-image-${new Date().getTime()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: "Unable to download the image",
        variant: "destructive"
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Image Generator</CardTitle>
        <CardDescription>Generate blog images using AI</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="Describe the image you want to generate..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[100px]"
        />
        
        {generatedImage && (
          <div className="mt-4">
            <img 
              src={savedImagePath || generatedImage} 
              alt="AI generated" 
              className="w-full h-auto rounded-md border"
            />
            <div className="mt-2 flex justify-between items-center text-sm">
              <span className="text-green-600 font-medium">
                {savedImagePath ? "✓ Saved to storage" : ""}
              </span>
              {(savedImagePath || generatedImage) && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleDownload}
                  className="ml-auto"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button 
          onClick={generateImage} 
          disabled={isGenerating || !prompt || !apiKey || isSaving}
          className="flex-1"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <ImagePlus className="mr-2 h-4 w-4" />
              {buttonText}
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default AiImageGenerator;
