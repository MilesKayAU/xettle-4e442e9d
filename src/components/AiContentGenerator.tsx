
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOpenAiKey } from "@/hooks/use-supabase-config";

interface AiContentGeneratorProps {
  onContentGenerated: (content: string) => void;
  initialPrompt?: string;
  buttonText?: string;
}

const AiContentGenerator: React.FC<AiContentGeneratorProps> = ({ 
  onContentGenerated, 
  initialPrompt = "", 
  buttonText = "Generate Content"
}) => {
  const { apiKey } = useOpenAiKey();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);

  const generateContent = async () => {
    if (!prompt) {
      toast({
        title: "Empty Prompt",
        description: "Please enter a prompt to generate content",
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
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a professional blog content writer. Create engaging, informative content based on the provided topic. Write in a clear, concise style that is optimized for SEO."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Failed to generate content");
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      setGeneratedContent(content);
      onContentGenerated(content);
      
      toast({
        title: "Content Generated",
        description: "AI content has been successfully generated"
      });
    } catch (error) {
      console.error("Error generating content:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate content",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Content Generator</CardTitle>
        <CardDescription>Generate blog content using AI</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="Enter a topic or description for your blog post..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[100px]"
        />
        
        {generatedContent && (
          <div className="mt-4 p-3 bg-gray-50 border rounded-md">
            <h3 className="text-sm font-medium mb-1">Generated Content Preview:</h3>
            <p className="text-xs text-muted-foreground">
              {generatedContent.length > 150 
                ? generatedContent.substring(0, 150) + "..." 
                : generatedContent}
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button 
          onClick={generateContent} 
          disabled={isGenerating || !prompt || !apiKey}
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              {buttonText}
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default AiContentGenerator;
