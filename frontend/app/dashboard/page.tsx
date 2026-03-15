"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  FileText,
  Users,
  DollarSign,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { MANAGER_CONFIG, CHANGE_TYPE_COLORS } from "@/lib/managers";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useLiveUpdates } from "@/lib/ws-context";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface Stats {
  totalReqs: number;
  headcountGap: number;
  budgetAllocated: number;
  budgetSpent: number;
  criticalCount: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
}

interface Change {
  id: string;
  requisitionId: string;
  changeType: string;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  summary: string | null;
  createdAt: string;
  requisition: {
    requisitionId: string;
    roleTitle: string;
  };
}

const CATEGORY_COLORS = Object.values(MANAGER_CONFIG).map((c) => c.color);

const STATUS_BAR_COLORS: Record<string, string> = {
  OPEN: "#3B82F6",
  SOURCING: "#F59E0B",
  INTERVIEWING: "#8B5CF6",
  OFFER: "#6366F1",
  ONBOARDING: "#06B6D4",
  ACTIVE: "#10B981",
  COMPLETED: "#6B7280",
  CANCELLED: "#EF4444",
};

function DashboardContent() {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");
  const [stats, setStats] = useState<Stats | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const { changeSequence, notificationSequence } = useLiveUpdates();

  const fetchDashboard = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const statsUrl = managerId
      ? `/api/stats?managerId=${managerId}`
      : "/api/stats";
    const changesUrl = managerId
      ? `/api/changes?managerId=${managerId}&pageSize=10`
      : "/api/changes?pageSize=10";

    Promise.all([
      fetch(statsUrl).then((r) => r.json()),
      fetch(changesUrl).then((r) => r.json()),
    ])
      .then(([statsData, changesData]) => {
        setStats(statsData);
        setChanges(changesData.changes || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [managerId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Auto-refetch silently on WS events (no loading flash)
  useEffect(() => {
    if (changeSequence > 0 || notificationSequence > 0) fetchDashboard(true);
  }, [changeSequence, notificationSequence, fetchDashboard]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-xl border bg-white animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-80 rounded-xl border bg-white animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const budgetUtilization =
    stats.budgetAllocated > 0
      ? Math.round((stats.budgetSpent / stats.budgetAllocated) * 100)
      : 0;

  const categoryData = Object.entries(stats.byCategory).map(([name, value], idx) => ({
    name: MANAGER_CONFIG[name as keyof typeof MANAGER_CONFIG]?.label || name,
    value,
    color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
  }));

  const statusData = Object.entries(stats.byStatus).map(([name, value]) => ({
    name: name.charAt(0) + name.slice(1).toLowerCase(),
    value,
    fill: STATUS_BAR_COLORS[name] || "#6B7280",
  }));

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Hiring Requests</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {stats.totalReqs.toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Unfilled Positions</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">
                  {stats.headcountGap.toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-orange-50 flex items-center justify-center">
                <Users className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Budget Used</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {budgetUtilization}%
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatCurrency(stats.budgetSpent)} / {formatCurrency(stats.budgetAllocated)}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-green-50 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Critical Priority</p>
                <p className="text-3xl font-bold text-red-600 mt-1">
                  {stats.criticalCount}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spend by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Requests by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [value, "Requests"]}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    iconSize={8}
                    iconType="circle"
                    wrapperStyle={{ fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {statusData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Changes Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Changes</CardTitle>
        </CardHeader>
        <CardContent>
          {changes.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              No recent changes
            </p>
          ) : (
            <div className="space-y-4">
              {changes.map((change) => (
                <div
                  key={change.id}
                  className="flex items-start gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="mt-0.5">
                    <Badge
                      className={
                        CHANGE_TYPE_COLORS[change.changeType] || "bg-gray-100 text-gray-800"
                      }
                    >
                      {change.changeType.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {change.requisition.requisitionId} - {change.requisition.roleTitle}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {change.summary ||
                        `${change.fieldChanged}: ${change.oldValue} -> ${change.newValue}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDateTime(change.createdAt)} by {change.changedBy}
                    </p>
                  </div>
                  {change.changeType === "RATE_CHANGE" && change.oldValue && change.newValue && (
                    <div className="flex items-center gap-1 text-sm">
                      {parseFloat(change.newValue) > parseFloat(change.oldValue) ? (
                        <ArrowUpRight className="h-4 w-4 text-red-500" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 rounded-xl border bg-white animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
