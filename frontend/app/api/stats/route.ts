/**
 * GET /api/stats — returns aggregated dashboard statistics.
 *
 * Computes:
 *  - totalReqs: count of active (non-completed, non-cancelled) requisitions
 *  - headcountGap: total needed - total filled across active requisitions
 *  - budgetAllocated / budgetSpent: summed budget figures
 *  - criticalCount: number of CRITICAL priority active requisitions
 *  - byCategory: request count grouped by category (active only)
 *  - byStatus: request count grouped by status (all statuses for chart)
 *
 * Optionally scoped to a specific manager's category via ?managerId= parameter.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RequisitionCategory, RequisitionStatus } from "@prisma/client";

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
    // Active-only filter: exclude completed/cancelled for headline stats
    const activeWhere = {
      ...where,
      status: { notIn: [RequisitionStatus.COMPLETED, RequisitionStatus.CANCELLED] },
    };

    const [totalReqs, aggregates, criticalCount, byCategory, byStatus] = await Promise.all([
      prisma.requisition.count({ where: activeWhere }),
      prisma.requisition.aggregate({
        where: activeWhere,
        _sum: {
          headcountNeeded: true,
          headcountFilled: true,
          budgetAllocated: true,
          budgetSpent: true,
        },
      }),
      prisma.requisition.count({
        where: { ...activeWhere, priority: "CRITICAL" },
      }),
      prisma.requisition.groupBy({
        by: ["category"],
        where: activeWhere,
        _count: { id: true },
      }),
      // Status distribution chart shows ALL statuses (including completed/cancelled)
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
