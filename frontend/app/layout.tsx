/**
 * Root layout — wraps the entire Next.js application.
 *
 * Sets the Inter font, loads global CSS, and wraps all pages in the
 * Providers component (NextAuth SessionProvider) so authentication
 * state is available throughout the app.
 */
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MetaSource | AI-Powered Sourcing Manager",
  description: "AI-powered notification platform that automatically detects changes in hiring data and alerts the right sourcing manager",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
