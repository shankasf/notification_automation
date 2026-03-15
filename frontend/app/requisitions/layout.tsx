import DashboardLayout from "@/app/dashboard/layout";

export default function RequisitionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
