/** Notifications layout — reuses the shared dashboard shell (sidebar + header). */
import DashboardLayout from "@/app/dashboard/layout";

export default function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
