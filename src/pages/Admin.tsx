import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import XettleLogo from '@/components/shared/XettleLogo';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import { supabase } from '@/integrations/supabase/client';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogOut, Users, ArrowLeft, CheckCircle, XCircle, RefreshCw, Trash2, KeyRound, UserPlus, Mail, Store, Bug, ShieldCheck, Rocket, BookOpen, Crosshair } from 'lucide-react';
import AccountResetButton from '@/components/admin/AccountResetButton';
import { toast } from '@/hooks/use-toast';
import MarketplaceConfigTab from '@/components/admin/marketplace/MarketplaceConfigTab';
import BugReportsDashboard from '@/components/admin/BugReportsDashboard';
import DataIntegrityDashboard from '@/components/admin/DataIntegrityDashboard';
import PreLaunchChecklist from '@/components/admin/PreLaunchChecklist';
import KnowledgeBaseDashboard from '@/components/admin/KnowledgeBaseDashboard';
import GrowthScoutDashboard from '@/components/admin/GrowthScoutDashboard';
import EmailMonitoringDashboard from '@/components/admin/EmailMonitoringDashboard';

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  xero_connected: boolean;
  amazon_connected: boolean;
  settlement_count: number;
}

export default function Admin() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user, handleSignOut } = useAdminAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/auth');
      return;
    }
    async function checkAdmin() {
      if (!user) return;
      const { data } = await supabase.rpc('has_role', { _role: 'admin' });
      setIsAdmin(!!data);
      if (!data) navigate('/dashboard');
    }
    if (user) checkAdmin();
  }, [isLoading, isAuthenticated, user, navigate]);

  const loadUsers = async () => {
    if (!user) return;
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-list-users', {
        method: 'GET',
      });
      if (error) throw error;
      setUsers(data?.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-users', {
        body: { action: 'delete_user', userId: deleteTarget.id },
      });
      if (error) throw error;
      toast({ title: 'User Deleted', description: `${deleteTarget.email} has been removed.` });
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to delete user', variant: 'destructive' });
    } finally {
      setActionLoading(null);
      setDeleteTarget(null);
    }
  };

  const handleSendReset = async (targetUser: UserRow) => {
    setActionLoading(targetUser.id);
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-users', {
        body: { action: 'send_password_reset', email: targetUser.email },
      });
      if (error) throw error;
      toast({ title: 'Reset Sent', description: `Password reset email sent to ${targetUser.email}` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to send reset', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) return;
    setActionLoading('invite');
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-users', {
        body: { action: 'invite_user', email: inviteEmail.trim() },
      });
      if (error) throw error;
      toast({ title: 'Invite Sent', description: `Invitation sent to ${inviteEmail}` });
      setInviteEmail('');
      setInviteOpen(false);
      loadUsers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to invite user', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading || isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" text="Loading..." />
      </div>
    );
  }

  if (!isAuthenticated || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container-custom flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="flex items-center">
              <XettleLogo height={32} />
            </Link>
            <Badge variant="secondary">Admin</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Dashboard
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="container-custom py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-muted-foreground mt-1">Manage users and monitor connections <span className="font-mono text-xs opacity-50">v1.7.0</span></p>
          </div>
          <div className="flex gap-2">
            <AccountResetButton />
            <Button variant="default" size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1" />
              Invite User
            </Button>
            <Button variant="outline" size="sm" onClick={loadUsers} disabled={loadingUsers}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loadingUsers ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList>
            <TabsTrigger value="users" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Users
            </TabsTrigger>
            <TabsTrigger value="marketplaces" className="flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5" />
              Marketplace Config
            </TabsTrigger>
            <TabsTrigger value="bugs" className="flex items-center gap-1.5">
              <Bug className="h-3.5 w-3.5" />
              Bug Reports
            </TabsTrigger>
            <TabsTrigger value="integrity" className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Data Integrity
            </TabsTrigger>
            <TabsTrigger value="prelaunch" className="flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5" />
              Pre-Launch
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Knowledge Base
            </TabsTrigger>
            <TabsTrigger value="growth" className="flex items-center gap-1.5">
              <Crosshair className="h-3.5 w-3.5" />
              Growth
            </TabsTrigger>
            <TabsTrigger value="emails" className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Emails
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Users</CardDescription>
                  <CardTitle className="text-3xl">{users.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Xero Connected</CardDescription>
                  <CardTitle className="text-3xl">{users.filter(u => u.xero_connected).length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Amazon Connected</CardDescription>
                  <CardTitle className="text-3xl">{users.filter(u => u.amazon_connected).length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Settlements</CardDescription>
                  <CardTitle className="text-3xl">{users.reduce((s, u) => s + u.settlement_count, 0)}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Users table */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <CardTitle>All Users</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <div className="flex justify-center py-8">
                    <LoadingSpinner size="md" text="Loading users..." />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No users found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead>Last Sign In</TableHead>
                        <TableHead>Xero</TableHead>
                        <TableHead>Amazon</TableHead>
                        <TableHead className="text-right">Settlements</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.email}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(u.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {u.last_sign_in_at
                              ? new Date(u.last_sign_in_at).toLocaleDateString()
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {u.xero_connected ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            {u.amazon_connected ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="text-right">{u.settlement_count}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Send password reset"
                                disabled={actionLoading === u.id}
                                onClick={() => handleSendReset(u)}
                              >
                                <KeyRound className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Delete user"
                                disabled={actionLoading === u.id || u.id === user?.id}
                                onClick={() => setDeleteTarget(u)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="marketplaces">
            <MarketplaceConfigTab />
          </TabsContent>

          <TabsContent value="bugs">
            <BugReportsDashboard />
          </TabsContent>

          <TabsContent value="integrity">
            <DataIntegrityDashboard />
          </TabsContent>

          <TabsContent value="prelaunch">
            <PreLaunchChecklist />
          </TabsContent>

          <TabsContent value="knowledge">
            <KnowledgeBaseDashboard />
          </TabsContent>

          <TabsContent value="growth">
            <GrowthScoutDashboard />
          </TabsContent>

          <TabsContent value="emails">
            <EmailMonitoringDashboard />
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.email}</strong> and all their data (settlements, Xero tokens, settings). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
            <DialogDescription>
              Send an invitation email with a setup link to a new user.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="email"
            placeholder="user@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInviteUser()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInviteUser} disabled={actionLoading === 'invite' || !inviteEmail.trim()}>
              <Mail className="h-4 w-4 mr-1" />
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
