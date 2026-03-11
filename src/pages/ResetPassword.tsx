import { useState, useEffect } from 'react';
import XettleLogo from '@/components/shared/XettleLogo';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { KeyRound, CheckCircle2 } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event from the auth redirect
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    // Also check the URL hash for recovery type
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Password Mismatch", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Weak Password", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast({ title: "Reset Failed", description: error.message, variant: "destructive" });
        return;
      }
      setSuccess(true);
      toast({ title: "Password Updated", description: "Your password has been reset successfully." });
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch {
      toast({ title: "Reset Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <img src="/lovable-uploads/xettle-logo.png" alt="Xettle" className="h-10 mx-auto" />
          </Link>
        </div>

        <Card>
          <CardHeader className="text-center">
            {success ? (
              <>
                <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-2">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <CardTitle className="text-2xl">Password Reset</CardTitle>
                <CardDescription>Your password has been updated. Redirecting...</CardDescription>
              </>
            ) : (
              <>
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <KeyRound className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl">Set New Password</CardTitle>
                <CardDescription>
                  {isRecovery ? 'Enter your new password below.' : 'Verifying your reset link...'}
                </CardDescription>
              </>
            )}
          </CardHeader>
          {!success && (
            <CardContent>
              {isRecovery ? (
                <form onSubmit={handleReset} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      required
                      disabled={isLoading}
                      autoComplete="new-password"
                      maxLength={128}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-new-password">Confirm Password</Label>
                    <Input
                      id="confirm-new-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      required
                      disabled={isLoading}
                      autoComplete="new-password"
                      maxLength={128}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading || !password || !confirmPassword}>
                    {isLoading ? <LoadingSpinner size="sm" text="Resetting..." /> : "Reset Password"}
                  </Button>
                </form>
              ) : (
                <div className="text-center py-4">
                  <LoadingSpinner size="md" text="Verifying reset link..." />
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <div className="text-center mt-4">
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-primary">
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
