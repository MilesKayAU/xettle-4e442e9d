import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { sanitizeEmail } from "@/utils/input-sanitization";
import LoadingSpinner from "@/components/ui/loading-spinner";
import Honeypot from "@/components/ui/honeypot";
import { Lock, UserPlus } from 'lucide-react';

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') === 'signup' ? 'signup' : 'signin';
  const [isLoading, setIsLoading] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [signInData, setSignInData] = useState({ email: '', password: '' });
  const [signUpData, setSignUpData] = useState({ 
    email: '', 
    password: '', 
    confirmPassword: '',
    fullName: ''
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) navigate('/dashboard');
    };
    checkAuth();
  }, [navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (honeypot.trim().length > 0) return;
    if (!signInData.email || !signInData.password) {
      toast({ title: "Validation Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    const sanitizedEmail = sanitizeEmail(signInData.email);
    if (!sanitizedEmail || sanitizedEmail !== signInData.email.toLowerCase().trim()) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: sanitizedEmail, password: signInData.password });
      if (error) {
        toast({ title: "Sign In Failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Welcome back!", description: "You have been signed in successfully." });
      navigate('/dashboard');
    } catch {
      toast({ title: "Sign In Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (honeypot.trim().length > 0) return;
    if (!signUpData.email || !signUpData.password || !signUpData.confirmPassword) {
      toast({ title: "Validation Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (signUpData.password !== signUpData.confirmPassword) {
      toast({ title: "Password Mismatch", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (signUpData.password.length < 6) {
      toast({ title: "Weak Password", description: "Password must be at least 6 characters long", variant: "destructive" });
      return;
    }
    const sanitizedEmail = sanitizeEmail(signUpData.email);
    if (!sanitizedEmail || sanitizedEmail !== signUpData.email.toLowerCase().trim()) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: sanitizedEmail,
        password: signUpData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { full_name: signUpData.fullName },
        },
      });
      if (error) {
        toast({ title: "Sign Up Failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Account Created!", description: "Please check your email to confirm your account." });
      setSignUpData({ email: '', password: '', confirmPassword: '', fullName: '' });
    } catch {
      toast({ title: "Sign Up Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-bold text-foreground">
            <span className="text-primary">Sync</span>Books
          </Link>
          <p className="text-muted-foreground mt-2">Free Amazon to Xero sync</p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Welcome</CardTitle>
            <CardDescription>Sign in to your account or create a new one</CardDescription>
          </CardHeader>
          <CardContent>
            <Honeypot value={honeypot} onChange={setHoneypot} />
            
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Sign In
                </TabsTrigger>
                <TabsTrigger value="signup" className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Sign Up
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input id="signin-email" type="email" value={signInData.email}
                      onChange={(e) => setSignInData(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="you@example.com" required disabled={isLoading}
                      autoComplete="email" maxLength={254} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input id="signin-password" type="password" value={signInData.password}
                      onChange={(e) => setSignInData(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Enter your password" required disabled={isLoading}
                      autoComplete="current-password" maxLength={128} />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading || !signInData.email || !signInData.password}>
                    {isLoading ? <LoadingSpinner size="sm" text="Signing In..." /> : "Sign In"}
                  </Button>
                </form>
              </TabsContent>
              
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name (Optional)</Label>
                    <Input id="signup-name" type="text" value={signUpData.fullName}
                      onChange={(e) => setSignUpData(prev => ({ ...prev, fullName: e.target.value }))}
                      placeholder="Your full name" disabled={isLoading}
                      autoComplete="name" maxLength={100} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input id="signup-email" type="email" value={signUpData.email}
                      onChange={(e) => setSignUpData(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="you@example.com" required disabled={isLoading}
                      autoComplete="email" maxLength={254} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input id="signup-password" type="password" value={signUpData.password}
                      onChange={(e) => setSignUpData(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Create a password" required disabled={isLoading}
                      autoComplete="new-password" maxLength={128} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirm Password</Label>
                    <Input id="signup-confirm" type="password" value={signUpData.confirmPassword}
                      onChange={(e) => setSignUpData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      placeholder="Confirm your password" required disabled={isLoading}
                      autoComplete="new-password" maxLength={128} />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading || !signUpData.email || !signUpData.password || !signUpData.confirmPassword}>
                    {isLoading ? <LoadingSpinner size="sm" text="Creating Account..." /> : "Create Account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
