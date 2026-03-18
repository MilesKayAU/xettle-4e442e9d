import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart3, TrendingUp, Receipt, Store, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { useInsightsData } from '@/hooks/useInsightsData';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

const formatAUD = (n: number) => {
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getLabel = (code: string) => MARKETPLACE_LABELS[code] || code;

export default function InsightsTab() {
  const { feeAnalysis, gstLiability, trend12Month, channelComparison, loading, error } = useInsightsData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner />
        <span className="ml-3 text-sm text-muted-foreground">Loading insights...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const hasData = feeAnalysis.length > 0 || trend12Month.length > 0 || channelComparison.length > 0;

  if (!hasData) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">No settlement data yet</p>
          <p className="text-sm text-muted-foreground mt-1">Upload or sync settlements to see insights here.</p>
        </CardContent>
      </Card>
    );
  }

  // Prepare fee chart data — last 6 months
  const allMonths = [...new Set(feeAnalysis.map(r => r.month))].sort().slice(-6);
  const allMarketplaces = [...new Set(feeAnalysis.map(r => r.marketplace))];
  const feeChartData = allMonths.map(month => {
    const row: Record<string, any> = { month };
    for (const mp of allMarketplaces) {
      const match = feeAnalysis.find(r => r.month === month && r.marketplace === mp);
      row[mp] = match ? Number(match.fee_percentage) : 0;
    }
    return row;
  });

  const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

  // Current quarter detection
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3) + 1;
  const currentQLabel = `Q${currentQ} ${now.getFullYear()}`;

  return (
    <div className="space-y-6">
      {/* SECTION 1 — Channel Fee Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Channel Fee Analysis
          </CardTitle>
          <CardDescription>Fee percentage by marketplace — last 6 months</CardDescription>
        </CardHeader>
        <CardContent>
          {feeChartData.length > 0 && (
            <div className="h-64 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={feeChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" className="text-xs fill-muted-foreground" />
                  <YAxis unit="%" className="text-xs fill-muted-foreground" />
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, getLabel(name)]}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Legend formatter={(value) => getLabel(value)} />
                  {allMarketplaces.map((mp, i) => (
                    <Bar key={mp} dataKey={mp} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Sales (ex GST)</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Fee %</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeAnalysis.slice(0, 18).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{getLabel(row.marketplace)}</TableCell>
                    <TableCell>{row.month}</TableCell>
                    <TableCell className="text-right">{formatAUD(Number(row.sales_ex_gst))}</TableCell>
                    <TableCell className="text-right text-destructive">{formatAUD(Number(row.total_fees))}</TableCell>
                    <TableCell className="text-right">{Number(row.fee_percentage).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{formatAUD(Number(row.net_amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2 — GST Liability by Quarter */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" /> GST Liability by Quarter
          </CardTitle>
          <CardDescription>BAS-ready GST summary per quarter</CardDescription>
        </CardHeader>
        <CardContent>
          {gstLiability.length > 0 && (
            <>
              {/* Current quarter prominently */}
              {(() => {
                const current = gstLiability.find(q => q.quarter === currentQLabel);
                if (!current) return null;
                return (
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <Card className="border-2 border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
                      <CardContent className="pt-4 pb-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">GST Payable</p>
                        <p className="text-xl font-bold text-foreground">{formatAUD(Number(current.gst_payable))}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-2 border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
                      <CardContent className="pt-4 pb-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">GST Claimable</p>
                        <p className="text-xl font-bold text-foreground">{formatAUD(Number(current.gst_claimable))}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-2 border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
                      <CardContent className="pt-4 pb-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Net BAS Liability</p>
                        <p className="text-xl font-bold text-foreground">{formatAUD(Number(current.net_gst_liability))}</p>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quarter</TableHead>
                    <TableHead className="text-right">GST Payable</TableHead>
                    <TableHead className="text-right">GST Claimable</TableHead>
                    <TableHead className="text-right">Net Liability</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Settlements</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gstLiability.map((row, i) => (
                    <TableRow key={i} className={row.quarter === currentQLabel ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                      <TableCell className="font-medium">
                        {row.quarter}
                        {row.quarter === currentQLabel && (
                          <Badge variant="outline" className="ml-2 text-[10px] border-amber-400 text-amber-700">Current</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatAUD(Number(row.gst_payable))}</TableCell>
                      <TableCell className="text-right">{formatAUD(Number(row.gst_claimable))}</TableCell>
                      <TableCell className="text-right font-medium">{formatAUD(Number(row.net_gst_liability))}</TableCell>
                      <TableCell className="text-right">{formatAUD(Number(row.sales_principal))}</TableCell>
                      <TableCell className="text-right">{row.settlements_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          {gstLiability.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No GST data available yet.</p>
          )}
        </CardContent>
      </Card>

      {/* SECTION 3 — 12-Month Revenue Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> 12-Month Revenue Trend
          </CardTitle>
          <CardDescription>Gross sales, net deposit, and margin over the last 12 months</CardDescription>
        </CardHeader>
        <CardContent>
          {trend12Month.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend12Month}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="period_label" className="text-xs fill-muted-foreground" />
                  <YAxis yAxisId="left" className="text-xs fill-muted-foreground" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" className="text-xs fill-muted-foreground" unit="%" />
                  <RechartsTooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'margin_pct') return [`${value.toFixed(1)}%`, 'Margin'];
                      return [formatAUD(value), name === 'gross_sales' ? 'Gross Sales' : 'Net Deposit'];
                    }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Legend formatter={(v) => v === 'gross_sales' ? 'Gross Sales' : v === 'net_deposit' ? 'Net Deposit' : 'Margin %'} />
                  <Line yAxisId="left" type="monotone" dataKey="gross_sales" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="net_deposit" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="margin_pct" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">Need at least one month of data.</p>
          )}
        </CardContent>
      </Card>

      {/* SECTION 4 — Channel Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" /> Channel Comparison
          </CardTitle>
          <CardDescription>All-time performance by marketplace</CardDescription>
        </CardHeader>
        <CardContent>
          {channelComparison.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Settlements</TableHead>
                    <TableHead className="text-right">Gross Sales</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">Total Fees</TableHead>
                    <TableHead className="text-right">Fee %</TableHead>
                    <TableHead className="text-right">Net Payout</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead>Period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channelComparison.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{getLabel(row.marketplace)}</TableCell>
                      <TableCell className="text-right">{row.total_settlements}</TableCell>
                      <TableCell className="text-right">{formatAUD(Number(row.total_gross_sales))}</TableCell>
                      <TableCell className="text-right text-destructive">{formatAUD(Number(row.total_refunds))}</TableCell>
                      <TableCell className="text-right text-destructive">{formatAUD(Number(row.total_all_fees))}</TableCell>
                      <TableCell className="text-right">{Number(row.avg_fee_rate_pct).toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-medium">{formatAUD(Number(row.total_net_payout))}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={Number(row.margin_pct) > 70 ? 'default' : Number(row.margin_pct) > 50 ? 'secondary' : 'destructive'}>
                          {Number(row.margin_pct).toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.date_range}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Fee breakdown detail */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {channelComparison.map((row, i) => (
                  <Card key={i} className="border">
                    <CardContent className="pt-4 pb-3">
                      <p className="font-medium text-sm mb-2">{getLabel(row.marketplace)} — Fee Breakdown</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">Seller Fees</span><span>{formatAUD(Number(row.total_fees_seller))}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">FBA Fees</span><span>{formatAUD(Number(row.total_fees_fba))}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Storage Fees</span><span>{formatAUD(Number(row.total_fees_storage))}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Other / Ads</span><span>{formatAUD(Number(row.total_fees_other))}</span></div>
                        <div className="flex justify-between border-t pt-1 font-medium"><span>Total Fees</span><span>{formatAUD(Number(row.total_all_fees))}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-muted-foreground">GST Payable</span><span>{formatAUD(Number(row.total_gst_payable))}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">GST Claimable</span><span>{formatAUD(Number(row.total_gst_claimable))}</span></div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No channel data available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
