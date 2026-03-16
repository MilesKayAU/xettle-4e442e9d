import React, { useState, useEffect } from 'react';
import XettleLogo from '@/components/shared/XettleLogo';
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
import { Lock, UserPlus, Mail, Shield } from 'lucide-react';
import { hashPin } from "@/hooks/use-settings-pin";

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
    fullName: '',
    settingsPin: '',
    confirmSettingsPin: '',
  });
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);

  useEffect(() => {
    // Use onAuthStateChange instead of getSession to avoid blocking on slow DB
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && event !== 'SIGNED_OUT') {
        navigate('/dashboard');
      }
    });
    return () => subscription.unsubscribe();
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
      // Race against a timeout to handle slow DB responses
      const signInPromise = supabase.auth.signInWithPassword({ email: sanitizedEmail, password: signInData.password });
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      
      const { error } = await Promise.race([signInPromise, timeoutPromise]);
      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setResendEmail(sanitizedEmail);
          setShowResendVerification(true);
        }
        toast({ title: "Sign In Failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Welcome back!", description: "You have been signed in successfully." });
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err?.message === 'timeout'
        ? "Sign in is taking longer than usual — please try again"
        : "An unexpected error occurred";
      toast({ title: "Sign In Failed", description: msg, variant: "destructive" });
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
      setResendEmail(sanitizedEmail);
      setShowResendVerification(true);
      setSignUpData({ email: '', password: '', confirmPassword: '', fullName: '' });
    } catch {
      toast({ title: "Sign Up Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedEmail = sanitizeEmail(forgotEmail);
    if (!sanitizedEmail) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(sanitizedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast({ title: "Reset Failed", description: error.message, variant: "destructive" });
        return;
      }
      setForgotSent(true);
      toast({ title: "Reset Email Sent", description: "Check your inbox for a password reset link." });
    } catch {
      toast({ title: "Reset Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!resendEmail) return;
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: resendEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) {
        toast({ title: "Resend Failed", description: error.message, variant: "destructive" });
        return;
      }
      setResendSent(true);
      toast({ title: "Verification Email Sent", description: `A new verification email has been sent to ${resendEmail}.` });
    } catch {
      toast({ title: "Resend Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <XettleLogo height={40} />
          </Link>
          <p className="text-muted-foreground mt-2">Amazon settlements, Xettled.</p>
        </div>

        {/* Resend verification banner */}
        {showResendVerification && (
          <Card className="mb-4 border-primary/30 bg-primary/5">
            <CardContent className="py-4 flex items-start gap-3">
              <Mail className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Check your email</p>
                <p className="text-xs text-muted-foreground mt-1">
                  We sent a verification link to <span className="font-medium">{resendEmail}</span>
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="px-0 h-auto text-xs mt-1"
                  disabled={isLoading || resendSent}
                  onClick={handleResendVerification}
                >
                  {resendSent ? '✓ Verification email resent' : "Didn't receive it? Resend"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Welcome</CardTitle>
            <CardDescription>Sign in to your account or create a new one</CardDescription>
          </CardHeader>
          <CardContent>
            <Honeypot value={honeypot} onChange={setHoneypot} />

            {showForgotPassword ? (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <p className="text-sm font-medium text-foreground">Reset your password</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter your email and we'll send you a reset link
                  </p>
                </div>
                {forgotSent ? (
                  <div className="text-center py-4 space-y-3">
                    <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                      <Mail className="h-6 w-6 text-green-600" />
                    </div>
                    <p className="text-sm text-foreground font-medium">Check your email</p>
                    <p className="text-xs text-muted-foreground">
                      We sent a password reset link to <span className="font-medium">{forgotEmail}</span>
                    </p>
                    <Button variant="outline" size="sm" onClick={() => { setShowForgotPassword(false); setForgotSent(false); setForgotEmail(''); }}>
                      Back to Sign In
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="forgot-email">Email</Label>
                      <Input
                        id="forgot-email"
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        disabled={isLoading}
                        autoComplete="email"
                        maxLength={254}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading || !forgotEmail}>
                      {isLoading ? <LoadingSpinner size="sm" text="Sending..." /> : "Send Reset Link"}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={() => setShowForgotPassword(false)}>
                      Back to Sign In
                    </Button>
                  </form>
                )}
              </div>
            ) : (
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
                      <div className="flex items-center justify-between">
                        <Label htmlFor="signin-password">Password</Label>
                        <Button
                          variant="link"
                          className="px-0 h-auto text-xs text-muted-foreground"
                          type="button"
                          onClick={() => setShowForgotPassword(true)}
                        >
                          Forgot password?
                        </Button>
                      </div>
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
