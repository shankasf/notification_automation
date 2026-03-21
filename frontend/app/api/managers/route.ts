/**
 * GET /api/managers — returns all sourcing managers with their portfolio stats.
 *
 * For each manager, returns:
 *  - Basic info (id, name, email, category, avatarUrl)
 *  - totalReqs: count of active requisitions in their category
 *  - headcountGap: unfilled positions (needed - filled) across their category
 *  - unreadNotifications: count of unread notifications
 *
 * Active requisitions exclude COMPLETED and CANCELLED statuses.
 * Used by the home page to render manager cards and by the dashboard layout
 * to resolve the current user's display name and role.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const managers = await prisma.sourcingManager.findMany({
      include: {
        notifications: {
          where: { isRead: false },
          select: { id: true },
        },
      },
      orderBy: { name: "asc" },
    });

    // Get requisition stats per category (exclude completed/cancelled)
    const reqStats = await prisma.requisition.groupBy({
      by: ["category"],
      where: {
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      _count: { id: true },
      _sum: {
        headcountNeeded: true,
        headcountFilled: true,
      },
    });

    const statsByCategory = new Map(
      reqStats.map((s) => [
        s.category,
        {
          totalReqs: s._count.id,
          headcountGap: (s._sum.headcountNeeded || 0) - (s._sum.headcountFilled || 0),
        },
      ])
    );

    const result = managers.map((m) => {
      const stats = statsByCategory.get(m.category);
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        category: m.category,
        avatarUrl: m.avatarUrl,
        totalReqs: stats?.totalReqs || 0,
        headcountGap: stats?.headcountGap || 0,
        unreadNotifications: m.notifications.length,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching managers:", error);
    return NextResponse.json(
      { error: "Failed to fetch managers" },
      { status: 500 }
    );
  }
}
