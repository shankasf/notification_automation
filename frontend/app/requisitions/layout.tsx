/**
 * Requisitions layout — reuses the shared dashboard shell (sidebar + header)
 * so the requisitions page inherits navigation, WS context, and toasts.
 */
import DashboardLayout from "@/app/dashboard/layout";

export default function RequisitionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
