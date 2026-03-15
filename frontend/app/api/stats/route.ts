import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RequisitionCategory } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const managerId = searchParams.get("managerId");

    // If managerId provided, find the manager's category to filter requisitions
    let categoryFilter: RequisitionCategory | undefined;
    if (managerId) {
      const manager = await prisma.sourcingManager.findUnique({
        where: { id: managerId },
        select: { category: true },
      });
      if (manager) {
        categoryFilter = manager.category;
      }
    }

    const where = categoryFilter ? { category: categoryFilter } : {};

    const [totalReqs, aggregates, criticalCount, byCategory, byStatus] = await Promise.all([
      prisma.requisition.count({ where }),
      prisma.requisition.aggregate({
        where,
        _sum: {
          headcountNeeded: true,
          headcountFilled: true,
          budgetAllocated: true,
          budgetSpent: true,
        },
      }),
      prisma.requisition.count({
        where: { ...where, priority: "CRITICAL" },
      }),
      prisma.requisition.groupBy({
        by: ["category"],
        where,
        _count: { id: true },
      }),
      prisma.requisition.groupBy({
        by: ["status"],
        where,
        _count: { id: true },
      }),
    ]);

    const headcountGap =
      (aggregates._sum.headcountNeeded || 0) - (aggregates._sum.headcountFilled || 0);

    const byCategoryMap: Record<string, number> = {};
    for (const item of byCategory) {
      byCategoryMap[item.category] = item._count.id;
    }

    const byStatusMap: Record<string, number> = {};
    for (const item of byStatus) {
      byStatusMap[item.status] = item._count.id;
    }

    return NextResponse.json({
      totalReqs,
      headcountGap,
      budgetAllocated: aggregates._sum.budgetAllocated || 0,
      budgetSpent: aggregates._sum.budgetSpent || 0,
      criticalCount,
      byCategory: byCategoryMap,
      byStatus: byStatusMap,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
