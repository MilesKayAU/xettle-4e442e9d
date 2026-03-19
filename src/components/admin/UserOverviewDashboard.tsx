import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { RefreshCw, ChevronDown, ChevronRight, TrendingUp, DollarSign, Store, Package, Users, Search, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';

interface MpBreakdown {
  marketplace: string;
  settlement_count: number;
  gross_sales: number;
  total_fees: number;
  refunds: number;
  net_deposit: number;
  gst: number;
}

interface UserOverview {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  xero_connected: boolean;
  amazon_connected: boolean;
  ebay_connected: boolean;
  marketplace_count: number;
  marketplaces: string[];
  total_settlements: number;
  total_gross_sales: number;
  total_fees: number;
  total_refunds: number;
  total_net_deposit: number;
  total_gst: number;
  fee_rate_pct: number;
  profit_margin_pct: number | null;
  total_orders: number;
  total_units: number;
  total_gross_profit: number;
  marketplace_breakdown: MpBreakdown[];
  tax_profile: string | null;
  boundary_date: string | null;
  trial_started_at: string | null;
  pushed_to_xero_count: number;
}

interface Summary {
  total_users: number;
  active_users: number;
  total_revenue_processed: number;
  total_fees_processed: number;
  total_settlements: number;
  xero_connected: number;
  amazon_connected: number;
  ebay_connected: number;
}

type SortKey = 'total_gross_sales' | 'total_settlements' | 'marketplace_count' | 'total_orders' | 'email' | 'created_at';

const fmt = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export default function UserOverviewDashboard() {
  const [users, setUsers] = useState<UserOverview[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_gross_sales');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-overview');
      if (error) throw error;
      setUsers(data.users || []);
      setSummary(data.summary || null);
    } catch (err: any) {
      toast.error(`Failed to load overview: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.marketplaces.some(m => m.toLowerCase().includes(search.toLowerCase()))
  );

  const sorted = [...filtered].sort((a, b) => {
    let av: any, bv: any;
    if (sortKey === 'email') { av = a.email; bv = b.email; }
    else if (sortKey === 'created_at') { av = a.created_at; bv = b.created_at; }
    else { av = a[sortKey]; bv = b[sortKey]; }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort(field)}>
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? 'text-primary' : 'text-muted-foreground/50'}`} />
      </span>
    </TableHead>
  );

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="md" text="Loading user overview..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Platform summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardDescription className="text-xs flex items-center gap-1"><Users className="h-3 w-3" /> Active Users</CardDescription>
              <CardTitle className="text-2xl">{summary.active_users}<span className="text-sm text-muted-foreground font-normal"> / {summary.total_users}</span></CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardDescription className="text-xs flex items-center gap-1"><DollarSign className="h-3 w-3" /> Total Revenue</CardDescription>
              <CardTitle className="text-2xl">{fmt(summary.total_revenue_processed)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardDescription className="text-xs flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Total Fees</CardDescription>
              <CardTitle className="text-2xl">{fmt(summary.total_fees_processed)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardDescription className="text-xs flex items-center gap-1"><Package className="h-3 w-3" /> Settlements</CardDescription>
              <CardTitle className="text-2xl">{summary.total_settlements.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Connection breakdown */}
      {summary && (
        <div className="flex gap-3 flex-wrap text-xs">
          <Badge variant="outline" className="gap-1">Xero: {summary.xero_connected}</Badge>
          <Badge variant="outline" className="gap-1">Amazon: {summary.amazon_connected}</Badge>
          <Badge variant="outline" className="gap-1">eBay: {summary.ebay_connected}</Badge>
        </div>
      )}

      {/* Search + refresh */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or marketplace…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground">{filtered.length} users</span>
      </div>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <SortHeader label="Email" field="email" />
                  <SortHeader label="Gross Sales" field="total_gross_sales" />
                  <SortHeader label="Settlements" field="total_settlements" />
                  <SortHeader label="Marketplaces" field="marketplace_count" />
                  <SortHeader label="Orders" field="total_orders" />
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Fee %</TableHead>
                  <TableHead className="text-right">Net Deposit</TableHead>
                  <TableHead>Connections</TableHead>
                  <TableHead>Tax</TableHead>
                  <SortHeader label="Joined" field="created_at" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((u) => {
                  const isExpanded = expandedUser === u.id;
                  return (
                    <React.Fragment key={u.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                      >
                        <TableCell className="w-8 pr-0">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium text-xs max-w-[180px] truncate" title={u.email}>
                          {u.email}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {u.total_gross_sales > 0 ? fmt(u.total_gross_sales) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-xs">{u.total_settlements || '—'}</TableCell>
                        <TableCell className="text-center text-xs">
                          {u.marketplace_count > 0 ? (
                            <Badge variant="secondary" className="text-[10px]">{u.marketplace_count}</Badge>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-xs">{u.total_orders > 0 ? u.total_orders.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {u.total_fees > 0 ? fmt(u.total_fees) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {u.fee_rate_pct > 0 ? fmtPct(u.fee_rate_pct) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {u.total_net_deposit !== 0 ? fmt(u.total_net_deposit) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {u.xero_connected && <Badge variant="outline" className="text-[9px] px-1 py-0">Xero</Badge>}
                            {u.amazon_connected && <Badge variant="outline" className="text-[9px] px-1 py-0">AMZ</Badge>}
                            {u.ebay_connected && <Badge variant="outline" className="text-[9px] px-1 py-0">eBay</Badge>}
                            {!u.xero_connected && !u.amazon_connected && !u.ebay_connected && (
                              <span className="text-muted-foreground text-[10px]">None</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {u.tax_profile ? (
                            <Badge variant="secondary" className="text-[9px]">{u.tax_profile === 'AU_GST' ? 'GST' : 'No GST'}</Badge>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(u.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>

                      {/* Expanded marketplace breakdown */}
                      {isExpanded && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={12} className="p-0">
                            <div className="px-6 py-4 space-y-3">
                              {/* User summary strip */}
                              <div className="flex flex-wrap gap-4 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Pushed to Xero: </span>
                                  <span className="font-medium">{u.pushed_to_xero_count} / {u.total_settlements}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Refunds: </span>
                                  <span className="font-medium">{fmt(u.total_refunds)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">GST Collected: </span>
                                  <span className="font-medium">{fmt(u.total_gst)}</span>
                                </div>
                                {u.total_gross_profit > 0 && (
                                  <div>
                                    <span className="text-muted-foreground">Gross Profit: </span>
                                    <span className="font-medium">{fmt(u.total_gross_profit)}</span>
                                    {u.profit_margin_pct !== null && (
                                      <span className="text-muted-foreground ml-1">({fmtPct(u.profit_margin_pct)})</span>
                                    )}
                                  </div>
                                )}
                                {u.total_units > 0 && (
                                  <div>
                                    <span className="text-muted-foreground">Units Sold: </span>
                                    <span className="font-medium">{u.total_units.toLocaleString()}</span>
                                  </div>
                                )}
                                {u.boundary_date && (
                                  <div>
                                    <span className="text-muted-foreground">Boundary: </span>
                                    <span className="font-medium">{u.boundary_date}</span>
                                  </div>
                                )}
                                {u.last_sign_in_at && (
                                  <div>
                                    <span className="text-muted-foreground">Last active: </span>
                                    <span className="font-medium">{new Date(u.last_sign_in_at).toLocaleDateString()}</span>
                                  </div>
                                )}
                              </div>

                              {/* Marketplace breakdown table */}
                              {u.marketplace_breakdown.length > 0 ? (
                                <div className="border rounded-md overflow-hidden">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-muted/50">
                                        <TableHead className="text-xs">Marketplace</TableHead>
                                        <TableHead className="text-xs text-right">Settlements</TableHead>
                                        <TableHead className="text-xs text-right">Gross Sales</TableHead>
                                        <TableHead className="text-xs text-right">Fees</TableHead>
                                        <TableHead className="text-xs text-right">Refunds</TableHead>
                                        <TableHead className="text-xs text-right">Net Deposit</TableHead>
                                        <TableHead className="text-xs text-right">GST</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {u.marketplace_breakdown.map((mp) => (
                                        <TableRow key={mp.marketplace}>
                                          <TableCell className="text-xs font-medium">
                                            <Badge variant="outline" className="text-[10px]">{mp.marketplace}</Badge>
                                          </TableCell>
                                          <TableCell className="text-xs text-right">{mp.settlement_count}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(mp.gross_sales)}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(mp.total_fees)}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(mp.refunds)}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(mp.net_deposit)}</TableCell>
                                          <TableCell className="text-xs text-right font-mono">{fmt(mp.gst)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">No settlement data for this user</p>
                              )}

                              {/* Connected marketplaces without settlements */}
                              {u.marketplaces.filter(m => !u.marketplace_breakdown.some(mb => mb.marketplace === m)).length > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  <span>Connected but no settlements: </span>
                                  {u.marketplaces.filter(m => !u.marketplace_breakdown.some(mb => mb.marketplace === m)).map(m => (
                                    <Badge key={m} variant="outline" className="text-[9px] mr-1">{m}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {sorted.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              {search ? 'No users match your search' : 'No users found'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
