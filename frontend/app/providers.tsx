/**
 * Client-side context providers wrapper.
 *
 * Wraps the app in NextAuth's SessionProvider so that useSession() works
 * in all client components. Additional providers (e.g., theme, feature
 * flags) can be nested here when needed.
 */
"use client";

import { SessionProvider } from "next-auth/react";

/** Provides NextAuth session context to all child components. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
