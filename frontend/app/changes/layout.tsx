import DashboardLayout from "@/app/dashboard/layout";

export default function ChangesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
