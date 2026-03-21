/**
 * Home page — the main entry point of the MetaSource application.
 *
 * Shows a branded sign-in screen for unauthenticated users, and once signed in,
 * displays an admin hub listing all sourcing managers with real-time stats
 * (total requests, unfilled positions, alerts). Non-admin managers are
 * auto-redirected to their personal dashboard.
 *
 * Subscribes to WebSocket events so manager cards update live when data changes.
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { useWebSocket, type WSMessage } from "@/lib/use-websocket";

// Hardcoded admin email — only this user sees the full admin hub; all others auto-redirect
const ADMIN_EMAIL = "sagarshankarnusa@gmail.com";
import {
  Code2,
  Shield,
  Database,
  Palette,
  Building2,
  Users,
  Bell,
  LayoutDashboard,
  ArrowRight,
  Zap,
  FileText,
  Bot,
  LogOut,
} from "lucide-react";
import { MANAGER_CONFIG } from "@/lib/managers";
import { getInitials } from "@/lib/utils";

interface ManagerData {
  id: string;
  name: string;
  email: string;
  category: string;
  totalReqs: number;
  headcountGap: number;
  unreadNotifications: number;
}

// Maps Lucide icon names (stored in MANAGER_CONFIG) to rendered JSX for manager cards
const iconMap: Record<string, React.ReactNode> = {
  Code2: <Code2 className="h-5 w-5" />,
  Shield: <Shield className="h-5 w-5" />,
  Database: <Database className="h-5 w-5" />,
  Palette: <Palette className="h-5 w-5" />,
  Building2: <Building2 className="h-5 w-5" />,
};

/** Main home page component — handles auth state, manager listing, and real-time updates. */
export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [managers, setManagers] = useState<ManagerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");

  const userEmail = session?.user?.email || "";
  const isAdmin = userEmail === ADMIN_EMAIL;

  const fetchManagers = useCallback(() => {
    fetch("/api/managers")
      .then((res) => res.json())
      .then((data) => {
        setManagers(data);
        setLoading(false);

        // Resolve display name from manager DB, not Google account
        const email = session?.user?.email;
        if (email) {
          const me = data.find((m: ManagerData) => m.email === email);
          if (me) {
            setDisplayName(me.name);
          } else if (email === ADMIN_EMAIL) {
            setDisplayName("Admin");
          }
        }

        // Non-admin managers auto-redirect to their own dashboard
        if (!isAdmin && session?.user?.email) {
          const myManager = data.find(
            (m: ManagerData) => m.email === session.user?.email
          );
          if (myManager) {
            router.replace(`/dashboard?manager=${myManager.id}`);
          }
        }
      })
      .catch(() => setLoading(false));
  }, [session, isAdmin, router]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    fetchManagers();
  }, [session, fetchManagers]);

  // Real-time updates: refetch manager stats on any WS event
  const handleWsMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type === "change" || msg.type === "notification" || msg.type === "refresh") {
        fetchManagers();
      }
    },
    [fetchManagers]
  );
  useWebSocket({ managerId: session ? null : "__disabled__", onMessage: handleWsMessage });

  // ── Not signed in: clean landing page ──
  if (!session && status !== "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 flex flex-col">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDE4YzEuNjU3IDAgMy0xLjM0MyAzLTNzLTEuMzQzLTMtMy0zLTMgMS4zNDMtMyAzIDEuMzQzIDMgMyAzem0wIDMwYzEuNjU3IDAgMy0xLjM0MyAzLTNzLTEuMzQzLTMtMy0zLTMgMS4zNDMtMyAzIDEuMzQzIDMgMyAzem0tMzAtMTVjMS42NTcgMCAzLTEuMzQzIDMtM3MtMS4zNDMtMy0zLTMtMyAxLjM0My0zIDMgMS4zNDMgMyAzIDN6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-50" />

        <div className="flex-1 flex items-center justify-center relative z-10">
          <div className="max-w-lg w-full mx-auto px-6 text-center">
            {/* Logo */}
            <div className="flex justify-center mb-8">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/20 backdrop-blur border border-blue-400/20 flex items-center justify-center">
                <Users className="h-8 w-8 text-blue-400" />
              </div>
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
              MetaSource
            </h1>
            <p className="text-lg text-blue-200/80 mb-3">
              Intelligent Workforce Sourcing Platform
            </p>
            <p className="text-sm text-blue-300/50 mb-10 max-w-md mx-auto">
              Automated change detection, AI-driven insights, and real-time alerts for sourcing managers tracking contractor hiring requests.
            </p>

            {/* How it works - compact */}
            <div className="grid grid-cols-4 gap-3 mb-10">
              {[
                { icon: <FileText className="h-4 w-4" />, label: "Import Data" },
                { icon: <Zap className="h-4 w-4" />, label: "Detect Changes" },
                { icon: <Bot className="h-4 w-4" />, label: "AI Analysis" },
                { icon: <Bell className="h-4 w-4" />, label: "Send Alerts" },
              ].map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <div className="h-9 w-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-blue-300">
                    {s.icon}
                  </div>
                  <span className="text-[11px] text-blue-300/70 font-medium">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Sign in button */}
            <button
              onClick={() => signIn("google")}
              className="inline-flex items-center gap-3 px-8 py-3.5 bg-white rounded-full shadow-2xl shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.03] transition-all duration-200 group"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-gray-800 font-semibold text-sm">
                Sign in with Google
              </span>
            </button>

            <p className="text-xs text-blue-300/40 mt-6">
              Built with Go, Next.js, OpenAI Agent SDK, and PostgreSQL
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 flex items-center justify-center">
        <div className="h-10 w-10 border-4 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Signed in: full app ──
  const totalReqs = managers.reduce((sum, m) => sum + m.totalReqs, 0);
  const totalGap = managers.reduce((sum, m) => sum + m.headcountGap, 0);
  const totalAlerts = managers.reduce((sum, m) => sum + m.unreadNotifications, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Hero */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-700" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE4YzEuNjU3IDAgMy0xLjM0MyAzLTNzLTEuMzQzLTMtMy0zLTMgMS4zNDMtMyAzIDEuMzQzIDMgMyAzem0wIDMwYzEuNjU3IDAgMy0xLjM0MyAzLTNzLTEuMzQzLTMtMy0zLTMgMS4zNDMtMyAzIDEuMzQzIDMgMyAzem0tMzAtMTVjMS42NTcgMCAzLTEuMzQzIDMtM3MtMS4zNDMtMy0zLTMtMyAxLjM0My0zIDMgMS4zNDMgMyAzIDN6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />

        {/* User bar */}
        <div className="relative max-w-7xl mx-auto px-6 pt-4 flex justify-end">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur rounded-full">
              {session?.user?.image ? (
                <img src={session.user.image} alt="" className="h-7 w-7 rounded-full border-2 border-white/30" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
                  {displayName?.[0] || "?"}
                </div>
              )}
              <span className="text-white text-sm font-medium hidden sm:inline">{displayName}</span>
              <span className="px-2 py-0.5 bg-white/20 rounded-full text-[11px] font-semibold text-white/90">
                {isAdmin ? "Admin" : "Manager"}
              </span>
            </div>
            <button
              onClick={() => { sessionStorage.clear(); signOut(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur rounded-full text-white/90 text-sm transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>

        <div className="relative max-w-7xl mx-auto px-6 py-10 md:py-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Users className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white">MetaSource</h1>
          </div>
          <p className="text-blue-100 max-w-xl">
            Welcome back, {(displayName || "").split(" ")[0]}. Choose a manager to view their portfolio or open Admin View for the full picture.
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 -mt-6 relative z-10">
        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
              <p className="text-3xl font-bold text-gray-900">{totalReqs.toLocaleString()}</p>
              <p className="text-sm text-gray-500 mt-1">Hiring Requests</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
              <p className="text-3xl font-bold text-orange-500">{totalGap.toLocaleString()}</p>
              <p className="text-sm text-gray-500 mt-1">Unfilled Positions</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
              <p className="text-3xl font-bold text-blue-600">{managers.length}</p>
              <p className="text-sm text-gray-500 mt-1">Managers</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
              <div className="flex items-center justify-center gap-2">
                <p className="text-3xl font-bold text-red-500">{totalAlerts}</p>
                {totalAlerts > 0 && <Bell className="h-5 w-5 text-red-400 animate-pulse" />}
              </div>
              <p className="text-sm text-gray-500 mt-1">Alerts</p>
            </div>
          </div>
        )}

        {/* Manager Cards */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-gray-900">Sourcing Managers</h2>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              Admin View
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-44 rounded-xl border border-gray-200 bg-white animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {managers.map((manager) => {
                const config = MANAGER_CONFIG[manager.category as keyof typeof MANAGER_CONFIG];
                return (
                  <Link
                    key={manager.id}
                    href={`/dashboard?manager=${manager.id}`}
                    className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-lg hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-11 w-11 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-sm"
                          style={{ backgroundColor: config?.color || "#6B7280" }}
                        >
                          {getInitials(manager.name)}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                            {manager.name}
                          </h3>
                          <p className="text-xs text-gray-500">{manager.email}</p>
                          <p className="text-xs text-gray-500">{config?.label || manager.category}</p>
                        </div>
                      </div>
                      {manager.unreadNotifications > 0 && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded-full text-xs font-medium">
                          <Bell className="h-3 w-3" />
                          {manager.unreadNotifications}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2.5 rounded-lg bg-gray-50">
                        <p className="text-lg font-bold text-gray-900">{manager.totalReqs}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Requests</p>
                      </div>
                      <div className="text-center p-2.5 rounded-lg bg-orange-50">
                        <p className="text-lg font-bold text-orange-600">{manager.headcountGap}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Unfilled</p>
                      </div>
                      <div className="text-center p-2.5 rounded-lg bg-blue-50">
                        <div className="flex items-center justify-center text-blue-600">
                          {config && iconMap[config.icon]}
                        </div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{config?.shortName}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end text-xs text-gray-400 group-hover:text-blue-500 transition-colors">
                      View Dashboard <ArrowRight className="h-3 w-3 ml-1" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Architecture link */}
        <div className="mb-10">
          <Link
            href="/architecture"
            className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md hover:border-blue-200 transition-all group"
          >
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-slate-600 group-hover:text-blue-600 transition-colors">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="8" y="14" width="8" height="7" rx="1" />
                <line x1="6.5" y1="10" x2="6.5" y2="14" />
                <line x1="17.5" y1="10" x2="17.5" y2="14" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors text-sm">Architecture Overview</h3>
              <p className="text-xs text-gray-500">Services, AI assistants, data flow, infrastructure</p>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
          </Link>
        </div>

        <footer className="border-t border-gray-200 py-5 text-center">
          <p className="text-xs text-gray-400">MetaSource — Intelligent Workforce Sourcing Platform</p>
        </footer>
      </main>
    </div>
  );
}
