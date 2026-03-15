import DashboardLayout from "@/app/dashboard/layout";

export default function MarketIntelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
