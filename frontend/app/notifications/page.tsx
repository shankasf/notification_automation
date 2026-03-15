"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  DollarSign,
  Trophy,
  FileText,
  Circle,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { NOTIFICATION_TYPE_COLORS } from "@/lib/managers";
import { formatDateTime } from "@/lib/utils";
import { useLiveUpdates } from "@/lib/ws-context";

interface Notification {
  id: string;
  managerId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  CHANGE_SUMMARY: <FileText className="h-4 w-4" />,
  ANOMALY_ALERT: <AlertTriangle className="h-4 w-4" />,
  BUDGET_WARNING: <DollarSign className="h-4 w-4" />,
  MILESTONE: <Trophy className="h-4 w-4" />,
};

function groupByDate(notifications: Notification[]): Record<string, Notification[]> {
  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const date = new Date(n.createdAt).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(n);
  }
  return groups;
}

const typeRoutes: Record<string, string> = {
  CHANGE_SUMMARY: "/changes",
  ANOMALY_ALERT: "/requisitions",
  BUDGET_WARNING: "/requisitions",
  MILESTONE: "/dashboard",
};

function NotificationsContent() {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");
  const router = useRouter();
  const { notificationSequence, markNotificationsRefreshed } = useLiveUpdates();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [total, setTotal] = useState(0);

  const fetchNotifications = (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (managerId) params.set("managerId", managerId);
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    params.set("pageSize", "100");

    fetch(`/api/notifications?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setNotifications(data.notifications || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifications();
  }, [managerId, typeFilter]);

  // Auto-refetch silently when WS notification arrives (no loading flash)
  useEffect(() => {
    if (notificationSequence > 0) fetchNotifications(true);
  }, [notificationSequence]);

  const markAllRead = async () => {
    const url = managerId
      ? `/api/notifications?managerId=${managerId}`
      : "/api/notifications";
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
    fetchNotifications();
    markNotificationsRefreshed();
  };

  const markRead = async (ids: string[]) => {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    fetchNotifications();
    markNotificationsRefreshed();
  };

  const grouped = groupByDate(notifications);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-1">
            {unreadCount} unread of {total} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="CHANGE_SUMMARY">Change Summary</SelectItem>
              <SelectItem value="ANOMALY_ALERT">Anomaly Alert</SelectItem>
              <SelectItem value="BUDGET_WARNING">Budget Warning</SelectItem>
              <SelectItem value="MILESTONE">Milestone</SelectItem>
            </SelectContent>
          </Select>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark All Read
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl border bg-white animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">
              No notifications
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              You&apos;re all caught up!
            </p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([date, items]) => (
          <div key={date}>
            <h3 className="text-sm font-medium text-gray-500 mb-3">{date}</h3>
            <div className="space-y-2">
              {items.map((notif) => (
                <div
                  key={notif.id}
                  className={`rounded-xl border p-4 transition-colors cursor-pointer ${
                    notif.isRead
                      ? "bg-white border-gray-200"
                      : "bg-blue-50/50 border-blue-200"
                  }`}
                  onClick={() => {
                    if (!notif.isRead) markRead([notif.id]);
                    const managerQuery = managerId ? `?manager=${managerId}` : "";
                    const route = typeRoutes[notif.type] || "/dashboard";
                    router.push(`${route}${managerQuery}`);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg mt-0.5 ${
                        NOTIFICATION_TYPE_COLORS[notif.type] || "bg-gray-100"
                      }`}
                    >
                      {typeIcons[notif.type] || <Bell className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold text-gray-900">
                          {notif.title}
                        </h4>
                        {!notif.isRead && (
                          <Circle className="h-2 w-2 fill-blue-500 text-blue-500" />
                        )}
                        <Badge
                          className={
                            NOTIFICATION_TYPE_COLORS[notif.type] ||
                            "bg-gray-100 text-gray-800"
                          }
                        >
                          {notif.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600">{notif.message}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-400">
                          {formatDateTime(notif.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl space-y-6">
          <div className="h-10 w-48 bg-gray-200 animate-pulse rounded" />
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl border bg-white animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <NotificationsContent />
    </Suspense>
  );
}
