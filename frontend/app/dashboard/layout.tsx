/**
 * Dashboard layout — shared shell for all authenticated pages (dashboard,
 * requisitions, notifications, changes, market intel, chat, data upload).
 *
 * Provides:
 *  - Responsive sidebar with navigation links and unread notification badge
 *  - Top header bar with user identity, role badge, and notification bell
 *  - WebSocket connection status indicator (Live / Connecting)
 *  - LiveUpdatesProvider context so child pages can react to real-time events
 *  - Toast container for in-app popup notifications
 *
 * This layout is reused by sibling route layouts (requisitions, notifications,
 * etc.) which re-export it via `import DashboardLayout from "@/app/dashboard/layout"`.
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  FileText,
  Bell,
  History,
  TrendingUp,
  MessageSquare,
  Users,
  ChevronLeft,
  Menu,
  X,
  LogOut,
  Wifi,
  WifiOff,
  ShieldCheck,
  Upload,
} from "lucide-react";

const ADMIN_EMAIL = "sagarshankarnusa@gmail.com";
import { cn } from "@/lib/utils";
import { Suspense } from "react";
import { LiveUpdatesProvider, useLiveUpdates } from "@/lib/ws-context";
import { Toaster, showToast } from "@/app/components/toaster";

interface ManagerInfo {
  id: string;
  name: string;
  email: string;
  category: string;
}

/** Core layout shell — sidebar, top bar, user info, notification badge. */
function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");
  const [manager, setManager] = useState<ManagerInfo | null>(null);
  const [userRole, setUserRole] = useState<{ isAdmin: boolean; label: string } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const fetchUnread = useCallback(() => {
    const notifUrl = managerId
      ? `/api/notifications?managerId=${managerId}&unreadOnly=true`
      : `/api/notifications?unreadOnly=true`;
    fetch(notifUrl)
      .then((res) => res.json())
      .then((data) => setUnreadCount(data.total || 0))
      .catch(() => {});
  }, [managerId]);

  useEffect(() => {
    fetch(`/api/managers`)
      .then((res) => res.json())
      .then((data: ManagerInfo[]) => {
        if (managerId) {
          const found = data.find((m: ManagerInfo) => m.id === managerId);
          if (found) setManager(found);
        }
        // Derive role + display name from DB, not Google account
        const email = session?.user?.email;
        if (email) {
          const me = data.find((m: ManagerInfo) => m.email === email);
          if (email === ADMIN_EMAIL) {
            setUserRole({ isAdmin: true, label: "Admin" });
            setDisplayName(me ? me.name : "Admin");
          } else if (me) {
            setUserRole({
              isAdmin: false,
              label: me.category.replace(/_/g, " "),
            });
            setDisplayName(me.name);
          }
        }
      });
    fetchUnread();
  }, [managerId, fetchUnread, session]);

  // Re-fetch unread count when WS notification arrives or user marks read
  const { connected, notificationSequence, readSequence } = useLiveUpdates();
  useEffect(() => {
    if (notificationSequence > 0) fetchUnread();
  }, [notificationSequence, fetchUnread]);
  useEffect(() => {
    if (readSequence > 0) fetchUnread();
  }, [readSequence, fetchUnread]);

  const managerQuery = managerId ? `?manager=${managerId}` : "";

  const navItems = [
    { href: `/dashboard${managerQuery}`, label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: `/requisitions${managerQuery}`, label: "Hiring Requests", icon: FileText },
    { href: `/notifications${managerQuery}`, label: "Notifications", icon: Bell, badge: unreadCount },
    { href: `/changes${managerQuery}`, label: "Change Log", icon: History },
    { href: `/market-intel${managerQuery}`, label: "Market Rates", icon: TrendingUp },
    { href: `/chat${managerQuery}`, label: "AI Chat", icon: MessageSquare },
    ...(userRole?.isAdmin ? [{ href: `/data-upload`, label: "Data Upload", icon: Upload }] : []),
  ];

  const isActive = (href: string, exact?: boolean) => {
    const path = href.split("?")[0];
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform lg:translate-x-0 lg:static lg:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary-500 flex items-center justify-center">
              <Users className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">MetaSource</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 rounded-md hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "sidebar-link-active" : "sidebar-link"}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="h-5 w-5" />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="bg-red-500 text-white text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* WS status + Back */}
        <div className="p-4 border-t border-gray-200 space-y-1">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400">
            {connected ? (
              <>
                <Wifi className="h-3 w-3 text-green-500" />
                <span className="text-green-600">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-gray-400" />
                <span>Connecting...</span>
              </>
            )}
          </div>
          <Link href="/" className="sidebar-link">
            <ChevronLeft className="h-5 w-5" />
            <span>Back to Home</span>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-md hover:bg-gray-100"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {manager ? manager.name : "Admin View"}
            </h2>
            {manager && (
              <span className="text-sm text-gray-500">
                {manager.category.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/notifications${managerQuery}`}
              className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Bell className="h-5 w-5 text-gray-600" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                  {unreadCount}
                </span>
              )}
            </Link>
            {session?.user && (
              <>
                <div className="h-5 w-px bg-gray-200 mx-1" />
                <div className="flex items-center gap-2">
                  {session.user.image ? (
                    <img src={session.user.image} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                      {displayName?.[0] || "?"}
                    </div>
                  )}
                  <div className="hidden md:flex flex-col">
                    <span className="text-sm text-gray-700 font-medium leading-tight">{displayName}</span>
                    {userRole && (
                      <span className={cn(
                        "text-[10px] font-semibold leading-tight",
                        userRole.isAdmin ? "text-blue-600" : "text-gray-500"
                      )}>
                        {userRole.isAdmin && <ShieldCheck className="h-3 w-3 inline mr-0.5 -mt-0.5" />}
                        {userRole.label}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { sessionStorage.clear(); signOut({ callbackUrl: "/" }); }}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}

/** Wraps children in LiveUpdatesProvider, connecting the WS for the current manager. */
function WSWrapper({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");

  const handleToast = useCallback((title: string, message: string) => {
    showToast(title, message);
  }, []);

  return (
    <LiveUpdatesProvider managerId={managerId} onToast={handleToast}>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </LiveUpdatesProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      }
    >
      <WSWrapper>{children}</WSWrapper>
    </Suspense>
  );
}
