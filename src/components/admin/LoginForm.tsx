
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { sanitizeEmail } from "@/utils/input-sanitization";
import LoadingSpinner from "@/components/ui/loading-spinner";
import Honeypot from "@/components/ui/honeypot";

interface LoginFormProps {
  onLoginSuccess: () => void;
  signIn: (email: string, password: string) => Promise<any>;
}

export default function LoginForm({ onLoginSuccess, signIn }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check honeypot for spam
    if (honeypot.trim().length > 0) {
      // Spam attempt silently blocked
      return;
    }

    // Validate inputs
    if (!email || !password) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    // Sanitize email
    const sanitizedEmail = sanitizeEmail(email);
    if (!sanitizedEmail || sanitizedEmail !== email.toLowerCase().trim()) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const result = await signIn(sanitizedEmail, password);
      
      if (result.success) {
        toast({
          title: 'Login Successful',
          description: 'Welcome to the admin dashboard!',
        });
        onLoginSuccess();
      }
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: "Login Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Honeypot value={honeypot} onChange={setHoneypot} />
      
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          required
          disabled={isLoading}
          autoComplete="email"
          maxLength={254}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          required
          disabled={isLoading}
          autoComplete="current-password"
          maxLength={128}
        />
      </div>
      
      <Button 
        type="submit" 
        className="w-full" 
        disabled={isLoading || !email || !password}
      >
        {isLoading ? <LoadingSpinner size="sm" text="Signing In..." /> : "Sign In"}
      </Button>
    </form>
  );
}
