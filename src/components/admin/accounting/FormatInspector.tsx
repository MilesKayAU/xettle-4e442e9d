/**
 * FormatInspector — Admin inspector for marketplace_file_fingerprints.
 * All mutations go through lifecycle helpers (no direct DB writes from UI).
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Fingerprint, MoreHorizontal, CheckCircle2, XCircle, Clock, Pencil, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { updateFingerprintStatus, updateFingerprintNotes, type FingerprintStatus } from '@/utils/fingerprint-lifecycle';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FingerprintRow {
  id: string;
  marketplace_code: string;
  status: string;
  parser_type: string;
  confidence: number | null;
  created_at: string;
  created_by: string | null;
  last_seen_at: string | null;
  notes: string | null;
  column_signature: any;
  column_mapping: any;
}

interface SystemEvent {
  id: string;
  event_type: string;
  severity: string | null;
  created_at: string | null;
  details: any;
  marketplace_code: string | null;
}

interface LinkedSettlement {
  id: string;
  settlement_id: string;
  marketplace: string | null;
  period_start: string;
  period_end: string;
  reconciliation_status: string | null;
  created_at: string;
}

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge className="bg-green-100 text-green-800 border-green-300">Active</Badge>;
  if (status === 'rejected') return <Badge variant="destructive">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-300">Draft</Badge>;
}

// ─── Allowed transitions ────────────────────────────────────────────────────

function getAllowedTransitions(status: string): FingerprintStatus[] {
  switch (status) {
    case 'draft': return ['active', 'rejected'];
    case 'active': return ['rejected', 'draft'];
    case 'rejected': return ['draft'];
    default: return [];
  }
}

const TRANSITION_LABELS: Record<string, string> = {
  active: 'Set Active',
  rejected: 'Reject',
  draft: 'Demote to Draft',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function FormatInspector() {
  const [searchParams] = useSearchParams();
  const deepLinkId = searchParams.get('fingerprint');

  const [fingerprints, setFingerprints] = useState<FingerprintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [parserFilter, setParserFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  // Drawer
  const [selectedFp, setSelectedFp] = useState<FingerprintRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [linkedSettlements, setLinkedSettlements] = useState<LinkedSettlement[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Demote confirm
  const [demoteTarget, setDemoteTarget] = useState<{ id: string; from: string } | null>(null);

  // ─── Load fingerprints ─────────────────────────────────────────────
  const loadFingerprints = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from('marketplace_file_fingerprints')
        .select('id, marketplace_code, status, parser_type, confidence, created_at, created_by, last_seen_at, notes, column_signature, column_mapping')
        .eq('user_id', user.id)
        .order('status', { ascending: true })
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(200);
      setFingerprints((data as any as FingerprintRow[]) || []);
    } catch {
      toast.error('Failed to load formats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFingerprints(); }, [loadFingerprints]);

  // Deep-link: auto-open drawer
  useEffect(() => {
    if (deepLinkId && fingerprints.length > 0) {
      const match = fingerprints.find(fp => fp.id === deepLinkId);
      if (match) openDrawer(match);
    }
  }, [deepLinkId, fingerprints]);

  // ─── Drawer logic ─────────────────────────────────────────────────
  const openDrawer = useCallback(async (fp: FingerprintRow) => {
    setSelectedFp(fp);
    setDrawerOpen(true);
    setEditingNotes(false);
    setNotesValue(fp.notes || '');
    setEventsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    // Load events + settlements in parallel
    const [eventsRes, settlementsRes] = await Promise.all([
      supabase
        .from('system_events')
        .select('id, event_type, severity, created_at, details, marketplace_code')
        .filter('details->>fingerprint_id', 'eq', fp.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, reconciliation_status, created_at')
        .eq('fingerprint_id', fp.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    let eventsList = (eventsRes.data as any as SystemEvent[]) || [];

    // Fallback: if no events matched via JSONB, try marketplace_code + event_type (always scoped to user via RLS + explicit filter)
    if (eventsList.length === 0 && userId) {
      const { data: fallbackEvents } = await supabase
        .from('system_events')
        .select('id, event_type, severity, created_at, details, marketplace_code')
        .eq('user_id', userId)
        .eq('marketplace_code', fp.marketplace_code)
        .in('event_type', [
          'format_draft_created', 'format_promoted_to_active', 'format_save_blocked',
          'format_status_changed', 'format_notes_updated', 'format_fingerprint_create_failed',
        ])
        .order('created_at', { ascending: false })
        .limit(50);
      eventsList = (fallbackEvents as any as SystemEvent[]) || [];
    }

    setEvents(eventsList);
    setLinkedSettlements((settlementsRes.data as any as LinkedSettlement[]) || []);
    setEventsLoading(false);
  }, []);

  // ─── Status change handler ─────────────────────────────────────────
  const handleStatusChange = useCallback(async (fpId: string, newStatus: FingerprintStatus, currentStatus: string) => {
    // Demote active→draft requires confirm
    if (currentStatus === 'active' && newStatus === 'draft') {
      setDemoteTarget({ id: fpId, from: currentStatus });
      return;
    }

    setMutatingId(fpId);
    const result = await updateFingerprintStatus({ fingerprintId: fpId, newStatus });
    setMutatingId(null);

    if (result.success) {
      toast.success(`Format ${result.oldStatus} → ${result.newStatus}`);
      loadFingerprints();
      if (selectedFp?.id === fpId) {
        setSelectedFp(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } else {
      toast.error(result.error || 'Failed to update status');
    }
  }, [loadFingerprints, selectedFp]);

  const confirmDemote = useCallback(async () => {
    if (!demoteTarget) return;
    setMutatingId(demoteTarget.id);
    const result = await updateFingerprintStatus({ fingerprintId: demoteTarget.id, newStatus: 'draft' });
    setMutatingId(null);
    setDemoteTarget(null);

    if (result.success) {
      toast.success('Format demoted to draft');
      loadFingerprints();
    } else {
      toast.error(result.error || 'Failed to demote');
    }
  }, [demoteTarget, loadFingerprints]);

  // ─── Notes save ────────────────────────────────────────────────────
  const handleSaveNotes = useCallback(async () => {
    if (!selectedFp) return;
    setSavingNotes(true);
    const result = await updateFingerprintNotes({ fingerprintId: selectedFp.id, notes: notesValue });
    setSavingNotes(false);

    if (result.success) {
      toast.success('Notes saved');
      setEditingNotes(false);
      setSelectedFp(prev => prev ? { ...prev, notes: notesValue } : null);
      loadFingerprints();
    } else {
      toast.error(result.error || 'Failed to save notes');
    }
  }, [selectedFp, notesValue, loadFingerprints]);

  // ─── Filtering ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = fingerprints;
    if (statusFilter !== 'all') list = list.filter(fp => fp.status === statusFilter);
    if (parserFilter !== 'all') list = list.filter(fp => fp.parser_type === parserFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(fp =>
        fp.marketplace_code.toLowerCase().includes(q) ||
        (fp.notes || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [fingerprints, statusFilter, parserFilter, search]);

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="h-4 w-4" />
            Learned Formats ({fingerprints.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={parserFilter} onValueChange={setParserFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="Parser" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All parsers</SelectItem>
                <SelectItem value="generic">Generic</SelectItem>
                <SelectItem value="ai">AI</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Search marketplace or notes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs w-56"
            />
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading formats...
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No formats found.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Marketplace</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Parser</TableHead>
                    <TableHead className="text-xs">Confidence</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Last Seen</TableHead>
                    <TableHead className="text-xs">Notes</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(fp => (
                    <TableRow
                      key={fp.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDrawer(fp)}
                    >
                      <TableCell className="text-xs font-medium">{fp.marketplace_code}</TableCell>
                      <TableCell><StatusBadge status={fp.status} /></TableCell>
                      <TableCell className="text-xs">{fp.parser_type}</TableCell>
                      <TableCell className="text-xs font-mono">{fp.confidence != null ? `${fp.confidence}%` : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(fp.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fp.last_seen_at ? new Date(fp.last_seen_at).toLocaleDateString() : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{fp.notes || '—'}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={mutatingId === fp.id}>
                              {mutatingId === fp.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {getAllowedTransitions(fp.status).map(t => (
                              <DropdownMenuItem
                                key={t}
                                onClick={() => handleStatusChange(fp.id, t, fp.status)}
                              >
                                {t === 'active' && <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-green-600" />}
                                {t === 'rejected' && <XCircle className="h-3.5 w-3.5 mr-2 text-destructive" />}
                                {t === 'draft' && <Clock className="h-3.5 w-3.5 mr-2 text-amber-600" />}
                                {TRANSITION_LABELS[t] || t}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setSelectedFp(fp); setEditingNotes(true); setNotesValue(fp.notes || ''); setDrawerOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit Notes
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Drilldown Drawer ────────────────────────────────────────── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedFp && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-base">
                  <Fingerprint className="h-4 w-4" />
                  Format: {selectedFp.marketplace_code}
                  <StatusBadge status={selectedFp.status} />
                </SheetTitle>
              </SheetHeader>

              <div className="space-y-5 mt-4">
                {/* Metadata */}
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-y-1.5">
                    <span className="text-muted-foreground">ID</span>
                    <span className="font-mono text-[10px] break-all">{selectedFp.id}</span>
                    <span className="text-muted-foreground">Parser</span>
                    <span>{selectedFp.parser_type}</span>
                    <span className="text-muted-foreground">Confidence</span>
                    <span>{selectedFp.confidence != null ? `${selectedFp.confidence}%` : '—'}</span>
                    <span className="text-muted-foreground">Created</span>
                    <span>{new Date(selectedFp.created_at).toLocaleString()}</span>
                    <span className="text-muted-foreground">Created By</span>
                    <span className="font-mono text-[10px] break-all">{selectedFp.created_by || '—'}</span>
                    <span className="text-muted-foreground">Last Seen</span>
                    <span>{selectedFp.last_seen_at ? new Date(selectedFp.last_seen_at).toLocaleString() : '—'}</span>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Notes</span>
                    {!editingNotes && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => { setEditingNotes(true); setNotesValue(selectedFp.notes || ''); }}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                    )}
                  </div>
                  {editingNotes ? (
                    <div className="space-y-2">
                      <Textarea value={notesValue} onChange={e => setNotesValue(e.target.value)} rows={3} className="text-xs" />
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs" onClick={handleSaveNotes} disabled={savingNotes}>
                          {savingNotes ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Save
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingNotes(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{selectedFp.notes || 'No notes.'}</p>
                  )}
                </div>

                {/* Column Signature */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Column Signature</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(selectedFp.column_signature, null, 2));
                      toast.success('Copied signature');
                    }}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted rounded p-2 max-h-32 overflow-auto font-mono whitespace-pre-wrap">
                    {JSON.stringify(selectedFp.column_signature, null, 2)}
                  </pre>
                </div>

                {/* Column Mapping */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Column Mapping</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(selectedFp.column_mapping, null, 2));
                      toast.success('Copied mapping');
                    }}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">
                    {JSON.stringify(selectedFp.column_mapping, null, 2)}
                  </pre>
                </div>

                {/* System Events */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium">System Events ({events.length})</span>
                  {eventsLoading ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground py-2">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                    </div>
                  ) : events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No related events.</p>
                  ) : (
                    <div className="rounded-md border max-h-60 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px] py-1">Time</TableHead>
                            <TableHead className="text-[10px] py-1">Event</TableHead>
                            <TableHead className="text-[10px] py-1">Severity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {events.map(ev => (
                            <TableRow key={ev.id}>
                              <TableCell className="text-[10px] py-1 text-muted-foreground whitespace-nowrap">
                                {ev.created_at ? new Date(ev.created_at).toLocaleString() : '—'}
                              </TableCell>
                              <TableCell className="text-[10px] py-1 font-mono">{ev.event_type}</TableCell>
                              <TableCell className="text-[10px] py-1">
                                <Badge variant={ev.severity === 'warning' ? 'destructive' : 'outline'} className="text-[9px] px-1 py-0">
                                  {ev.severity || 'info'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Linked Settlements */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium">Linked Settlements ({linkedSettlements.length})</span>
                  {linkedSettlements.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No settlements linked to this format.</p>
                  ) : (
                    <div className="rounded-md border max-h-60 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px] py-1">Settlement ID</TableHead>
                            <TableHead className="text-[10px] py-1">Period</TableHead>
                            <TableHead className="text-[10px] py-1">Recon</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {linkedSettlements.map(s => (
                            <TableRow key={s.id}>
                              <TableCell className="text-[10px] py-1 font-mono">{s.settlement_id}</TableCell>
                              <TableCell className="text-[10px] py-1 text-muted-foreground whitespace-nowrap">
                                {s.period_start} – {s.period_end}
                              </TableCell>
                              <TableCell className="text-[10px] py-1">
                                <Badge variant="outline" className="text-[9px] px-1 py-0">{s.reconciliation_status || '—'}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  {getAllowedTransitions(selectedFp.status).map(t => (
                    <Button
                      key={t}
                      size="sm"
                      className="h-7 text-xs gap-1"
                      variant={t === 'rejected' ? 'destructive' : t === 'active' ? 'default' : 'secondary'}
                      disabled={mutatingId === selectedFp.id}
                      onClick={() => handleStatusChange(selectedFp.id, t, selectedFp.status)}
                    >
                      {mutatingId === selectedFp.id && <Loader2 className="h-3 w-3 animate-spin" />}
                      {TRANSITION_LABELS[t]}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Demote Confirm Dialog */}
      <AlertDialog open={!!demoteTarget} onOpenChange={() => setDemoteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Demote to Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Demoting an active format means new uploads using this format will require re-verification before saving. Existing settlements are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDemote}>Demote</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
