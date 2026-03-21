/** Chat layout — reuses the shared dashboard shell (sidebar + header). */
import DashboardLayout from "@/app/dashboard/layout";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
