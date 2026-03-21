/**
 * Market Rates page — compares internal bill rates against external market
 * benchmarks to help sourcing managers identify over/under-paying situations.
 *
 * Displays:
 *  - Horizontal bar chart comparing internal vs market average rates by role
 *  - Rate cards grouped by category, each showing role, location, source,
 *    market median, internal average, and percentage variance
 *  - Data collection history table (scrape logs with status, duration, errors)
 *  - "Collect Market Data" button that triggers the AI scraping service
 *
 * Rate variance highlights: >5% over market shows red, >5% under shows green.
 */
"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  TrendingUp,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { MANAGER_CONFIG } from "@/lib/managers";
import { formatRate, formatDateTime } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface MarketRate {
  id: string;
  roleTitle: string;
  category: string;
  location: string;
  minRate: number;
  maxRate: number;
  medianRate: number;
  source: string;
  scrapedAt: string;
}

interface InternalRate {
  roleTitle: string;
  category: string;
  avgRate: number;
  count: number;
}

interface ScrapeLog {
  id: string;
  source: string;
  rolesScraped: number;
  status: string;
  duration: number;
  error: string | null;
  createdAt: string;
}

function MarketIntelContent() {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");

  const [marketRates, setMarketRates] = useState<MarketRate[]>([]);
  const [internalRates, setInternalRates] = useState<InternalRate[]>([]);
  const [scrapeLogs, setScrapeLogs] = useState<ScrapeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (managerId) {
      params.set("managerId", managerId);
    }
    if (categoryFilter && categoryFilter !== "all") {
      params.set("category", categoryFilter);
    }

    fetch(`/api/market-rates?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setMarketRates(data.marketRates || []);
        setInternalRates(data.internalRates || []);
        setScrapeLogs(data.scrapeLogs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [categoryFilter, managerId]);

  const handleScrape = async () => {
    setScraping(true);
    try {
      await fetch("/api/ai/scrape", { method: "POST" });
    } catch {
      // Service may be unavailable
    }
    setScraping(false);
    fetchData();
  };

  // Build comparison chart data by matching internal rates against market medians.
  // When a role has market data from multiple locations, medians are averaged.
  const comparisonData: Record<
    string,
    { role: string; internal: number; market: number }
  > = {};

  for (const ir of internalRates) {
    if (ir.avgRate) {
      comparisonData[ir.roleTitle] = {
        role: ir.roleTitle,
        internal: Math.round(ir.avgRate),
        market: 0,
      };
    }
  }

  for (const mr of marketRates) {
    if (comparisonData[mr.roleTitle]) {
      // Average market medians for same role across locations
      if (comparisonData[mr.roleTitle].market === 0) {
        comparisonData[mr.roleTitle].market = mr.medianRate;
      } else {
        comparisonData[mr.roleTitle].market = Math.round(
          (comparisonData[mr.roleTitle].market + mr.medianRate) / 2
        );
      }
    }
  }

  const chartData = Object.values(comparisonData)
    .filter((d) => d.market > 0)
    .slice(0, 15);

  // Group market rates by category for the cards
  const ratesByCategory: Record<string, MarketRate[]> = {};
  for (const rate of marketRates) {
    if (!ratesByCategory[rate.category]) ratesByCategory[rate.category] = [];
    ratesByCategory[rate.category].push(rate);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Market Rates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare your bill rates against market averages for similar roles
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(MANAGER_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleScrape} disabled={scraping} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${scraping ? "animate-spin" : ""}`} />
            {scraping ? "Collecting..." : "Collect Market Data"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-64 rounded-xl border bg-white animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Comparison Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Your Bill Rates vs Market Rates ($/hr)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis
                        type="category"
                        dataKey="role"
                        width={150}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value: number) => [`$${value}/hr`]}
                      />
                      <Legend />
                      <Bar dataKey="internal" name="Your Bill Rate" fill="#0668E1" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="market" name="Market Average" fill="#10B981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rate Cards by Category */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Object.entries(ratesByCategory).map(([category, rates]) => {
              const config = MANAGER_CONFIG[category as keyof typeof MANAGER_CONFIG];
              return (
                <Card key={category}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: config?.color }}
                      />
                      <CardTitle className="text-base">
                        {config?.label || category}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {rates.slice(0, 5).map((rate) => {
                        const internal = internalRates.find(
                          (ir) =>
                            ir.roleTitle === rate.roleTitle &&
                            ir.category === rate.category
                        );
                        const internalAvg = internal?.avgRate || 0;
                        const diff = internalAvg
                          ? Math.round(((internalAvg - rate.medianRate) / rate.medianRate) * 100)
                          : 0;

                        return (
                          <div
                            key={rate.id}
                            className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {rate.roleTitle}
                              </p>
                              <p className="text-xs text-gray-500">
                                {rate.location} | {rate.source}
                              </p>
                            </div>
                            <div className="text-right">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">
                                  Market: {formatRate(rate.medianRate)}
                                </span>
                                {internalAvg > 0 && (
                                  <>
                                    <span className="text-sm font-medium">
                                      Yours: {formatRate(internalAvg)}
                                    </span>
                                    <span
                                      className={`flex items-center text-xs font-medium ${
                                        diff > 5
                                          ? "text-red-600"
                                          : diff < -5
                                          ? "text-green-600"
                                          : "text-gray-500"
                                      }`}
                                    >
                                      {diff > 0 ? (
                                        <ArrowUpRight className="h-3 w-3" />
                                      ) : diff < 0 ? (
                                        <ArrowDownRight className="h-3 w-3" />
                                      ) : (
                                        <Minus className="h-3 w-3" />
                                      )}
                                      {Math.abs(diff)}%
                                    </span>
                                  </>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">
                                Range: {formatRate(rate.minRate)} - {formatRate(rate.maxRate)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Scrape Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Data Collection History</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs uppercase">Timestamp</TableHead>
                    <TableHead className="text-xs uppercase">Source</TableHead>
                    <TableHead className="text-xs uppercase">Roles Scraped</TableHead>
                    <TableHead className="text-xs uppercase">Status</TableHead>
                    <TableHead className="text-xs uppercase">Duration</TableHead>
                    <TableHead className="text-xs uppercase">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scrapeLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-500 py-6">
                        No data collection history
                      </TableCell>
                    </TableRow>
                  ) : (
                    scrapeLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm text-gray-500">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {log.source}
                        </TableCell>
                        <TableCell className="text-sm">{log.rolesScraped}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              log.status === "success"
                                ? "bg-green-100 text-green-800"
                                : log.status === "partial"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-800"
                            }
                          >
                            {log.status === "success" && (
                              <CheckCircle className="h-3 w-3 mr-1" />
                            )}
                            {log.status === "failed" && (
                              <XCircle className="h-3 w-3 mr-1" />
                            )}
                            {log.status === "partial" && (
                              <Clock className="h-3 w-3 mr-1" />
                            )}
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {(log.duration / 1000).toFixed(1)}s
                        </TableCell>
                        <TableCell className="text-sm text-red-500 max-w-[200px] truncate">
                          {log.error || "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function MarketIntelPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-10 w-48 bg-gray-200 animate-pulse rounded" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-64 rounded-xl border bg-white animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <MarketIntelContent />
    </Suspense>
  );
}
